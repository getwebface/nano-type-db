import React from 'react';
import { ColumnDefinition } from '../../types';
import { GlideTable } from './GlideTable';

export { GlideTable } from './GlideTable';

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
    tableName = 'table_name', 
    schema,
}) => {
    return (
        <GlideTable 
            data={data || []}
            tableName={tableName}
            schema={schema || []}
        />
    );
};
