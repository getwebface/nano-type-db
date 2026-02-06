import React from 'react';
import { useRealtimeQuery } from '../../hooks/useDatabase';
import { DataGrid } from '../DataGrid';

export const FileManager: React.FC = () => {
    const tableName = '_files';
    const { data, total, loadMore } = useRealtimeQuery(tableName);

    return (
        <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800">
             <div className="p-6 border-b border-slate-800 flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                        File Manager
                    </h2>
                    <p className="text-sm text-slate-400 mt-1">
                        Manage uploaded files in {tableName}
                    </p>
                </div>
            </div>
            <div className="flex-1 overflow-hidden p-6">
                <DataGrid
                    data={data}
                    total={total}
                    loadMore={loadMore}
                    tableName={tableName}
                />
            </div>
        </div>
    );
};
