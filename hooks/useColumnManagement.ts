import { useState, useCallback, useEffect } from 'react';

const MIN_COLUMN_WIDTH = 50;
const DEFAULT_COLUMN_WIDTH = 200;

export interface ColumnWidth {
  [columnName: string]: number;
}

export const useColumnManagement = (tableName: string, headers: string[]) => {
  const [columnWidths, setColumnWidths] = useState<ColumnWidth>(() => {
    const stored = localStorage.getItem(`columnWidths_${tableName}`);
    return stored ? JSON.parse(stored) : {};
  });

  const [columnOrder, setColumnOrder] = useState<string[]>(() => {
    const stored = localStorage.getItem(`columnOrder_${tableName}`);
    return stored ? JSON.parse(stored) : headers;
  });

  const [frozenColumns, setFrozenColumns] = useState<Set<string>>(() => {
    const stored = localStorage.getItem(`frozenColumns_${tableName}`);
    return stored ? new Set(JSON.parse(stored)) : new Set();
  });

  const [resizingColumn, setResizingColumn] = useState<string | null>(null);
  const [draggedColumn, setDraggedColumn] = useState<string | null>(null);

  // Sync with headers changes
  useEffect(() => {
    setColumnOrder(prev => {
      const newHeaders = headers.filter(h => !prev.includes(h));
      const validHeaders = prev.filter(h => headers.includes(h));
      return [...validHeaders, ...newHeaders];
    });
  }, [headers]);

  // Persist to localStorage
  useEffect(() => {
    localStorage.setItem(`columnWidths_${tableName}`, JSON.stringify(columnWidths));
  }, [columnWidths, tableName]);

  useEffect(() => {
    localStorage.setItem(`columnOrder_${tableName}`, JSON.stringify(columnOrder));
  }, [columnOrder, tableName]);

  useEffect(() => {
    localStorage.setItem(`frozenColumns_${tableName}`, JSON.stringify(Array.from(frozenColumns)));
  }, [frozenColumns, tableName]);

  const setColumnWidth = useCallback((column: string, width: number) => {
    setColumnWidths(prev => ({ ...prev, [column]: Math.max(MIN_COLUMN_WIDTH, width) }));
  }, []);

  const reorderColumns = useCallback((fromIndex: number, toIndex: number) => {
    setColumnOrder(prev => {
      const newOrder = [...prev];
      const [movedColumn] = newOrder.splice(fromIndex, 1);
      newOrder.splice(toIndex, 0, movedColumn);
      return newOrder;
    });
  }, []);

  const toggleFrozenColumn = useCallback((column: string) => {
    setFrozenColumns(prev => {
      const newSet = new Set(prev);
      if (newSet.has(column)) {
        newSet.delete(column);
      } else {
        newSet.add(column);
      }
      return newSet;
    });
  }, []);

  const getColumnWidth = useCallback((column: string) => {
    return columnWidths[column] || DEFAULT_COLUMN_WIDTH;
  }, [columnWidths]);

  const isFrozen = useCallback((column: string) => {
    return frozenColumns.has(column);
  }, [frozenColumns]);

  return {
    columnWidths,
    columnOrder,
    frozenColumns,
    resizingColumn,
    draggedColumn,
    setColumnWidth,
    reorderColumns,
    toggleFrozenColumn,
    getColumnWidth,
    isFrozen,
    setResizingColumn,
    setDraggedColumn
  };
};
