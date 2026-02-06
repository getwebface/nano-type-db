import React, { useState, useEffect } from 'react';
import { useRealtimeQuery, useDatabase } from '../../hooks/useDatabase';
import { DataGrid } from '../DataGrid';
import { Table2, Plus, Trash2, Database } from 'lucide-react';

export const TablesView: React.FC = () => {
  const { schema, rpc } = useDatabase();
  const [selectedTable, setSelectedTable] = useState<string>('');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newTableName, setNewTableName] = useState('');
  const [newTableColumns, setNewTableColumns] = useState([{ name: 'name', type: 'TEXT', notNull: false }]);
  
  useEffect(() => {
    if (schema) {
      const tables = Object.keys(schema);
      if (tables.length > 0 && !tables.includes(selectedTable)) {
        setSelectedTable(tables[0]);
      }
    }
  }, [schema, selectedTable]);

  const data = useRealtimeQuery(selectedTable);
  const tableList = schema ? Object.keys(schema) : [];

  const handleCreateTable = async () => {
    if (!newTableName.trim()) {
      alert('Please enter a table name');
      return;
    }

    if (newTableColumns.length === 0 || !newTableColumns[0].name) {
      alert('Please add at least one column');
      return;
    }

    try {
      await rpc('createTable', {
        tableName: newTableName,
        columns: newTableColumns
      });
      
      setShowCreateModal(false);
      setNewTableName('');
      setNewTableColumns([{ name: 'name', type: 'TEXT', notNull: false }]);
      setSelectedTable(newTableName);
    } catch (error) {
      console.error('Failed to create table:', error);
      alert('Failed to create table: ' + (error as Error).message);
    }
  };

  const handleDeleteTable = async (tableName: string) => {
    if (!confirm(`Are you sure you want to delete the table "${tableName}"? This action cannot be undone.`)) {
      return;
    }

    try {
      await rpc('deleteTable', { tableName });
      if (selectedTable === tableName) {
        setSelectedTable('');
      }
    } catch (error) {
      console.error('Failed to delete table:', error);
      alert('Failed to delete table: ' + (error as Error).message);
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

  return (
    <div className="flex h-full overflow-hidden">
      {/* Tables Sidebar */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Tables</h3>
          <button
            onClick={() => setShowCreateModal(true)}
            className="p-1 hover:bg-slate-800 rounded transition-colors"
            title="Create new table"
          >
            <Plus size={18} className="text-green-500" />
          </button>
        </div>
        
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {tableList.length === 0 ? (
            <div className="px-2 py-4 text-center">
              <Database size={32} className="mx-auto mb-2 text-slate-600" />
              <p className="text-xs text-slate-600 mb-2">No tables found.</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="text-xs text-green-500 hover:text-green-400"
              >
                Create your first table
              </button>
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

      {/* Main Grid Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        {selectedTable ? (
          <>
            <header className="px-8 py-6 border-b border-slate-800 bg-slate-900 flex justify-between items-center">
              <h2 className="text-2xl font-bold text-white capitalize flex items-center gap-2">
                {selectedTable}
                <span className="text-sm font-normal text-slate-500 ml-2 border border-slate-700 px-2 py-0.5 rounded-full">
                  {data ? data.length : 0} records
                </span>
              </h2>
              
              {/* Schema Info Badge */}
              <div className="hidden md:flex gap-2">
                {schema && schema[selectedTable] && schema[selectedTable].map(col => (
                  <span key={col.name} className="text-xs font-mono text-slate-500 bg-slate-800 px-2 py-1 rounded">
                    {col.name}: {col.type}
                  </span>
                ))}
              </div>
            </header>

            <div className="flex-1 overflow-auto p-8 bg-slate-900">
              <DataGrid 
                data={data} 
                tableName={selectedTable} 
                schema={schema?.[selectedTable]}
              />
            </div>
          </>
        ) : (
          <div className="flex-1 flex items-center justify-center bg-slate-900">
            <div className="text-center">
              <Database size={64} className="mx-auto mb-4 text-slate-700" />
              <h3 className="text-xl font-semibold text-slate-400 mb-2">No table selected</h3>
              <p className="text-slate-600 mb-4">Select a table from the sidebar or create a new one</p>
              <button
                onClick={() => setShowCreateModal(true)}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
              >
                Create New Table
              </button>
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
    </div>
  );
};
