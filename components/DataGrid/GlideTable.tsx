import React, { useCallback, useMemo } from 'react';
import { DataEditor, GridCell, GridCellKind, GridColumn, Item, Theme, EditableGridCell } from '@glideapps/glide-data-grid';
import "@glideapps/glide-data-grid/dist/index.css";
import { ColumnDefinition } from '../../types';
import { useDatabase } from '../../hooks/useDatabase';

interface GlideTableProps {
    data: any[];
    tableName: string;
    schema: ColumnDefinition[];
}

const theme: Theme = {
    bgCell: "#0f172a",
    bgHeader: "#1e293b",
    bgHeaderHasFocus: "#334155",
    bgHeaderHovered: "#334155",
    textDark: "#e2e8f0",
    textMedium: "#94a3b8",
    textLight: "#cbd5e1",
    textHeader: "#e2e8f0",
    textHeaderSelected: "#fff",
    accentColor: "#22c55e",
    accentFg: "#fff",
    lineColor: "#334155",
    borderColor: "#334155",
    baseFontStyle: "13px Inter, sans-serif",
    headerFontStyle: "600 13px Inter, sans-serif",
    editorFontSize: "13px",
};

export const GlideTable: React.FC<GlideTableProps> = ({ data, tableName, schema }) => {
    const { rpc } = useDatabase();

    const columns: GridColumn[] = useMemo(() => {
        if (!schema) return [];
        return schema.map(col => ({
            title: col.name,
            id: col.name,
            width: 150
        }));
    }, [schema]);

    const getCellContent = useCallback((cell: Item): GridCell => {
        const [col, row] = cell;

        // Ghost row
        if (row === data.length) {
            return {
                kind: GridCellKind.Text,
                allowOverlay: true,
                displayData: "",
                data: "",
                readonly: false,
            };
        }

        const rowData = data[row];
        const colDef = schema[col];
        const field = colDef.name;
        const value = rowData[field];

        if (colDef.name === 'status') {
             return {
                kind: GridCellKind.Bubble,
                data: [value || ''],
                allowOverlay: true,
            };
        }
        
        if (colDef.type === 'BOOLEAN' || typeof value === 'boolean') {
            return {
                kind: GridCellKind.Boolean,
                data: !!value,
                allowOverlay: false, 
            };
        }

        return {
            kind: GridCellKind.Text,
            allowOverlay: true,
            displayData: value !== null && value !== undefined ? String(value) : "",
            data: value !== null && value !== undefined ? String(value) : "",
        };
    }, [data, schema]);

    const onCellEdited = useCallback(async (cell: Item, newValue: EditableGridCell) => {
        const [col, row] = cell;
        const colDef = schema[col];
        const field = colDef.name;

        // Ghost Row -> Create
        if (row === data.length) {
            if (tableName === 'tasks') {
                let title = "New Task";
                if (field === 'title' && newValue.kind === GridCellKind.Text) {
                    title = newValue.data;
                }
                await rpc('createTask', { title });
            } else {
                 const newRow: any = {};
                 if (newValue.kind === GridCellKind.Text) {
                     newRow[field] = newValue.data;
                 } else if (newValue.kind === GridCellKind.Boolean) {
                     newRow[field] = newValue.data;
                 } else if (newValue.kind === GridCellKind.Bubble) {
                     newRow[field] = newValue.data[0];
                 } else {
                    // Fallback for number/other types if needed, treating as string or raw
                    // For now, assume TEXT/BOOLEAN/STATUS structure
                    if ('data' in newValue) {
                        newRow[field] = newValue.data;
                    }
                 }
                 await rpc('batchInsert', { table: tableName, rows: [newRow] });
            }
            return;
        }

        // Existing Row -> Update
        const rowData = data[row];
        const id = rowData.id;
        
        let value: any;
        if (newValue.kind === GridCellKind.Text) {
            value = newValue.data;
        } else if (newValue.kind === GridCellKind.Boolean) {
            value = newValue.data;
        } else if (newValue.kind === GridCellKind.Bubble) {
            value = newValue.data[0];
        } else {
             if ('data' in newValue) {
                value = newValue.data;
            }
        }

        await rpc('updateRow', { table: tableName, id, field, value });

    }, [data, schema, tableName, rpc]);

    if (!schema) return null;

    return (
        <div className="w-full h-full text-slate-200">
             <DataEditor 
                theme={theme}
                columns={columns}
                rows={data.length + 1}
                getCellContent={getCellContent}
                onCellEdited={onCellEdited}
                smoothScrollX={true}
                smoothScrollY={true}
                rowMarkers="none"
                width="100%"
                height="100%"
             />
        </div>
    );
};
