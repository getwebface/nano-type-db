import React, { useState, useRef, useEffect } from 'react';
import { Check, Calendar, FileJson } from 'lucide-react';

export const EditableCell: React.FC<{
    value: any;
    rowId: any;
    field: string;
    tableName: string;
    columnType: string;
    onUpdate: (rowId: any, field: string, value: any) => void;
}> = ({ value, rowId, field, tableName, columnType, onUpdate }) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editValue, setEditValue] = useState(value);
    const inputRef = useRef<HTMLInputElement>(null);

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
