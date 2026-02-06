import React, { useState } from 'react';
import { Loader2, Plus, Upload } from 'lucide-react';
import { useDatabase } from '../../hooks/useDatabase';
import { useGridState } from '../../hooks/useGridState';
import { ColumnDefinition } from '../../types';
import { parseCSV, generateCSV, sanitizeHeader } from '../../utils/csv';
import { GridHeader } from './GridHeader';
import { GridToolbar } from './GridToolbar';
import { GridRow, SkeletonRow, GhostRow } from './Rows';
import { CsvImportModal } from './CsvImportModal';

interface DataGridProps {
    data: any[] | null;
    total?: number;
    loadMore?: () => void;
    isLoading?: boolean;
    tableName?: string;
    schema?: ColumnDefinition[];
    renderRowActions?: (row: any) => React.ReactNode;
}

export const DataGrid: React.FC<DataGridProps> = ({ 
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
    
    // Grid State Hook (Sort/Filter)
    const {
        sortField,
        sortDirection,
        filterValue,
        setSortField,
        setSortDirection,
        setFilterValue,
        handleSort,
        processedData
    } = useGridState(data);

    // Filter count (placeholder until advanced filters implemented)
    const filtersCount = filterValue ? 1 : 0;

    // CSV import wizard state
    const [csvPreview, setCsvPreview] = useState<{
        headers: string[];
        headerMapping: { original: string; sanitized: string }[];
        rows: Record<string, any>[];
        inferredTypes: Record<string, string>;
        fileName: string;
    } | null>(null);
    const [importProgress, setImportProgress] = useState(false);

    const handleCellUpdate = async (rowId: any, field: string, value: any) => {
        try {
            await rpc('updateRow', { table: tableName, id: rowId, field, value });
        } catch (error) {
            console.error('Failed to update cell:', error);
        }
    };

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
            
            // Sanitize headers
            const headers = rawHeaders.map(h => sanitizeHeader(h));
            const headerMapping = rawHeaders.map((raw, idx) => ({
                original: raw,
                sanitized: headers[idx]
            })).filter(mapping => mapping.original !== mapping.sanitized);
            
            // Map rows to objects
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

            // Infer types
            const inferredTypes: Record<string, string> = {};
            for (const header of headers) {
                const sampleValues = rows.slice(0, 50).map(r => r[header]).filter(v => v !== '' && v !== null && v !== undefined);
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

            setCsvPreview({ headers, headerMapping, rows, inferredTypes, fileName: file.name });
        } catch (error: any) {
            console.error('CSV parse failed:', error);
            addToast('CSV parse failed: ' + (error.message || 'Unknown error'), 'error');
        }
    };

    const handleConfirmImport = async () => {
        if (!csvPreview) return;
        const { rows } = csvPreview;

        try {
            setImportProgress(true);
            const result = await rpc('batchInsert', { table: tableName, rows });
            if (result && result.data) {
                addToast(`Successfully imported ${result.data.inserted} of ${result.data.total} rows`, 'success');
            } else {
                addToast(`Successfully imported ${rows.length} rows`, 'success');
            }
        } catch (error: any) {
            console.error('CSV import failed:', error);
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
            
            const safeTableName = tableName.replace(/[^a-zA-Z0-9_-]/g, '_');
            const blob = new Blob([csvContent], { type: 'text/csv;charset=utf-8;' });
            const link = document.createElement('a');
            const url = URL.createObjectURL(blob);
            
            link.setAttribute('href', url);
            link.setAttribute('download', `${safeTableName}_${new Date().toISOString().split('T')[0]}.csv`);
            link.style.visibility = 'hidden';
            
            document.body.appendChild(link);
            link.click();
            document.body.removeChild(link);
            URL.revokeObjectURL(url);
        } catch (error: any) {
            console.error('CSV export failed:', error);
            addToast('CSV export failed: ' + (error.message || 'Unknown error'), 'error');
        }
    };

    // Loading state
    if (isLoading || data === null) {
        return (
            <div className="w-full overflow-hidden rounded-lg border border-slate-700 shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-slate-400">
                        <thead className="bg-slate-800 text-slate-200 uppercase tracking-wider font-semibold">
                            <tr>
                                {Array.from({ length: 3 }).map((_, idx) => (
                                    <th key={idx} className="px-6 py-3 border-b border-slate-700">
                                        <div className="h-4 bg-slate-700 rounded w-20 animate-pulse"></div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800 bg-slate-900">
                            {Array.from({ length: 5 }).map((_, idx) => (
                                <SkeletonRow key={idx} columns={3} />
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="flex items-center justify-center py-4 bg-slate-900 border-t border-slate-800">
                    <Loader2 className="w-5 h-5 text-green-500 animate-spin mr-2" />
                    <span className="text-sm text-slate-400">Loading data...</span>
                </div>
            </div>
        );
    }

    const headers = data.length > 0 ? Object.keys(data[0]) : (schema?.map(c => c.name) || []);

    // If headers is empty and schema is empty, and data is empty, we can't show much
    // But processedData uses data.
    
    // Virtual Pagination Logic
    const hasMore = total !== undefined && data.length < total;

    return (
        <div 
            className="w-full"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
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

            {/* Data Grid */}
            <div className="w-full overflow-hidden rounded-lg border border-slate-700 shadow-sm">
                <div className="overflow-x-auto max-h-[70vh] relative">
                    <table className="w-full text-left text-sm text-slate-400">
                        <GridHeader 
                            headers={headers}
                            sortColumn={sortField}
                            sortDirection={sortDirection}
                            onSort={handleSort}
                        />
                        <tbody className="divide-y divide-slate-800 bg-slate-900">
                            {processedData.map((row, idx) => (
                                <GridRow
                                    key={row.id || idx}
                                    row={row}
                                    headers={headers}
                                    tableName={tableName}
                                    schema={schema}
                                    onUpdate={handleCellUpdate}
                                    onDelete={handleDeleteRow}
                                    renderRowActions={renderRowActions}
                                />
                            ))}
                            
                            {/* Ghost Row */}
                            {headers.length > 0 && (
                                <GhostRow
                                    headers={headers}
                                    tableName={tableName}
                                    onAdd={handleAddRow}
                                />
                            )}
                        </tbody>
                    </table>

                    {/* Load More Trigger */}
                    {hasMore && loadMore && (
                        <div className="p-4 flex justify-center border-t border-slate-800 bg-slate-900">
                             <button
                                onClick={loadMore}
                                className="text-sm text-green-500 hover:text-green-400 flex items-center gap-2"
                             >
                                 Load more rows
                             </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Empty state */}
            {processedData.length === 0 && !hasMore && (
                <div className="p-12 text-center bg-slate-900/50 rounded-lg mt-4">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-800 border border-slate-700 mb-4">
                        <Plus className="w-8 h-8 text-slate-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-white mb-2">No records yet!</h3>
                    <p className="text-sm text-slate-400 mb-6">
                        Start by adding your first record above or import a CSV file.
                    </p>
                </div>
            )}

            <CsvImportModal
                preview={csvPreview}
                isImporting={importProgress}
                tableName={tableName}
                onClose={() => setCsvPreview(null)}
                onConfirm={handleConfirmImport}
            />
        </div>
    );
};
