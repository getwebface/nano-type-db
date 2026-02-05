import React from 'react';
import { Plus, Loader2 } from 'lucide-react';

interface DataGridProps {
    data: any[] | null;
    isLoading?: boolean;
}

const SkeletonRow: React.FC<{ columns: number }> = ({ columns }) => (
    <tr className="animate-pulse">
        {Array.from({ length: columns }).map((_, idx) => (
            <td key={idx} className="px-6 py-4">
                <div className="h-4 bg-slate-800 rounded"></div>
            </td>
        ))}
    </tr>
);

export const DataGrid: React.FC<DataGridProps> = ({ data, isLoading = false }) => {
    // Loading state with skeleton
    if (isLoading || data === null) {
        return (
            <div className="w-full overflow-hidden rounded-lg border border-slate-700 shadow-sm">
                <div className="overflow-x-auto">
                    <table className="w-full text-left text-sm text-slate-400">
                        <thead className="bg-slate-800 text-slate-200 uppercase tracking-wider font-semibold">
                            <tr>
                                {Array.from({ length: 3 }).map((_, idx) => (
                                    <th key={idx} className="px-6 py-3 border-b border-slate-700">
                                        <div className="h-4 bg-slate-700 rounded w-20 animate-pulse"></div>
                                    </th>
                                ))}
                            </tr>
                        </thead>
                        <tbody className="divide-y divide-slate-800 bg-slate-900">
                            {Array.from({ length: 5 }).map((_, idx) => (
                                <SkeletonRow key={idx} columns={3} />
                            ))}
                        </tbody>
                    </table>
                </div>
                <div className="flex items-center justify-center py-4 bg-slate-900 border-t border-slate-800">
                    <Loader2 className="w-5 h-5 text-green-500 animate-spin mr-2" />
                    <span className="text-sm text-slate-400">Loading data...</span>
                </div>
            </div>
        );
    }

    // Empty state
    if (data.length === 0) {
        return (
            <div className="w-full overflow-hidden rounded-lg border border-slate-700 shadow-sm">
                <div className="p-12 text-center bg-slate-900/50">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-800 border border-slate-700 mb-4">
                        <Plus className="w-8 h-8 text-slate-500" />
                    </div>
                    <h3 className="text-lg font-semibold text-white mb-2">No records yet!</h3>
                    <p className="text-sm text-slate-400 mb-6">
                        This table is empty. Use the SQL console below to insert your first record.
                    </p>
                    <div className="inline-block px-4 py-2 bg-slate-800 border border-slate-700 rounded-lg text-sm font-mono text-slate-300">
                        INSERT INTO tasks (title) VALUES ('My first task')
                    </div>
                </div>
            </div>
        );
    }

    const headers = Object.keys(data[0]);

    return (
        <div className="w-full overflow-hidden rounded-lg border border-slate-700 shadow-sm">
            <div className="overflow-x-auto">
                <table className="w-full text-left text-sm text-slate-400">
                    <thead className="bg-slate-800 text-slate-200 uppercase tracking-wider font-semibold">
                        <tr>
                            {headers.map((header) => (
                                <th key={header} className="px-6 py-3 border-b border-slate-700">
                                    {header}
                                </th>
                            ))}
                        </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800 bg-slate-900">
                        {data.map((row, idx) => (
                            <tr key={idx} className="hover:bg-slate-800/50 transition-colors duration-150">
                                {headers.map((header) => (
                                    <td key={`${idx}-${header}`} className="px-6 py-4 whitespace-nowrap">
                                        {row[header]}
                                    </td>
                                ))}
                            </tr>
                        ))}
                    </tbody>
                </table>
            </div>
        </div>
    );
};
