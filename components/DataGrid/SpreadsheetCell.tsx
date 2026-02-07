import React, { useState, useRef, useEffect } from 'react';
import { Check, Calendar, FileJson, GripVertical } from 'lucide-react';

interface SpreadsheetCellProps {
  value: any;
  rowId: any;
  rowIndex: number;
  colIndex: number;
  field: string;
  tableName: string;
  columnType: string;
  isSelected: boolean;
  isEditing: boolean;
  onUpdate: (rowId: any, field: string, value: any) => void;
  onSelect: () => void;
  onStartEdit: () => void;
  onStopEdit: () => void;
  onDragFillStart?: () => void;
}

export const SpreadsheetCell: React.FC<SpreadsheetCellProps> = ({
  value,
  rowId,
  rowIndex,
  colIndex,
  field,
  tableName,
  columnType,
  isSelected,
  isEditing,
  onUpdate,
  onSelect,
  onStartEdit,
  onStopEdit,
  onDragFillStart
}) => {
  const [editValue, setEditValue] = useState(value);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setEditValue(value);
  }, [value]);

  useEffect(() => {
    if (isEditing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [isEditing]);

  const handleSave = () => {
    if (editValue !== value) {
      onUpdate(rowId, field, editValue);
    }
    onStopEdit();
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Don't propagate to parent - handled by hook
    if (e.key === 'Enter' || e.key === 'Escape' || e.key === 'Tab') {
      e.stopPropagation();
    }
  };

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect();
  };

  const handleDoubleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onStartEdit();
  };

  // Special rendering for different column types
  const renderValue = () => {
    const lowerType = columnType.toLowerCase();
    
    // Boolean/checkbox
    if (lowerType.includes('bool') || lowerType === 'integer' && (value === 0 || value === 1 || value === true || value === false)) {
      const boolValue = Boolean(value);
      return (
        <button
          onClick={(e) => {
            e.stopPropagation();
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
    
    // Status/enum rendering
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

  const cellContent = isEditing ? (
    <input
      ref={inputRef}
      type="text"
      value={editValue}
      onChange={(e) => setEditValue(e.target.value)}
      onBlur={handleSave}
      onKeyDown={handleKeyDown}
      className="w-full h-full bg-slate-800 text-slate-100 px-2 py-1 border-2 border-green-500 focus:outline-none"
    />
  ) : (
    <div className="px-2 py-1 h-full flex items-center">
      {renderValue()}
    </div>
  );

  return (
    <div
      onClick={handleClick}
      onDoubleClick={handleDoubleClick}
      className={`relative h-full min-h-[40px] cursor-cell transition-all ${
        isSelected 
          ? 'ring-2 ring-green-500 ring-inset bg-slate-800/30' 
          : 'hover:bg-slate-800/20'
      }`}
      style={{ userSelect: isEditing ? 'auto' : 'none' }}
    >
      {cellContent}
      
      {/* Drag Fill Handle */}
      {isSelected && !isEditing && onDragFillStart && (
        <div
          className="absolute bottom-0 right-0 w-2 h-2 bg-green-500 cursor-ns-resize hover:w-3 hover:h-3 transition-all"
          onMouseDown={(e) => {
            e.stopPropagation();
            onDragFillStart();
          }}
          title="Drag to fill"
        />
      )}
    </div>
  );
};
