import { useState, useCallback, useEffect, useRef } from 'react';

export interface CellPosition {
  rowIndex: number;
  colIndex: number;
}

export interface UndoRedoState {
  rowId: any;
  field: string;
  oldValue: any;
  newValue: any;
}

export const useSpreadsheetNavigation = (
  rowCount: number,
  colCount: number,
  onCellUpdate?: (rowId: any, field: string, value: any) => void
) => {
  const [selectedCell, setSelectedCell] = useState<CellPosition | null>(null);
  const [editingCell, setEditingCell] = useState<CellPosition | null>(null);
  const [undoStack, setUndoStack] = useState<UndoRedoState[]>([]);
  const [redoStack, setRedoStack] = useState<UndoRedoState[]>([]);
  const [copiedCells, setCopiedCells] = useState<any[][] | null>(null);

  const navigateCell = useCallback((direction: 'up' | 'down' | 'left' | 'right' | 'tab' | 'shiftTab') => {
    setSelectedCell(prev => {
      if (!prev) return { rowIndex: 0, colIndex: 0 };
      
      let { rowIndex, colIndex } = prev;
      
      switch (direction) {
        case 'up':
          rowIndex = Math.max(0, rowIndex - 1);
          break;
        case 'down':
          rowIndex = Math.min(rowCount - 1, rowIndex + 1);
          break;
        case 'left':
          colIndex = Math.max(0, colIndex - 1);
          break;
        case 'right':
          colIndex = Math.min(colCount - 1, colIndex + 1);
          break;
        case 'tab':
          colIndex++;
          if (colIndex >= colCount) {
            colIndex = 0;
            rowIndex = Math.min(rowCount - 1, rowIndex + 1);
          }
          break;
        case 'shiftTab':
          colIndex--;
          if (colIndex < 0) {
            colIndex = colCount - 1;
            rowIndex = Math.max(0, rowIndex - 1);
          }
          break;
      }
      
      return { rowIndex, colIndex };
    });
    setEditingCell(null);
  }, [rowCount, colCount]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (!selectedCell) return;

    // Undo/Redo
    if ((e.ctrlKey || e.metaKey) && e.key === 'z' && !e.shiftKey) {
      e.preventDefault();
      undo();
      return;
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'y' || (e.key === 'z' && e.shiftKey))) {
      e.preventDefault();
      redo();
      return;
    }

    // Don't handle keys when editing
    if (editingCell) {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        setEditingCell(null);
        navigateCell('down');
      } else if (e.key === 'Escape') {
        e.preventDefault();
        setEditingCell(null);
      } else if (e.key === 'Tab') {
        e.preventDefault();
        setEditingCell(null);
        navigateCell(e.shiftKey ? 'shiftTab' : 'tab');
      }
      return;
    }

    // Navigation
    if (e.key === 'ArrowUp') {
      e.preventDefault();
      navigateCell('up');
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      navigateCell('down');
    } else if (e.key === 'ArrowLeft') {
      e.preventDefault();
      navigateCell('left');
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      navigateCell('right');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      setEditingCell(selectedCell);
    } else if (e.key === 'Tab') {
      e.preventDefault();
      navigateCell(e.shiftKey ? 'shiftTab' : 'tab');
    } else if (e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey) {
      // Start editing on character key
      setEditingCell(selectedCell);
    }
  }, [selectedCell, editingCell, navigateCell]);

  const addToUndoStack = useCallback((state: UndoRedoState) => {
    setUndoStack(prev => [...prev, state]);
    setRedoStack([]); // Clear redo stack on new action
  }, []);

  const undo = useCallback(() => {
    if (undoStack.length === 0) return;
    
    const lastAction = undoStack[undoStack.length - 1];
    setUndoStack(prev => prev.slice(0, -1));
    setRedoStack(prev => [...prev, lastAction]);
    
    if (onCellUpdate) {
      onCellUpdate(lastAction.rowId, lastAction.field, lastAction.oldValue);
    }
  }, [undoStack, onCellUpdate]);

  const redo = useCallback(() => {
    if (redoStack.length === 0) return;
    
    const lastAction = redoStack[redoStack.length - 1];
    setRedoStack(prev => prev.slice(0, -1));
    setUndoStack(prev => [...prev, lastAction]);
    
    if (onCellUpdate) {
      onCellUpdate(lastAction.rowId, lastAction.field, lastAction.newValue);
    }
  }, [redoStack, onCellUpdate]);

  const handleCopy = useCallback((data: any[][], headers: string[]) => {
    const { rowIndex, colIndex } = selectedCell || { rowIndex: 0, colIndex: 0 };
    const cellData = [[data[rowIndex]?.[colIndex] || '']];
    setCopiedCells(cellData);
    
    // Copy to clipboard
    const textToCopy = cellData.map(row => row.join('\t')).join('\n');
    navigator.clipboard.writeText(textToCopy);
  }, [selectedCell]);

  const handlePaste = useCallback(async (data: any[][], headers: string[], onUpdate: (rowIndex: number, field: string, value: any) => void) => {
    if (!selectedCell) return;
    
    try {
      const clipboardText = await navigator.clipboard.readText();
      const rows = clipboardText.split('\n').filter(row => row.trim());
      const pastedData = rows.map(row => row.split('\t'));
      
      let { rowIndex, colIndex } = selectedCell;
      
      pastedData.forEach((row, rIdx) => {
        row.forEach((value, cIdx) => {
          const targetRow = rowIndex + rIdx;
          const targetCol = colIndex + cIdx;
          
          if (targetRow < data.length && targetCol < headers.length) {
            const field = headers[targetCol];
            onUpdate(targetRow, field, value);
          }
        });
      });
    } catch (error) {
      console.error('Failed to paste:', error);
    }
  }, [selectedCell]);

  return {
    selectedCell,
    editingCell,
    setSelectedCell,
    setEditingCell,
    navigateCell,
    handleKeyDown,
    undoStack,
    redoStack,
    addToUndoStack,
    undo,
    redo,
    handleCopy,
    handlePaste,
    copiedCells
  };
};
