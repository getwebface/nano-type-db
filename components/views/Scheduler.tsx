import React from 'react';
import { useRealtimeQuery, useDatabase } from '../../hooks/useDatabase';
import { DataGrid } from '../DataGrid';
import { Play } from 'lucide-react';

export const Scheduler: React.FC = () => {
    const tableName = '_cron_jobs';
    const { data, total, loadMore } = useRealtimeQuery(tableName);
    const { rpc, addToast } = useDatabase();

    const handleRunJob = async (row: any) => {
        try {
            await rpc('runCronJob', { jobId: row.id });
            addToast('Job triggered successfully', 'success');
        } catch (error) {
            console.error('Failed to run job:', error);
            addToast('Failed to run job', 'error');
        }
    };

    const renderRowActions = (row: any) => (
        <button
            onClick={() => handleRunJob(row)}
            className="p-1.5 text-slate-400 hover:text-green-400 hover:bg-green-900/20 rounded transition-colors"
            title="Run Job Now"
        >
            <Play size={16} />
        </button>
    );

    return (
        <div className="flex flex-col h-full bg-slate-900 border-l border-slate-800">
             <div className="p-6 border-b border-slate-800 flex justify-between items-center">
                <div>
                    <h2 className="text-xl font-bold text-white tracking-tight flex items-center gap-2">
                        Cron Scheduler
                    </h2>
                    <p className="text-sm text-slate-400 mt-1">
                        Manage scheduled jobs in {tableName}
                    </p>
                </div>
            </div>
            <div className="flex-1 overflow-hidden p-6">
                <DataGrid
                    data={data}
                    total={total}
                    loadMore={loadMore}
                    tableName={tableName}
                    renderRowActions={renderRowActions}
                />
            </div>
        </div>
    );
};
