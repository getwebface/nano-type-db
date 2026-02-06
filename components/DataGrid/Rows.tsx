import React, { useState } from 'react';
import { Loader2, Edit2, Trash2, MoreVertical, X, Save } from 'lucide-react';
import { EditableCell } from './Cells';
import { ColumnDefinition } from '../../types';
import { Modal } from '../Modal';

export const SkeletonRow: React.FC<{ columns: number }> = ({ columns }) => (
    <tr className="animate-pulse">
        {Array.from({ length: columns }).map((_, idx) => (
            <td key={idx} className="px-6 py-4">
                <div className="h-4 bg-slate-800 rounded"></div>
            </td>
        ))}
    </tr>
);

export const GhostRow: React.FC<{
    headers: string[];
    tableName: string;
    onAdd: (newRow: Record<string, any>) => void;
}> = ({ headers, tableName, onAdd }) => {
    const [newRow, setNewRow] = useState<Record<string, any>>({});
    const [isActive, setIsActive] = useState(false);

    const handleKeyDown = (e: React.KeyboardEvent, field: string) => {
        if (e.key === 'Enter') {
            e.preventDefault();
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

export const GridRow: React.FC<{
    row: any;
    headers: string[];
    tableName: string;
    schema?: ColumnDefinition[];
    onUpdate: (rowId: any, field: string, value: any) => void;
    onDeleteClick?: (rowId: any) => void;
    renderRowActions?: (row: any) => React.ReactNode;
}> = ({ row, headers, tableName, schema, onUpdate, onDeleteClick, renderRowActions }) => {
    const isOptimistic = row._optimistic;
    const [showActions, setShowActions] = useState(false);
    const [showEditModal, setShowEditModal] = useState(false);
    
    // For Row Edit Modal
    const [editValues, setEditValues] = useState<Record<string, any>>({});

    const openEditModal = () => {
        setEditValues({ ...row });
        setShowEditModal(true);
    };

    const handleSaveRow = () => {
        // Save each changed field
        Object.keys(editValues).forEach(key => {
            if (editValues[key] !== row[key]) {
                onUpdate(row.id, key, editValues[key]);
            }
        });
        setShowEditModal(false);
    };

    return (
        <>
            <tr 
                className={`hover:bg-slate-800/50 transition-colors duration-150 group ${isOptimistic ? 'bg-yellow-500/5 border-l-2 border-l-yellow-500/50' : ''}`}
                onMouseEnter={() => setShowActions(true)}
                onMouseLeave={() => setShowActions(false)}
            >
                {headers.map((header) => {
                    const columnDef = schema?.find(col => col.name === header);
                    const columnType = columnDef?.type || 'TEXT';
                    
                    return (
                        <td key={`${row.id || 'new'}-${header}`} className="px-6 py-4 relative">
                            <EditableCell
                                value={row[header]}
                                rowId={row.id}
                                field={header}
                                tableName={tableName}
                                columnType={columnType}
                                onUpdate={onUpdate}
                            />
                            {isOptimistic && header === headers[0] && (
                                <div className="absolute left-1 top-1/2 -translate-y-1/2">
                                    <Loader2 size={12} className="animate-spin text-yellow-500" />
                                </div>
                            )}
                        </td>
                    );
                })}
                <td className="px-6 py-4 w-24 text-right">
                    <div className="flex items-center justify-end gap-2 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                        <button
                            onClick={openEditModal}
                            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-700 rounded transition-colors"
                            title="Edit Row"
                        >
                            <Edit2 size={16} />
                        </button>
                        {renderRowActions && renderRowActions(row)}
                        {onDeleteClick && (
                            <button
                                onClick={() => onDeleteClick(row.id)}
                                className="p-1.5 text-slate-400 hover:text-red-400 hover:bg-red-900/20 rounded transition-colors"
                                title="Delete Row"
                            >
                                <Trash2 size={16} />
                            </button>
                        )}
                    </div>
                </td>
            </tr>

            {showEditModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-lg max-h-[90vh] overflow-y-auto">
                        <div className="flex items-center justify-between mb-6">
                            <h3 className="text-xl font-bold text-white">Edit Row {row.id}</h3>
                            <button onClick={() => setShowEditModal(false)} className="text-slate-400 hover:text-white">
                                <X size={24} />
                            </button>
                        </div>
                        
                        <div className="space-y-4 mb-6">
                            {headers.map(header => (
                                <div key={header}>
                                    <label className="block text-sm font-medium text-slate-400 mb-1 capitalize">
                                        {header.replace(/_/g, ' ')}
                                    </label>
                                    <input
                                        type="text"
                                        value={editValues[header] || ''}
                                        onChange={(e) => setEditValues({...editValues, [header]: e.target.value})}
                                        className="w-full bg-slate-950 border border-slate-700 rounded px-3 py-2 text-white focus:border-green-500 focus:outline-none"
                                    />
                                </div>
                            ))}
                        </div>
                        
                        <div className="flex justify-end gap-3">
                            <button
                                onClick={() => setShowEditModal(false)}
                                className="px-4 py-2 text-slate-400 hover:text-white"
                            >
                                Cancel
                            </button>
                            <button
                                onClick={handleSaveRow}
                                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded flex items-center gap-2"
                            >
                                <Save size={16} />
                                Save Changes
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </>
    );
};
