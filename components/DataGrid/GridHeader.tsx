import React from 'react';
import { ArrowUpDown } from 'lucide-react';

export const GridHeader: React.FC<{
    headers: string[];
    sortColumn: string | null;
    sortDirection: 'asc' | 'desc';
    onSort: (column: string) => void;
}> = ({ headers, sortColumn, sortDirection, onSort }) => {
    return (
        <thead className="bg-slate-800 text-slate-200 uppercase tracking-wider font-semibold">
            <tr>
                {headers.map((header) => (
                    <th key={header} className="px-6 py-3 border-b border-slate-700">
                        <button
                            onClick={() => onSort(header)}
                            className="flex items-center gap-2 hover:text-white transition-colors group"
                        >
                            {header}
                            <ArrowUpDown 
                                size={14} 
                                className={`opacity-0 group-hover:opacity-100 transition-opacity ${
                                    sortColumn === header ? 'opacity-100 text-green-500' : ''
                                }`}
                            />
                        </button>
                    </th>
                ))}
                <th className="px-6 py-3 border-b border-slate-700 w-24">
                    <span className="sr-only">Actions</span>
                </th>
            </tr>
        </thead>
    );
};
