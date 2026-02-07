import React, { useState, useEffect, useCallback, useRef } from 'react';
import { Loader2, Plus, Upload, Undo, Redo } from 'lucide-react';
import { useDatabase } from '../../hooks/useDatabase';
import { useGridState } from '../../hooks/useGridState';
import { useSpreadsheetNavigation } from '../../hooks/useSpreadsheetNavigation';
import { useColumnManagement } from '../../hooks/useColumnManagement';
import { useVirtualScroll } from '../../hooks/useVirtualScroll';
import { ColumnDefinition } from '../../types';
import { parseCSV, generateCSV, sanitizeHeader } from '../../utils/csv';
import { GridToolbar } from './GridToolbar';
import { ResizableHeader } from './ResizableHeader';
import { SpreadsheetCell } from './SpreadsheetCell';
import { GhostRow } from './Rows';
import { CsvImportModal } from './CsvImportModal';
import { ConfirmDialog } from '../Modal';

interface SpreadsheetDataGridProps {
  data: any[] | null;
  total?: number;
  loadMore?: () => void;
  isLoading?: boolean;
  tableName?: string;
  schema?: ColumnDefinition[];
  renderRowActions?: (row: any) => React.ReactNode;
}

export const SpreadsheetDataGrid: React.FC<SpreadsheetDataGridProps> = ({ 
  data, 
  total,
  loadMore,
  isLoading = false, 
  tableName = 'table_name', 
  schema,
  renderRowActions
}) => {
  const { rpc, addToast } = useDatabase();
  const [showFilters, setShowFilters] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [deleteRowId, setDeleteRowId] = useState<any>(null);
  const tableContainerRef = useRef<HTMLDivElement>(null);
  
  // Grid State Hook (Sort/Filter)
  const {
    sortField,
    sortDirection,
    filterValue,
    setFilterValue,
    handleSort,
    processedData
  } = useGridState(data);

  const headers = processedData.length > 0 ? Object.keys(processedData[0]) : (schema?.map(c => c.name) || []);

  // Column Management
  const columnManagement = useColumnManagement(tableName, headers);
  const {
    columnOrder,
    getColumnWidth,
    isFrozen,
    setColumnWidth,
    reorderColumns,
    toggleFrozenColumn
  } = columnManagement;

  // Spreadsheet Navigation
  const spreadsheetNav = useSpreadsheetNavigation(
    processedData.length,
    headers.length,
    handleCellUpdate
  );

  const {
    selectedCell,
    editingCell,
    setSelectedCell,
    setEditingCell,
    handleKeyDown,
    undoStack,
    redoStack,
    addToUndoStack,
    undo,
    redo,
    handleCopy,
    handlePaste
  } = spreadsheetNav;

  // Virtual Scroll
  const hasMore = total !== undefined && data && data.length < total;
  const virtualScroll = useVirtualScroll(
    processedData.length,
    loadMore,
    hasMore,
    { rowHeight: 40, overscan: 10, loadMoreThreshold: 0.8 }
  );

  const {
    containerRef,
    visibleRows,
    totalHeight,
    offsetY,
    handleScroll,
    rowHeight
  } = virtualScroll;

  // CSV import wizard state
  const [csvPreview, setCsvPreview] = useState<any>(null);
  const [importProgress, setImportProgress] = useState(false);

  // Keyboard event listener
  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  // Handle cell updates with undo stack
  async function handleCellUpdate(rowId: any, field: string, value: any) {
    const row = processedData.find(r => r.id === rowId);
    if (row) {
      addToUndoStack({
        rowId,
        field,
        oldValue: row[field],
        newValue: value
      });
    }

    try {
      await rpc('updateRow', { table: tableName, id: rowId, field, value });
    } catch (error) {
      console.error('Failed to update cell:', error);
    }
  }

  const handleAddRow = async (newRow: Record<string, any>) => {
    try {
      if (tableName === 'tasks') {
        await rpc('createTask', { title: newRow.title || 'New Task' });
      } else {
        await rpc('batchInsert', { table: tableName, rows: [newRow] });
      }
    } catch (error) {
      console.error('Failed to add row:', error);
    }
  };

  const handleDeleteRow = async (rowId: any) => {
    try {
      if (tableName === 'tasks') {
        await rpc('deleteTask', { id: rowId });
      } else {
        await rpc('deleteRow', { table: tableName, id: rowId });
      }
    } catch (error) {
      console.error('Failed to delete row:', error);
      addToast('Failed to delete row', 'error');
    }
  };

  const handleConfirmDelete = async () => {
    if (deleteRowId !== null) {
      await handleDeleteRow(deleteRowId);
      setDeleteRowId(null);
    }
  };

  // Drag & Drop
  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = () => {
    setIsDragging(false);
  };

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault();
    setIsDragging(false);
    const files = Array.from(e.dataTransfer.files);
    const csvFile = files.find(f => f.name.endsWith('.csv'));
    if (csvFile) {
      await handleCSVImport(csvFile);
    }
  };

  const handleCSVImport = async (file: File) => {
    try {
      const { headers: rawHeaders, rows: parsedRows } = await parseCSV(file);
      const headers = rawHeaders.map(h => sanitizeHeader(h));
      const rows = parsedRows.map(values => {
        const row: Record<string, any> = {};
        headers.forEach((header, idx) => {
          let value: any = values[idx] || '';
          if (value && !isNaN(Number(value))) {
            value = Number(value);
          } else if (value.toLowerCase() === 'true') {
            value = true;
          } else if (value.toLowerCase() === 'false') {
            value = false;
          }
          row[header] = value;
        });
        return row;
      });

      const inferredTypes: Record<string, string> = {};
      for (const header of headers) {
        const sampleValues = rows.slice(0, 50).map(r => r[header]).filter(v => v !== '' && v !== null);
        if (sampleValues.every(v => typeof v === 'number' && Number.isInteger(v))) {
          inferredTypes[header] = 'INTEGER';
        } else if (sampleValues.every(v => typeof v === 'number')) {
          inferredTypes[header] = 'REAL';
        } else if (sampleValues.every(v => typeof v === 'boolean')) {
          inferredTypes[header] = 'BOOLEAN';
        } else {
          inferredTypes[header] = 'TEXT';
        }
      }

      setCsvPreview({ headers, rows, inferredTypes, fileName: file.name });
    } catch (error: any) {
      addToast('CSV parse failed: ' + (error.message || 'Unknown error'), 'error');
    }
  };

  const handleConfirmImport = async () => {
    if (!csvPreview) return;
    try {
      setImportProgress(true);
      await rpc('batchInsert', { table: tableName, rows: csvPreview.rows });
      addToast(`Successfully imported ${csvPreview.rows.length} rows`, 'success');
    } catch (error: any) {
      addToast('CSV import failed: ' + (error.message || 'Unknown error'), 'error');
    } finally {
      setCsvPreview(null);
      setImportProgress(false);
    }
  };

  const handleCSVExport = () => {
    if (!data || data.length === 0) {
      addToast('No data to export', 'error');
      return;
    }
    try {
      const headers = Object.keys(data[0]);
      const csvContent = generateCSV(headers, data);
      const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
      const link = document.createElement('a');
      const url = URL.createObjectURL(blob);
      link.setAttribute('href', url);
      link.setAttribute('download', `${tableName}_${new Date().toISOString().split('T')[0]}.csv`);
      link.style.visibility = 'hidden';
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(url);
    } catch (error: any) {
      addToast('CSV export failed: ' + (error.message || 'Unknown error'), 'error');
    }
  };

  // Copy/Paste handlers
  const handleCopyEvent = useCallback((e: ClipboardEvent) => {
    if (selectedCell && !editingCell) {
      e.preventDefault();
      handleCopy(processedData, headers);
    }
  }, [selectedCell, editingCell, processedData, headers, handleCopy]);

  const handlePasteEvent = useCallback(async (e: ClipboardEvent) => {
    if (selectedCell && !editingCell) {
      e.preventDefault();
      await handlePaste(processedData, headers, (rowIndex, field, value) => {
        const row = processedData[rowIndex];
        if (row) {
          handleCellUpdate(row.id, field, value);
        }
      });
    }
  }, [selectedCell, editingCell, processedData, headers, handlePaste]);

  useEffect(() => {
    document.addEventListener('copy', handleCopyEvent);
    document.addEventListener('paste', handlePasteEvent);
    return () => {
      document.removeEventListener('copy', handleCopyEvent);
      document.removeEventListener('paste', handlePasteEvent);
    };
  }, [handleCopyEvent, handlePasteEvent]);

  // Loading state
  if (isLoading || data === null) {
    return (
      <div className="flex items-center justify-center py-12">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  const orderedHeaders = columnOrder.filter(h => headers.includes(h));
  const filtersCount = filterValue ? 1 : 0;

  return (
    <div 
      className="w-full"
      onDragOver={handleDragOver}
      onDragLeave={handleDragLeave}
      onDrop={handleDrop}
    >
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-4">
        <GridToolbar
          showFilters={showFilters}
          filtersCount={filtersCount}
          rowCount={total ?? processedData.length}
          filterValue={filterValue}
          onToggleFilters={() => setShowFilters(!showFilters)}
          onImport={handleCSVImport}
          onExport={handleCSVExport}
          onSearchChange={setFilterValue}
        />
        
        {/* Undo/Redo Buttons */}
        <div className="flex gap-2 ml-auto">
          <button
            onClick={undo}
            disabled={undoStack.length === 0}
            className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Undo (Ctrl+Z)"
          >
            <Undo size={16} />
          </button>
          <button
            onClick={redo}
            disabled={redoStack.length === 0}
            className="flex items-center gap-2 px-3 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
            title="Redo (Ctrl+Y)"
          >
            <Redo size={16} />
          </button>
        </div>
      </div>

      {/* Drag & Drop Overlay */}
      {isDragging && (
        <div className="fixed inset-0 bg-slate-900/80 backdrop-blur-sm z-50 flex items-center justify-center">
          <div className="bg-slate-800 border-2 border-dashed border-green-500 rounded-lg p-12 text-center">
            <Upload size={48} className="mx-auto mb-4 text-green-500" />
            <h3 className="text-xl font-bold text-white mb-2">Drop CSV File Here</h3>
            <p className="text-slate-400">Release to import data into {tableName}</p>
          </div>
        </div>
      )}

      {/* Data Grid with Virtual Scrolling */}
      <div 
        ref={containerRef}
        className="w-full overflow-auto rounded-lg border border-slate-700 shadow-sm"
        style={{ maxHeight: '70vh' }}
        onScroll={handleScroll}
      >
        <div style={{ height: `${totalHeight}px`, position: 'relative' }}>
          <table className="w-full text-left text-sm text-slate-400" style={{ tableLayout: 'fixed' }}>
            <thead className="bg-slate-800 text-slate-200 uppercase tracking-wider font-semibold sticky top-0 z-10">
              <tr>
                {orderedHeaders.map((header, idx) => (
                  <ResizableHeader
                    key={header}
                    header={header}
                    sortColumn={sortField}
                    sortDirection={sortDirection}
                    width={getColumnWidth(header)}
                    isFrozen={isFrozen(header)}
                    onSort={handleSort}
                    onResize={setColumnWidth}
                    onReorder={reorderColumns}
                    onToggleFreeze={toggleFrozenColumn}
                    columnIndex={idx}
                    totalColumns={orderedHeaders.length}
                  />
                ))}
                <th className="px-6 py-3 border-b border-slate-700 w-24 sticky right-0 bg-slate-800">
                  <span className="sr-only">Actions</span>
                </th>
              </tr>
            </thead>
            <tbody 
              className="divide-y divide-slate-800 bg-slate-900"
              style={{ 
                transform: `translateY(${offsetY}px)`,
                position: 'relative'
              }}
            >
              {visibleRows.map((rowIndex) => {
                const row = processedData[rowIndex];
                if (!row) return null;

                return (
                  <tr key={row.id || rowIndex} className="hover:bg-slate-800/50">
                    {orderedHeaders.map((header, colIndex) => {
                      const columnDef = schema?.find(col => col.name === header);
                      const columnType = columnDef?.type || 'TEXT';
                      const isSelected = selectedCell?.rowIndex === rowIndex && selectedCell?.colIndex === colIndex;
                      const isEditing = editingCell?.rowIndex === rowIndex && editingCell?.colIndex === colIndex;

                      return (
                        <td 
                          key={header}
                          className={`border-b border-slate-800 ${isFrozen(header) ? 'sticky left-0 z-10 bg-slate-900' : ''}`}
                          style={{ 
                            width: `${getColumnWidth(header)}px`,
                            height: `${rowHeight}px`,
                            padding: 0
                          }}
                        >
                          <SpreadsheetCell
                            value={row[header]}
                            rowId={row.id}
                            rowIndex={rowIndex}
                            colIndex={colIndex}
                            field={header}
                            tableName={tableName}
                            columnType={columnType}
                            isSelected={isSelected}
                            isEditing={isEditing}
                            onUpdate={handleCellUpdate}
                            onSelect={() => setSelectedCell({ rowIndex, colIndex })}
                            onStartEdit={() => setEditingCell({ rowIndex, colIndex })}
                            onStopEdit={() => setEditingCell(null)}
                          />
                        </td>
                      );
                    })}
                    <td className="px-6 py-4 w-24 sticky right-0 bg-slate-900 border-b border-slate-800">
                      <button
                        onClick={() => setDeleteRowId(row.id)}
                        className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors"
                      >
                        Delete
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Empty state */}
      {processedData.length === 0 && (
        <div className="p-12 text-center bg-slate-900/50 rounded-lg mt-4">
          <Plus className="w-16 h-16 mx-auto mb-4 text-slate-500" />
          <h3 className="text-lg font-semibold text-white mb-2">No records yet!</h3>
          <p className="text-sm text-slate-400">Start by importing a CSV file or adding records.</p>
        </div>
      )}

      {/* Modals */}
      <CsvImportModal
        preview={csvPreview}
        isImporting={importProgress}
        tableName={tableName}
        onClose={() => setCsvPreview(null)}
        onConfirm={handleConfirmImport}
      />

      <ConfirmDialog
        isOpen={deleteRowId !== null}
        onConfirm={handleConfirmDelete}
        onCancel={() => setDeleteRowId(null)}
        title="Delete Row"
        message="Are you sure you want to delete this row? This action cannot be undone."
        confirmLabel="Delete"
        confirmVariant="danger"
      />
    </div>
  );
};
