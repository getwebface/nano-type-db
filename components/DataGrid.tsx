import React from 'react';

interface DataGridProps {
    data: any[];
}

export const DataGrid: React.FC<DataGridProps> = ({ data }) => {
    if (!data || data.length === 0) {
        return (
            <div className="p-8 text-center text-slate-500 border border-slate-800 rounded-lg bg-slate-900/50">
                <p>No data found or table is empty.</p>
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
