import React, { useState, useRef, useEffect } from 'react';
import { ArrowUpDown, Lock, Unlock, GripVertical } from 'lucide-react';

interface ResizableHeaderProps {
  header: string;
  sortColumn: string | null;
  sortDirection: 'asc' | 'desc';
  width: number;
  isFrozen: boolean;
  onSort: (column: string) => void;
  onResize: (column: string, width: number) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onToggleFreeze: (column: string) => void;
  columnIndex: number;
  totalColumns: number;
}

export const ResizableHeader: React.FC<ResizableHeaderProps> = ({
  header,
  sortColumn,
  sortDirection,
  width,
  isFrozen,
  onSort,
  onResize,
  onReorder,
  onToggleFreeze,
  columnIndex,
  totalColumns
}) => {
  const [isResizing, setIsResizing] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [startX, setStartX] = useState(0);
  const [startWidth, setStartWidth] = useState(width);
  const headerRef = useRef<HTMLDivElement>(null);

  const handleResizeStart = (e: React.MouseEvent) => {
    e.stopPropagation();
    e.preventDefault();
    setIsResizing(true);
    setStartX(e.clientX);
    setStartWidth(width);
  };

  const handleDragStart = (e: React.DragEvent) => {
    setIsDragging(true);
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('columnIndex', String(columnIndex));
  };

  const handleDragOver = (e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    const fromIndex = parseInt(e.dataTransfer.getData('columnIndex'));
    if (fromIndex !== columnIndex) {
      onReorder(fromIndex, columnIndex);
    }
    setIsDragging(false);
  };

  useEffect(() => {
    if (!isResizing) return;

    const handleMouseMove = (e: MouseEvent) => {
      const diff = e.clientX - startX;
      const newWidth = Math.max(50, startWidth + diff);
      onResize(header, newWidth);
    };

    const handleMouseUp = () => {
      setIsResizing(false);
    };

    document.addEventListener('mousemove', handleMouseMove);
    document.addEventListener('mouseup', handleMouseUp);

    return () => {
      document.removeEventListener('mousemove', handleMouseMove);
      document.removeEventListener('mouseup', handleMouseUp);
    };
  }, [isResizing, startX, startWidth, header, onResize]);

  return (
    <th
      ref={headerRef}
      className={`relative px-6 py-3 border-b border-slate-700 bg-slate-800 text-slate-200 uppercase tracking-wider font-semibold ${
        isFrozen ? 'sticky left-0 z-20 shadow-lg' : ''
      } ${isDragging ? 'opacity-50' : ''}`}
      style={{ 
        width: `${width}px`,
        minWidth: `${width}px`,
        maxWidth: `${width}px`
      }}
      draggable
      onDragStart={handleDragStart}
      onDragOver={handleDragOver}
      onDrop={handleDrop}
      onDragEnd={() => setIsDragging(false)}
    >
      <div className="flex items-center gap-2">
        {/* Drag Handle */}
        <GripVertical size={14} className="text-slate-500 cursor-move flex-shrink-0" />
        
        {/* Freeze Toggle */}
        <button
          onClick={(e) => {
            e.stopPropagation();
            onToggleFreeze(header);
          }}
          className="text-slate-500 hover:text-slate-300 transition-colors flex-shrink-0"
          title={isFrozen ? 'Unfreeze column' : 'Freeze column'}
        >
          {isFrozen ? <Lock size={14} /> : <Unlock size={14} className="opacity-0 group-hover:opacity-100" />}
        </button>

        {/* Sort Button */}
        <button
          onClick={() => onSort(header)}
          className="flex items-center gap-2 hover:text-white transition-colors group flex-1 min-w-0"
        >
          <span className="truncate">{header}</span>
          <ArrowUpDown 
            size={14} 
            className={`flex-shrink-0 transition-opacity ${
              sortColumn === header 
                ? 'opacity-100 text-green-500' 
                : 'opacity-0 group-hover:opacity-100'
            }`}
          />
        </button>
      </div>

      {/* Resize Handle */}
      <div
        onMouseDown={handleResizeStart}
        className={`absolute top-0 right-0 w-1 h-full cursor-col-resize hover:bg-green-500 transition-colors ${
          isResizing ? 'bg-green-500' : ''
        }`}
        title="Resize column"
      />
    </th>
  );
};
