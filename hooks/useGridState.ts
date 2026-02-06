import { useState, useMemo } from 'react';

export interface GridStateOptions {
    initialSortField?: string;
    initialSortDirection?: 'asc' | 'desc';
}

export const useGridState = (data: any[] | null, options: GridStateOptions = {}) => {
    const [sortField, setSortField] = useState<string | null>(options.initialSortField || null);
    const [sortDirection, setSortDirection] = useState<'asc' | 'desc'>(options.initialSortDirection || 'asc');
    const [filterField, setFilterField] = useState<string | null>(null);
    const [filterValue, setFilterValue] = useState('');

    const handleSort = (field: string) => {
        if (sortField === field) {
            setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
        } else {
            setSortField(field);
            setSortDirection('asc');
        }
    };

    const processedData = useMemo(() => {
        if (!data) return [];
        let result = [...data];
        
        // 1. Filter
        if (filterField && filterValue) {
            const searchLower = filterValue.toLowerCase();
            result = result.filter(row => {
                const val = row[filterField];
                if (val === null || val === undefined) return false;
                return String(val).toLowerCase().includes(searchLower);
            });
        }
        
        // 2. Sort
        if (sortField) {
            result.sort((a, b) => {
                const valA = a[sortField];
                const valB = b[sortField];
                
                if (valA === valB) return 0;
                if (valA === null || valA === undefined) return 1;
                if (valB === null || valB === undefined) return -1;
                
                if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
                if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
                return 0;
            });
        }
        
        return result;
    }, [data, sortField, sortDirection, filterField, filterValue]);

    return {
        sortField,
        sortDirection,
        filterField,
        filterValue,
        setSortField,
        setSortDirection,
        setFilterField,
        setFilterValue,
        handleSort,
        processedData
    };
};
