import React, { useState, useRef, useEffect } from 'react';
import { Plus, Loader2, Filter, ArrowUpDown, Upload, Download, Check, X, ChevronDown, Calendar, FileJson } from 'lucide-react';
import { useDatabase } from '../hooks/useDatabase';
import { ColumnDefinition } from '../types';
import { ConfirmDialog } from './Modal';

interface DataGridProps {
    data: any[] | null;
    isLoading?: boolean;
    tableName?: string;
    schema?: ColumnDefinition[];
}

const SkeletonRow: React.FC<{ columns: number }> = ({ columns }) => (
    <tr className="animate-pulse">
        {Array.from({ length: columns }).map((_, idx) => (
            <td key={idx} className="px-6 py-4">
                <div className="h-4 bg-slate-800 rounded"></div>
            </td>
        ))}
    </tr>
);

// Cell component with inline editing
const EditableCell: React.FC<{
    value: any;
    rowId: any;
    field: string;
    tableName: string;
    columnType: string;
    onUpdate: (rowId: any, field: string, value: any) => void;
}> = ({ value, rowId, field, tableName, columnType, onUpdate }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(value);
    const inputRef = useRef<HTMLInputElement | HTMLTextAreaElement>(null);

    useEffect(() => {
        if (isEditing && inputRef.current) {
            inputRef.current.focus();
            if (inputRef.current instanceof HTMLInputElement) {
                inputRef.current.select();
            }
        }
    }, [isEditing]);

    const handleSave = () => {
        if (editValue !== value) {
            onUpdate(rowId, field, editValue);
        }
        setIsEditing(false);
    };

    const handleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            handleSave();
        } else if (e.key === 'Escape') {
            setEditValue(value);
            setIsEditing(false);
        }
    };

    // Special rendering for different column types
    const renderValue = () => {
        const lowerType = columnType.toLowerCase();
        
        // Boolean/checkbox
        if (lowerType.includes('bool') || lowerType === 'integer' && (value === 0 || value === 1 || value === true || value === false)) {
            const boolValue = Boolean(value);
            return (
                <button
                    onClick={() => {
                        onUpdate(rowId, field, boolValue ? 0 : 1);
                    }}
                    className="flex items-center gap-2 hover:opacity-80 transition-opacity"
                >
                    <div className={`w-4 h-4 rounded border-2 flex items-center justify-center ${
                        boolValue ? 'bg-green-500 border-green-500' : 'bg-slate-700 border-slate-600'
                    }`}>
                        {boolValue && <Check size={12} className="text-white" />}
                    </div>
                </button>
            );
        }
        
        // Date rendering
        if (lowerType.includes('date') || lowerType.includes('time')) {
            try {
                const date = new Date(value);
                if (!isNaN(date.getTime())) {
                    return (
                        <div className="flex items-center gap-2 text-slate-300">
                            <Calendar size={14} className="text-slate-500" />
                            {date.toLocaleDateString()} {date.toLocaleTimeString()}
                        </div>
                    );
                }
            } catch (e) {
                // Fall through to default rendering
            }
        }
        
        // JSON rendering
        if (lowerType.includes('json') || (typeof value === 'object' && value !== null)) {
            return (
                <div className="flex items-center gap-2 text-blue-400 cursor-pointer hover:text-blue-300">
                    <FileJson size={14} />
                    <span className="font-mono text-xs">{'{...}'}</span>
                </div>
            );
        }
        
        // Status/enum rendering (detect by field name or specific values)
        if (field === 'status' || lowerType.includes('enum')) {
            const statusColors: Record<string, string> = {
                'pending': 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
                'completed': 'bg-green-500/20 text-green-400 border-green-500/30',
                'failed': 'bg-red-500/20 text-red-400 border-red-500/30',
                'active': 'bg-blue-500/20 text-blue-400 border-blue-500/30',
                'inactive': 'bg-slate-500/20 text-slate-400 border-slate-500/30',
            };
            const colorClass = statusColors[String(value).toLowerCase()] || 'bg-slate-500/20 text-slate-400 border-slate-500/30';
            return (
                <span className={`px-2 py-1 rounded-full text-xs font-medium border ${colorClass}`}>
                    {value}
                </span>
            );
        }
        
        // Default text rendering
        return <span className="text-slate-300">{String(value || '')}</span>;
    };

    if (isEditing) {
        return (
            <input
                ref={inputRef as React.RefObject<HTMLInputElement>}
                type="text"
                value={editValue}
                onChange={(e) => setEditValue(e.target.value)}
                onBlur={handleSave}
                onKeyDown={handleKeyDown}
                className="w-full bg-slate-800 text-slate-100 px-2 py-1 rounded border border-green-500 focus:outline-none focus:ring-2 focus:ring-green-500"
            />
        );
    }

    return (
        <div
            onDoubleClick={() => setIsEditing(true)}
            className="cursor-pointer hover:bg-slate-800/30 px-2 py-1 rounded transition-colors"
            title="Double-click to edit"
        >
            {renderValue()}
        </div>
    );
};

// Ghost row for adding new records
const GhostRow: React.FC<{
    headers: string[];
    tableName: string;
    onAdd: (newRow: Record<string, any>) => void;
}> = ({ headers, tableName, onAdd }) => {
    const [newRow, setNewRow] = useState<Record<string, any>>({});
    const [isActive, setIsActive] = useState(false);

    const handleKeyDown = (e: React.KeyboardEvent, field: string) => {
        if (e.key === 'Enter') {
            e.preventDefault();
            // Check if we have at least one field filled
            const hasData = Object.values(newRow).some(v => v !== '' && v !== null && v !== undefined);
            if (hasData) {
                onAdd(newRow);
                setNewRow({});
                setIsActive(false);
            }
        } else if (e.key === 'Escape') {
            setNewRow({});
            setIsActive(false);
        }
    };

    return (
        <tr className="bg-slate-800/30 hover:bg-slate-800/50 transition-colors border-t-2 border-dashed border-slate-700">
            {headers.map((header) => (
                <td key={header} className="px-6 py-4">
                    <input
                        type="text"
                        placeholder={isActive ? `Enter ${header}...` : '+'}
                        value={newRow[header] || ''}
                        onChange={(e) => setNewRow({ ...newRow, [header]: e.target.value })}
                        onFocus={() => setIsActive(true)}
                        onKeyDown={(e) => handleKeyDown(e, header)}
                        className="w-full bg-transparent text-slate-300 placeholder-slate-600 focus:bg-slate-800 px-2 py-1 rounded border border-transparent focus:border-green-500 focus:outline-none transition-all"
                    />
                </td>
            ))}
        </tr>
    );
};

export const DataGrid: React.FC<DataGridProps> = ({ data, isLoading = false, tableName = 'table_name', schema }) => {
    const { rpc, addToast } = useDatabase();
    const [filters, setFilters] = useState<Array<{ column: string; operator: string; value: string }>>([]);
    const [sortColumn, setSortColumn] = useState<string | null>(null);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>('asc');
    const [showFilters, setShowFilters] = useState(false);
    const [isDragging, setIsDragging] = useState(false);
    const fileInputRef = useRef<HTMLInputElement>(null);

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
                // Use specific createTask method for tasks table
                await rpc('createTask', { title: newRow.title || 'New Task' });
            } else {
                // Use generic batchInsert for other tables
                await rpc('batchInsert', { table: tableName, rows: [newRow] });
            }
        } catch (error) {
            console.error('Failed to add row:', error);
        }
    };

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

    const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && file.name.endsWith('.csv')) {
            await handleCSVImport(file);
        }
    };

    const handleCSVImport = async (file: File) => {
        try {
            const text = await file.text();
            const lines = text.split('\n').filter(line => line.trim());
            
            if (lines.length < 2) {
                addToast('CSV file must contain a header row and at least one data row.', 'error');
                return;
            }

            // Helper function to sanitize field names (matches backend logic)
            const sanitizeIdentifier = (name: string): string => {
                let sanitized = name.toLowerCase();
                sanitized = sanitized.replace(/[^a-z0-9_]/g, '_');
                sanitized = sanitized.replace(/^_+|_+$/g, '');
                if (!/^[a-z_]/.test(sanitized)) {
                    sanitized = '_' + sanitized;
                }
                sanitized = sanitized.replace(/_+/g, '_');
                return sanitized;
            };

            // Improved CSV parser that handles quoted values with commas
            const parseCSVLine = (line: string): string[] => {
                const result: string[] = [];
                let current = '';
                let inQuotes = false;
                
                for (let i = 0; i < line.length; i++) {
                    const char = line[i];
                    
                    if (char === '"') {
                        // Handle escaped quotes ("")
                        if (inQuotes && line[i + 1] === '"') {
                            current += '"';
                            i++; // Skip next quote
                        } else {
                            inQuotes = !inQuotes;
                        }
                    } else if (char === ',' && !inQuotes) {
                        result.push(current.trim());
                        current = '';
                    } else {
                        current += char;
                    }
                }
                
                result.push(current.trim());
                return result;
            };

            const rawHeaders = parseCSVLine(lines[0]);
            
            // Sanitize headers and build mapping
            const headers = rawHeaders.map(h => sanitizeIdentifier(h));
            const headerMapping = rawHeaders.map((raw, idx) => ({
                original: raw,
                sanitized: headers[idx]
            })).filter(mapping => mapping.original !== mapping.sanitized);
            
            const rows = lines.slice(1).map(line => {
                const values = parseCSVLine(line);
                const row: Record<string, any> = {};
                headers.forEach((header, idx) => {
                    // Convert values to appropriate types
                    let value: any = values[idx] || '';
                    
                    // Try to parse as number
                    if (value && !isNaN(Number(value))) {
                        value = Number(value);
                    }
                    // Try to parse as boolean
                    else if (value.toLowerCase() === 'true') {
                        value = true;
                    } else if (value.toLowerCase() === 'false') {
                        value = false;
                    }
                    // Keep as string otherwise
                    
                    row[header] = value;
                });
                return row;
            });

            // Infer column types from data
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

            // Show preview wizard instead of blocking confirm()
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

            // Batch insert
            const result = await rpc('batchInsert', { table: tableName, rows });
            
            // Show success toast
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
            // Get headers from first row
            const headers = Object.keys(data[0]);
            
            // Helper function to escape CSV values
            const escapeCSV = (value: any): string => {
                if (value === null || value === undefined) return '';
                const str = String(value);
                // If value contains comma, quote, or newline, wrap in quotes and escape quotes
                if (str.includes(',') || str.includes('"') || str.includes('\n')) {
                    return `"${str.replace(/"/g, '""')}"`;
                }
                return str;
            };
            
            // Build CSV content
            const csvContent = [
                headers.join(','), // Header row
                ...data.map(row => 
                    headers.map(header => escapeCSV(row[header])).join(',')
                )
            ].join('\n');
            
            // SECURITY: Sanitize table name for filename
            const safeTableName = tableName.replace(/[^a-zA-Z0-9_-]/g, '_');
            
            // Create and download file
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

    const handleSort = (column: string) => {
        if (sortColumn === column) {
            setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc');
        } else {
            setSortColumn(column);
            setSortDirection('asc');
        }
    };

    // Loading state with skeleton
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

    const headers = data.length > 0 ? Object.keys(data[0]) : [];

    // Apply sorting
    let sortedData = [...data];
    if (sortColumn) {
        sortedData.sort((a, b) => {
            const aVal = a[sortColumn];
            const bVal = b[sortColumn];
            const comparison = aVal < bVal ? -1 : aVal > bVal ? 1 : 0;
            return sortDirection === 'asc' ? comparison : -comparison;
        });
    }

    return (
        <div 
            className="w-full"
            onDragOver={handleDragOver}
            onDragLeave={handleDragLeave}
            onDrop={handleDrop}
        >
            {/* Toolbar */}
            <div className="flex items-center gap-2 mb-4">
                <button
                    onClick={() => setShowFilters(!showFilters)}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors border border-slate-700"
                >
                    <Filter size={16} />
                    Filters
                    {filters.length > 0 && (
                        <span className="px-2 py-0.5 bg-green-500 text-white text-xs rounded-full">{filters.length}</span>
                    )}
                </button>
                
                <button
                    onClick={() => fileInputRef.current?.click()}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors border border-slate-700"
                >
                    <Upload size={16} />
                    Import CSV
                </button>
                <input
                    ref={fileInputRef}
                    type="file"
                    accept=".csv"
                    onChange={handleFileSelect}
                    className="hidden"
                />
                
                <button
                    onClick={handleCSVExport}
                    disabled={!data || data.length === 0}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
                >
                    <Download size={16} />
                    Export CSV
                </button>
                
                <div className="text-xs text-slate-500 ml-auto">
                    {data.length} {data.length === 1 ? 'row' : 'rows'}
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

            {/* Filter UI */}
            {showFilters && (
                <div className="mb-4 p-4 bg-slate-800 rounded-lg border border-slate-700">
                    <h3 className="text-sm font-semibold text-slate-300 mb-3">Filters</h3>
                    {/* Simple filter UI - can be expanded */}
                    <div className="text-xs text-slate-500">
                        Filter functionality coming soon...
                    </div>
                </div>
            )}

            {/* Data Grid */}
            <div className="w-full overflow-hidden rounded-lg border border-slate-700 shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-slate-400">
                        <thead className="bg-slate-800 text-slate-200 uppercase tracking-wider font-semibold">
                            <tr>
                                {headers.map((header) => (
                                    <th key={header} className="px-6 py-3 border-b border-slate-700">
                                        <button
                                            onClick={() => handleSort(header)}
                                            className="flex items-center gap-2 hover:text-white transition-colors group"
                                        >
                                            {header}
                                            <ArrowUpDown 
                                                size={14} 
                                                className={`opacity-0 group-hover:opacity-100 transition-opacity ${
                                                    sortColumn === header ? 'opacity-100 text-green-500' : ''
                                                }`}
                                            />
                                        </button>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800 bg-slate-900">
                            {sortedData.map((row, idx) => (
                                <tr key={idx} className="hover:bg-slate-800/50 transition-colors duration-150">
                                    {headers.map((header) => {
                                        const columnDef = schema?.find(col => col.name === header);
                                        const columnType = columnDef?.type || 'TEXT';
                                        
                                        return (
                                            <td key={`${idx}-${header}`} className="px-6 py-4">
                                                <EditableCell
                                                    value={row[header]}
                                                    rowId={row.id || idx}
                                                    field={header}
                                                    tableName={tableName}
                                                    columnType={columnType}
                                                    onUpdate={handleCellUpdate}
                                                />
                                            </td>
                                        );
                                    })}
                                </tr>
                            ))}
                            
                            {/* Ghost Row for Adding Data */}
                            {headers.length > 0 && (
                                <GhostRow
                                    headers={headers}
                                    tableName={tableName}
                                    onAdd={handleAddRow}
                                />
                            )}
                        </tbody>
                    </table>
                </div>
            </div>

            {/* Empty state (when no filters applied) */}
            {data.length === 0 && filters.length === 0 && (
                <div className="p-12 text-center bg-slate-900/50 rounded-lg mt-4">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-800 border border-slate-700 mb-4">
                        <Plus className="w-8 h-8 text-slate-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-white mb-2">No records yet!</h3>
                    <p className="text-sm text-slate-400 mb-6">
                        Start by adding your first record below or import a CSV file.
                    </p>
                </div>
            )}

            {/* CSV Import Preview Wizard */}
            {csvPreview && (
                <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
                    <div className="bg-slate-900 border border-slate-700 rounded-lg max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col">
                        <div className="p-6 border-b border-slate-800 flex items-center justify-between">
                            <div>
                                <h2 className="text-xl font-bold text-white">Import CSV Preview</h2>
                                <p className="text-sm text-slate-400 mt-1">
                                    {csvPreview.fileName} — {csvPreview.rows.length} rows into "{tableName}"
                                </p>
                            </div>
                            <button onClick={() => setCsvPreview(null)} className="p-1 hover:bg-slate-800 rounded transition-colors text-slate-400 hover:text-white">
                                <X size={18} />
                            </button>
                        </div>
                        
                        <div className="p-6 overflow-y-auto flex-1 space-y-4">
                            {/* Column mapping info */}
                            {csvPreview.headerMapping.length > 0 && (
                                <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                                    <p className="text-sm font-medium text-yellow-400 mb-2">Column names will be sanitized:</p>
                                    <div className="space-y-1">
                                        {csvPreview.headerMapping.map(({ original, sanitized }) => (
                                            <p key={original} className="text-xs text-slate-300 font-mono">
                                                "{original}" → "{sanitized}"
                                            </p>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {/* Schema summary */}
                            <div>
                                <p className="text-sm font-medium text-slate-300 mb-2">Columns & Inferred Types</p>
                                <div className="flex flex-wrap gap-2">
                                    {csvPreview.headers.map(h => (
                                        <span key={h} className="text-xs font-mono text-slate-400 bg-slate-800 px-2 py-1 rounded border border-slate-700">
                                            {h}: <span className="text-green-400">{csvPreview.inferredTypes[h]}</span>
                                        </span>
                                    ))}
                                </div>
                            </div>

                            {/* Data preview table */}
                            <div>
                                <p className="text-sm font-medium text-slate-300 mb-2">Data Preview (first 5 rows)</p>
                                <div className="overflow-x-auto rounded border border-slate-700">
                                    <table className="w-full text-left text-xs text-slate-400">
                                        <thead className="bg-slate-800 text-slate-300 uppercase">
                                            <tr>
                                                {csvPreview.headers.map(h => (
                                                    <th key={h} className="px-3 py-2 border-b border-slate-700">{h}</th>
                                                ))}
                                            </tr>
                                        </thead>
                                        <tbody className="divide-y divide-slate-800 bg-slate-900">
                                            {csvPreview.rows.slice(0, 5).map((row, idx) => (
                                                <tr key={idx}>
                                                    {csvPreview.headers.map(h => (
                                                        <td key={h} className="px-3 py-2 max-w-[200px] truncate">{String(row[h] ?? '')}</td>
                                                    ))}
                                                </tr>
                                            ))}
                                        </tbody>
                                    </table>
                                </div>
                                {csvPreview.rows.length > 5 && (
                                    <p className="text-xs text-slate-500 mt-1">...and {csvPreview.rows.length - 5} more rows</p>
                                )}
                            </div>

                            {/* Import progress */}
                            {importProgress && (
                                <div className="flex items-center gap-2">
                                    <Loader2 size={16} className="animate-spin text-green-500" />
                                    <span className="text-sm text-slate-300">Importing...</span>
                                </div>
                            )}
                        </div>

                        <div className="p-6 border-t border-slate-800 flex justify-end gap-3">
                            <button
                                onClick={() => setCsvPreview(null)}
                                disabled={importProgress}
                                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors disabled:opacity-50"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleConfirmImport}
                                disabled={importProgress}
                                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                            >
                                {importProgress ? (
                                    <><Loader2 size={16} className="animate-spin" /> Importing...</>
                                ) : (
                                    <><Upload size={16} /> Import {csvPreview.rows.length} Rows</>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
