import React, { useState, useEffect, useRef } from 'react';
import { useRealtimeQuery, useDatabase } from '../../hooks/useDatabase';
import { GlideTable } from '../DataGrid/GlideTable';
import { CsvImportModal } from '../DataGrid/CsvImportModal';
import { parseCSV } from '../../utils/csv';
import { Table2, Plus, Trash2, Database, Upload, RefreshCw, Sparkles } from 'lucide-react';
import { ConfirmDialog } from '../Modal';

export const TablesView: React.FC = () => {
  const { schema, rpc, addToast, refreshSchema } = useDatabase();
  const [selectedTable, setSelectedTable] = useState<string>('');
  
  // ... (keep existing state variables like showCreateModal, etc.) ...
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTableName, setNewTableName] = useState('');
  const [newTableColumns, setNewTableColumns] = useState([{ name: 'name', type: 'TEXT', notNull: false }]);
  const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const LAST_IMPORT_STORAGE_KEY = 'nanotype:last-imports';
  
  // ... (keep CSV state variables) ...
  const [csvPreview, setCsvPreview] = useState<any>(null);
  const [importing, setImporting] = useState(false);
  const [csvTargetMode, setCsvTargetMode] = useState<'new' | 'existing'>('new');
  const [csvTargetName, setCsvTargetName] = useState('');
  const [csvTargetTable, setCsvTargetTable] = useState('');
  const [lastRefreshedAt, setLastRefreshedAt] = useState<number | null>(null);
  const [lastImportMap, setLastImportMap] = useState<Record<string, number>>(() => {
    if (typeof window === 'undefined') return {};
    try {
      const raw = window.localStorage.getItem(LAST_IMPORT_STORAGE_KEY);
      return raw ? JSON.parse(raw) : {};
    } catch {
      return {};
    }
  });

  // STRICT SANITIZATION: Must match backend regex /[^a-z0-9_]/g (applied after toLowerCase)
  // This prevents the "ghost table" issue where frontend sees "my-table" but backend has "mytable"
  const sanitizeTableName = (name: string) => name.toLowerCase().replace(/[^a-z0-9_]/g, '');

  const deriveTableName = (fileName: string) => sanitizeTableName(fileName.replace(/\.csv$/i, ''));

  // Reload delay after import to ensure schema propagation
  const RELOAD_DELAY_MS = 100;

  // Destructure reload from the hook
  const { data, total, loadMore, reload } = useRealtimeQuery(selectedTable);
  const tableList = schema ? Object.keys(schema) : [];

  // ... (keep useEffect for auto-selecting table) ...
  useEffect(() => {
    if (schema) {
      const tables = Object.keys(schema);
      if (tables.length > 0 && !tables.includes(selectedTable)) {
        setSelectedTable(tables[0]);
      }
    }
  }, [schema, selectedTable]);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    try {
      window.localStorage.setItem(LAST_IMPORT_STORAGE_KEY, JSON.stringify(lastImportMap));
    } catch {
      // ignore storage errors
    }
  }, [lastImportMap]);

  const DEFAULT_LIMIT = 500;

  const formatTimestamp = (ts?: number | null) => {
    if (!ts) return '—';
    return new Date(ts).toLocaleString();
  };

  const refreshTableData = async (tableName: string) => {
    if (!tableName) return;
    try {
      // Always use executeSQL with quoted table name
      await rpc('executeSQL', {
        sql: `SELECT * FROM "${tableName}" LIMIT ${DEFAULT_LIMIT} OFFSET 0`,
        readonly: true
      });
      await rpc('executeSQL', {
        sql: `SELECT COUNT(*) as count FROM "${tableName}"`,
        readonly: true
      });
      setLastRefreshedAt(Date.now());
    } catch (error) {
      console.error('Failed to refresh table data:', error);
      addToast('Failed to refresh table data', 'error');
    }
  };

  const handleCreateTable = async () => {
    if (!newTableName.trim()) {
      addToast('Please enter a table name', 'error');
      return;
    }

    if (newTableColumns.length === 0 || !newTableColumns[0].name) {
      addToast('Please add at least one column', 'error');
      return;
    }

    try {
      const safeName = sanitizeTableName(newTableName);
      await rpc('createTable', {
        tableName: safeName,
        columns: newTableColumns
      });
      
      setShowCreateModal(false);
      setNewTableName('');
      setNewTableColumns([{ name: 'name', type: 'TEXT', notNull: false }]);
      setSelectedTable(safeName);
    } catch (error) {
      console.error('Failed to create table:', error);
      addToast('Failed to create table: ' + (error as Error).message, 'error');
    }
  };

  const handleDeleteTable = async (tableName: string) => {
    setDeleteConfirm(tableName);
  };

  const confirmDeleteTable = async () => {
    if (!deleteConfirm) return;
    const tableName = deleteConfirm;
    setDeleteConfirm(null);

    try {
      await rpc('deleteTable', { tableName });
      if (selectedTable === tableName) {
        setSelectedTable('');
      }
    } catch (error) {
      console.error('Failed to delete table:', error);
      addToast('Failed to delete table: ' + (error as Error).message, 'error');
    }
  };

  const addColumn = () => {
    setNewTableColumns([...newTableColumns, { name: '', type: 'TEXT', notNull: false }]);
  };

  const updateColumn = (index: number, field: string, value: any) => {
    const updated = [...newTableColumns];
    updated[index] = { ...updated[index], [field]: value };
    setNewTableColumns(updated);
  };

  const removeColumn = (index: number) => {
    setNewTableColumns(newTableColumns.filter((_, i) => i !== index));
  };

  const handleCSVFileSelect = () => {
    fileInputRef.current?.click();
  };

  const handleCSVFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    try {
      const { headers, rows, inferredTypes } = await parseCSV(file);
      const derivedName = deriveTableName(file.name);

      setCsvPreview({
        headers,
        headerMapping: [],
        rows,
        inferredTypes,
        fileName: file.name
      });
      setCsvTargetMode('new');
      setCsvTargetName(derivedName);
      setCsvTargetTable(selectedTable || tableList[0] || '');
    } catch (error: any) {
      addToast('CSV parsing failed: ' + error.message, 'error');
    }

    if (fileInputRef.current) fileInputRef.current.value = '';
  };

  const handleConfirmImport = async () => {
    if (!csvPreview) return;
    setImporting(true);

    try {
      const derivedName = deriveTableName(csvPreview.fileName);
      
      // Sanitize target name strictly to ensure schema match
      const targetTable = csvTargetMode === 'existing'
        ? (csvTargetTable || selectedTable)
        : sanitizeTableName(csvTargetName || derivedName);

      if (!targetTable) {
        addToast('Invalid table name', 'error');
        setImporting(false);
        return;
      }

      // Check existence
      const tableExists = schema && schema[targetTable];

      if (csvTargetMode === 'new' && tableExists) {
        addToast(`Table "${targetTable}" already exists.`, 'error');
        setImporting(false);
        return;
      }

      if (!tableExists) {
        // Create table logic...
        const columns = csvPreview.headers.map((header: string) => ({
          name: header,
          type: csvPreview.inferredTypes?.[header] || 'TEXT',
          notNull: false
        }));

        if (!columns.find((c: any) => c.name.toLowerCase() === 'id')) {
          columns.unshift({ name: 'id', type: 'INTEGER', primaryKey: true, notNull: true });
        }

        await rpc('createTable', {
          tableName: targetTable,
          columns: columns
        });

        // Wait for schema propagation
        await new Promise(resolve => setTimeout(resolve, 500));
      }

      const response = await rpc('batchInsert', { 
        table: targetTable, 
        rows: csvPreview.rows 
      });

      if (response && response.data) {
        const { inserted, total } = response.data;
        addToast(`Imported ${inserted}/${total} rows`, 'success');
      }
      
      setCsvPreview(null);
      await refreshSchema();
      
      // Update selection to the new (sanitized) name and force reload
      setSelectedTable(targetTable);
      setTimeout(() => reload(), RELOAD_DELAY_MS); 
      
    } catch (error: any) {
      console.error("Import error details:", error);
      addToast('Import failed: ' + error.message, 'error');
    } finally {
      setImporting(false);
    }
  };

  return (
    <div className="flex h-full overflow-hidden">
      {/* Tables Sidebar */}
      <aside className="w-56 bg-slate-900 border-r border-slate-800 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Tables</h3>
          <div className="flex gap-1">
            <button
              onClick={handleCSVFileSelect}
              className="p-1 hover:bg-slate-800 rounded transition-colors"
              title="Import CSV"
            >
              <Upload size={18} className="text-blue-500" />
            </button>
            <button
              onClick={() => setShowCreateModal(true)}
              className="p-1 hover:bg-slate-800 rounded transition-colors"
              title="Create new table"
            >
              <Plus size={18} className="text-green-500" />
            </button>
          </div>
        </div>
        
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {tableList.length === 0 ? (
            <div className="px-2 py-4 text-center">
              <Database size={32} className="mx-auto mb-2 text-slate-600" />
              <p className="text-xs text-slate-600 mb-3">No tables found.</p>
              <div className="space-y-2">
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="w-full text-xs text-green-500 hover:text-green-400 py-1"
                >
                  Create your first table
                </button>
                <div className="text-xs text-slate-600">or</div>
                <button
                  onClick={handleCSVFileSelect}
                  className="w-full flex items-center justify-center gap-2 text-xs text-blue-500 hover:text-blue-400 py-1"
                >
                  <Upload size={14} />
                  Import from CSV
                </button>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleCSVFileChange}
                className="hidden"
              />
            </div>
          ) : (
            tableList.map(table => (
              <div
                key={table}
                className="group relative"
              >
                <button
                  onClick={() => setSelectedTable(table)}
                  className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-all ${
                    selectedTable === table
                      ? 'bg-slate-800 text-green-400' 
                      : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                  }`}
                >
                  <Table2 size={18} />
                  <span className="flex-1 text-left truncate">{table}</span>
                </button>
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    handleDeleteTable(table);
                  }}
                  className="absolute right-2 top-1/2 -translate-y-1/2 p-1 opacity-0 group-hover:opacity-100 hover:bg-red-500/20 rounded transition-all"
                  title="Delete table"
                >
                  <Trash2 size={14} className="text-red-400" />
                </button>
              </div>
            ))
          )}
        </nav>
      </aside>

      <input
        ref={fileInputRef}
        type="file"
        accept=".csv"
        onChange={handleCSVFileChange}
        className="hidden"
      />

      {/* Main Grid Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {selectedTable ? (
          <>
            <header className="px-5 py-4 border-b border-slate-800 bg-slate-900 flex flex-col gap-3">
              <div className="flex items-center justify-between">
                <h2 className="text-2xl font-bold text-white capitalize flex items-center gap-2">
                  {selectedTable}
                  <span className="text-sm font-normal text-slate-500 ml-2 border border-slate-700 px-2 py-0.5 rounded-full">
                    {data ? data.length : 0} loaded · {total || 0} total
                  </span>
                </h2>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleCSVFileSelect}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors text-sm flex items-center gap-2"
                  >
                    <Upload size={14} /> Import CSV
                  </button>
                  <button
                    onClick={() => setShowCreateModal(true)}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors text-sm flex items-center gap-2"
                  >
                    <Plus size={14} /> New Table
                  </button>
                  <button
                    onClick={() => refreshTableData(selectedTable)}
                    className="px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded-lg transition-colors text-sm flex items-center gap-2"
                    title="Refresh table data"
                  >
                    <RefreshCw size={14} /> Refresh
                  </button>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-4 text-xs text-slate-400">
                <div className="flex items-center gap-2">
                  <Sparkles size={12} className="text-green-400" />
                  <span>Last import: {formatTimestamp(lastImportMap[selectedTable])}</span>
                </div>
                <div className="flex items-center gap-2">
                  <RefreshCw size={12} className="text-slate-500" />
                  <span>Last refreshed: {formatTimestamp(lastRefreshedAt)}</span>
                </div>
              </div>

              {/* Schema Info Badge */}
              <div className="flex gap-2 overflow-x-auto pb-1">
                {schema && schema[selectedTable] && schema[selectedTable].map(col => (
                  <span key={col.name} className="text-xs font-mono text-slate-400 bg-slate-800 px-2 py-1 rounded whitespace-nowrap border border-slate-700">
                    {col.name}: {col.type}
                  </span>
                ))}
              </div>
            </header>

            <div className="flex-1 overflow-auto p-4 bg-slate-900">
              <GlideTable 
                data={data || []}
                tableName={selectedTable}
                schema={schema?.[selectedTable] || []}
                total={total}
                loadMore={loadMore}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-slate-900">
            <div className="text-center">
              <Database size={64} className="mx-auto mb-4 text-slate-700" />
              <h3 className="text-xl font-semibold text-slate-400 mb-2">
                {tableList.length === 0 ? 'No tables yet' : 'No table selected'}
              </h3>
              <p className="text-slate-600 mb-6">
                {tableList.length === 0 
                  ? 'Get started by creating a table or importing from CSV' 
                  : 'Select a table from the sidebar or create a new one'}
              </p>
              <div className="flex gap-3 justify-center">
                <button
                  onClick={() => setShowCreateModal(true)}
                  className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
                >
                  Create New Table
                </button>
                <button
                  onClick={handleCSVFileSelect}
                  className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors flex items-center gap-2"
                >
                  <Upload size={16} />
                  Import CSV
                </button>
              </div>
            </div>
          </div>
        )}
      </main>

      {/* Create Table Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-lg max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-800">
              <h2 className="text-xl font-bold text-white">Create New Table</h2>
            </div>
            
            <div className="p-6 overflow-y-auto flex-1">
              <div className="mb-6">
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Table Name
                </label>
                <input
                  type="text"
                  value={newTableName}
                  onChange={(e) => setNewTableName(e.target.value)}
                  placeholder="e.g., users, products, orders"
                  className="w-full bg-slate-800 text-slate-100 px-4 py-2 rounded border border-slate-700 focus:outline-none focus:border-green-500"
                />
              </div>

              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-medium text-slate-300">
                    Columns
                  </label>
                  <button
                    onClick={addColumn}
                    className="text-sm text-green-500 hover:text-green-400 flex items-center gap-1"
                  >
                    <Plus size={16} /> Add Column
                  </button>
                </div>
                
                <div className="space-y-2">
                  {newTableColumns.map((col, index) => (
                    <div key={index} className="flex gap-2 items-start">
                      <input
                        type="text"
                        value={col.name}
                        onChange={(e) => updateColumn(index, 'name', e.target.value)}
                        placeholder="Column name"
                        className="flex-1 bg-slate-800 text-slate-100 px-3 py-2 rounded border border-slate-700 focus:outline-none focus:border-green-500"
                      />
                      <select
                        value={col.type}
                        onChange={(e) => updateColumn(index, 'type', e.target.value)}
                        className="bg-slate-800 text-slate-100 px-3 py-2 rounded border border-slate-700 focus:outline-none focus:border-green-500"
                      >
                        <option value="TEXT">TEXT</option>
                        <option value="INTEGER">INTEGER</option>
                        <option value="REAL">REAL</option>
                        <option value="BOOLEAN">BOOLEAN</option>
                        <option value="DATE">DATE</option>
                        <option value="DATETIME">DATETIME</option>
                        <option value="BLOB">BLOB</option>
                      </select>
                      <label className="flex items-center gap-2 text-sm text-slate-400 whitespace-nowrap px-2">
                        <input
                          type="checkbox"
                          checked={col.notNull || false}
                          onChange={(e) => updateColumn(index, 'notNull', e.target.checked)}
                          className="rounded"
                        />
                        Required
                      </label>
                      {newTableColumns.length > 1 && (
                        <button
                          onClick={() => removeColumn(index)}
                          className="p-2 hover:bg-red-500/20 rounded text-red-400"
                        >
                          <Trash2 size={16} />
                        </button>
                      )}
                    </div>
                  ))}
                </div>
                <p className="text-xs text-slate-500 mt-2">
                  Note: An 'id' column will be automatically added as the primary key.
                </p>
              </div>
            </div>

            <div className="p-6 border-t border-slate-800 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewTableName('');
                  setNewTableColumns([{ name: 'name', type: 'TEXT', notNull: false }]);
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateTable}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
              >
                Create Table
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Table Confirmation */}
      <ConfirmDialog
        isOpen={!!deleteConfirm}
        onConfirm={confirmDeleteTable}
        onCancel={() => setDeleteConfirm(null)}
        title="Delete Table"
        message={`Are you sure you want to delete the table "${deleteConfirm}"? This action cannot be undone.`}
        confirmLabel="Delete"
        confirmVariant="danger"
      />

      {/* CSV Import Wizard */}
      <CsvImportModal
        preview={csvPreview}
        isImporting={importing}
        tableName={csvTargetMode === 'existing'
          ? (csvTargetTable || selectedTable || 'Select a table')
          : (csvTargetName || (csvPreview ? deriveTableName(csvPreview.fileName) : 'New Table'))
        }
        mode={csvTargetMode}
        tableList={tableList}
        newTableName={csvTargetName}
        existingTable={csvTargetTable || selectedTable}
        onModeChange={setCsvTargetMode}
        onNewTableNameChange={setCsvTargetName}
        onExistingTableChange={setCsvTargetTable}
        onClose={() => {
          setCsvPreview(null);
        }}
        onConfirm={handleConfirmImport}
      />
    </div>
  );
};
