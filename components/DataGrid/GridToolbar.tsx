import React, { useRef } from 'react';
import { Filter, Upload, Download, Search } from 'lucide-react';

export const GridToolbar: React.FC<{
    showFilters: boolean;
    filtersCount: number;
    rowCount: number;
    filterValue: string;
    onToggleFilters: () => void;
    onImport: (file: File) => void;
    onExport: () => void;
    onSearchChange: (value: string) => void;
}> = ({ 
    showFilters, 
    filtersCount, 
    rowCount, 
    filterValue,
    onToggleFilters, 
    onImport, 
    onExport,
    onSearchChange
}) => {
    const fileInputRef = useRef<HTMLInputElement>(null);

    const handleFileSelect = (e: React.ChangeEvent<HTMLInputElement>) => {
        const file = e.target.files?.[0];
        if (file && file.name.endsWith('.csv')) {
            onImport(file);
            // Reset input so same file can be selected again
            e.target.value = '';
        }
    };

    return (
        <div className="flex items-center gap-2 mb-4">
            <button
                onClick={onToggleFilters}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors border border-slate-700"
            >
                <Filter size={16} />
                Filters
                {filtersCount > 0 && (
                    <span className="px-2 py-0.5 bg-green-500 text-white text-xs rounded-full">{filtersCount}</span>
                )}
            </button>
            
            {/* Search Input */}
            <div className="relative">
                <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-500" />
                <input 
                    type="text" 
                    placeholder="Search visible data..." 
                    value={filterValue}
                    onChange={(e) => onSearchChange(e.target.value)}
                    className="bg-slate-800 border border-slate-700 text-slate-300 rounded-lg pl-9 pr-4 py-2 text-sm focus:outline-none focus:border-green-500 w-48 focus:w-64 transition-all"
                />
            </div>

            <button
                onClick={() => fileInputRef.current?.click()}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors border border-slate-700 ml-auto"
            >
                <Upload size={16} />
                Import CSV
            </button>
            <input
                ref={fileInputRef}
                type="file"
                accept=".csv"
                onChange={handleFileSelect}
                className="hidden"
            />
            
            <button
                onClick={onExport}
                disabled={rowCount === 0}
                className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors border border-slate-700 disabled:opacity-50 disabled:cursor-not-allowed"
            >
                <Download size={16} />
                Export CSV
            </button>
            
            <div className="text-xs text-slate-500 ml-2 whitespace-nowrap">
                {rowCount} {rowCount === 1 ? 'row' : 'rows'}
            </div>
        </div>
    );
};
