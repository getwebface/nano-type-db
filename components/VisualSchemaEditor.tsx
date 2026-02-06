import React, { useState } from 'react';
import { Plus, Trash2, Save, Loader2, Table2, AlertCircle } from 'lucide-react';
import { useDatabase } from '../hooks/useDatabase';

interface Column {
    name: string;
    type: string;
    primaryKey?: boolean;
    notNull?: boolean;
    defaultValue?: string;
}

interface TableSchema {
    name: string;
    columns: Column[];
}

const COLUMN_TYPES = [
    'TEXT',
    'INTEGER',
    'REAL',
    'BLOB',
    'NUMERIC',
    'BOOLEAN',
    'DATE',
    'DATETIME',
    'TIMESTAMP'
];

export const VisualSchemaEditor: React.FC = () => {
    const { rpc } = useDatabase();
    const [isOpen, setIsOpen] = useState(false);
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [success, setSuccess] = useState<string | null>(null);
    
    const [newTable, setNewTable] = useState<TableSchema>({
        name: '',
        columns: [{ name: 'id', type: 'INTEGER', primaryKey: true, notNull: true }]
    });

    const addColumn = () => {
        setNewTable({
            ...newTable,
            columns: [...newTable.columns, { name: '', type: 'TEXT', notNull: false }]
        });
    };

    const removeColumn = (index: number) => {
        if (newTable.columns.length <= 1) return; // Keep at least one column
        setNewTable({
            ...newTable,
            columns: newTable.columns.filter((_, i) => i !== index)
        });
    };

    const updateColumn = (index: number, field: keyof Column, value: any) => {
        const updated = [...newTable.columns];
        updated[index] = { ...updated[index], [field]: value };
        setNewTable({ ...newTable, columns: updated });
    };

    const generateSQL = (): string => {
        const tableName = newTable.name.trim();
        if (!tableName) throw new Error('Table name is required');
        
        const columnDefs = newTable.columns.map(col => {
            const parts = [col.name];
            parts.push(col.type);
            if (col.primaryKey) parts.push('PRIMARY KEY');
            if (col.notNull && !col.primaryKey) parts.push('NOT NULL');
            if (col.defaultValue) parts.push(`DEFAULT ${col.defaultValue}`);
            return parts.join(' ');
        });

        return `CREATE TABLE IF NOT EXISTS ${tableName} (\n  ${columnDefs.join(',\n  ')}\n);`;
    };

    const handleCreateTable = async () => {
        try {
            setSaving(true);
            setError(null);
            setSuccess(null);

            // Execute via RPC using createTable instead of executeSQL for better D1 compatibility
            const columns = newTable.columns.map(col => ({
                name: col.name,
                type: col.type,
                primaryKey: col.primaryKey,
                notNull: col.notNull,
                default: col.defaultValue
            }));
            
            const result = await rpc('createTable', { 
                tableName: newTable.name,
                columns 
            });
            
            if (result.error) {
                throw new Error(result.error);
            }

            setSuccess(`Table "${newTable.name}" created successfully!`);
            
            // Reset form
            setTimeout(() => {
                setNewTable({
                    name: '',
                    columns: [{ name: 'id', type: 'INTEGER', primaryKey: true, notNull: true }]
                });
                setIsOpen(false);
                setSuccess(null);
            }, 2000);

        } catch (e: any) {
            setError(e.message || 'Failed to create table');
        } finally {
            setSaving(false);
        }
    };

    const isValid = newTable.name.trim() && newTable.columns.every(col => col.name.trim() && col.type);

    return (
        <div className="mb-6">
            {!isOpen ? (
                <button
                    onClick={() => setIsOpen(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg font-medium transition-colors"
                >
                    <Table2 size={18} />
                    Visual Schema Editor
                </button>
            ) : (
                <div className="bg-slate-800 border border-slate-700 rounded-xl p-6">
                    <div className="flex items-center justify-between mb-4">
                        <h3 className="text-xl font-bold text-white flex items-center gap-2">
                            <Table2 size={24} />
                            Create New Table
                        </h3>
                        <button
                            onClick={() => {
                                setIsOpen(false);
                                setError(null);
                                setSuccess(null);
                            }}
                            className="text-slate-400 hover:text-white"
                        >
                            Close
                        </button>
                    </div>

                    {error && (
                        <div className="mb-4 p-3 bg-red-500/10 border border-red-500/50 rounded-lg flex items-start gap-2">
                            <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                            <p className="text-sm text-red-400">{error}</p>
                        </div>
                    )}

                    {success && (
                        <div className="mb-4 p-3 bg-green-500/10 border border-green-500/50 rounded-lg">
                            <p className="text-sm text-green-400">{success}</p>
                        </div>
                    )}

                    <div className="space-y-4">
                        {/* Table Name */}
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">
                                Table Name *
                            </label>
                            <input
                                type="text"
                                value={newTable.name}
                                onChange={(e) => setNewTable({ ...newTable, name: e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '') })}
                                className="w-full px-4 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-blue-500"
                                placeholder="e.g. users_table, product_items"
                            />
                        </div>

                        {/* Columns */}
                        <div>
                            <div className="flex items-center justify-between mb-2">
                                <label className="block text-sm font-medium text-slate-400">
                                    Columns *
                                </label>
                                <button
                                    onClick={addColumn}
                                    className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"
                                >
                                    <Plus size={14} />
                                    Add Column
                                </button>
                            </div>

                            <div className="space-y-2">
                                {newTable.columns.map((col, idx) => (
                                    <div key={idx} className="flex gap-2 items-start bg-slate-950 p-3 rounded-lg border border-slate-700">
                                        <div className="flex-1 grid grid-cols-2 gap-2">
                                            <input
                                                type="text"
                                                value={col.name}
                                                onChange={(e) => updateColumn(idx, 'name', e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                                                className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-sm text-white placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-blue-500"
                                                placeholder="Column name"
                                            />
                                            <select
                                                value={col.type}
                                                onChange={(e) => updateColumn(idx, 'type', e.target.value)}
                                                className="px-3 py-1.5 bg-slate-900 border border-slate-700 rounded text-sm text-white focus:outline-none focus:ring-1 focus:ring-blue-500"
                                            >
                                                {COLUMN_TYPES.map(type => (
                                                    <option key={type} value={type}>{type}</option>
                                                ))}
                                            </select>
                                        </div>

                                        <div className="flex gap-2 items-center">
                                            <label className="flex items-center gap-1 text-xs text-slate-400 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={col.primaryKey || false}
                                                    onChange={(e) => updateColumn(idx, 'primaryKey', e.target.checked)}
                                                    className="rounded border-slate-700 bg-slate-900 text-blue-500 focus:ring-blue-500"
                                                />
                                                PK
                                            </label>
                                            <label className="flex items-center gap-1 text-xs text-slate-400 cursor-pointer">
                                                <input
                                                    type="checkbox"
                                                    checked={col.notNull || false}
                                                    onChange={(e) => updateColumn(idx, 'notNull', e.target.checked)}
                                                    className="rounded border-slate-700 bg-slate-900 text-blue-500 focus:ring-blue-500"
                                                />
                                                NOT NULL
                                            </label>

                                            {newTable.columns.length > 1 && (
                                                <button
                                                    onClick={() => removeColumn(idx)}
                                                    className="p-1 text-slate-500 hover:text-red-500 transition-colors"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            )}
                                        </div>
                                    </div>
                                ))}
                            </div>
                        </div>

                        {/* SQL Preview */}
                        <div>
                            <label className="block text-sm font-medium text-slate-400 mb-1">
                                Generated SQL
                            </label>
                            <pre className="p-3 bg-slate-950 border border-slate-700 rounded-lg text-xs text-slate-300 overflow-x-auto font-mono">
                                {isValid ? generateSQL() : '-- Complete the form to see generated SQL'}
                            </pre>
                        </div>

                        {/* Actions */}
                        <div className="flex gap-3 pt-2">
                            <button
                                onClick={() => {
                                    setIsOpen(false);
                                    setError(null);
                                    setSuccess(null);
                                }}
                                className="flex-1 px-4 py-2 bg-slate-700 hover:bg-slate-600 text-white rounded-lg font-medium transition-colors"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleCreateTable}
                                disabled={!isValid || saving}
                                className="flex-1 px-4 py-2 bg-blue-600 hover:bg-blue-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                            >
                                {saving ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        Creating...
                                    </>
                                ) : (
                                    <>
                                        <Save size={18} />
                                        Create Table
                                    </>
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
