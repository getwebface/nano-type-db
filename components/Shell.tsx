import React, { useState } from 'react';
import { useRealtimeQuery } from '../hooks/useDatabase';
import { DataGrid } from './DataGrid';
import { SqlConsole } from './SqlConsole';
import { Layout, Table2, HardDrive, Circle } from 'lucide-react';

const TABLES = ['tasks']; // In a real app, query sqlite_master

export const Shell: React.FC<{ roomId: string }> = ({ roomId }) => {
    const [selectedTable, setSelectedTable] = useState<string>(TABLES[0]);
    const data = useRealtimeQuery(selectedTable);

    return (
        <div className="flex h-screen overflow-hidden bg-slate-900 text-slate-100 font-sans">
            {/* Sidebar */}
            <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col">
                <div className="p-6 border-b border-slate-800">
                    <div className="flex items-center gap-3 text-white mb-1">
                        <HardDrive className="text-green-500" />
                        <h1 className="font-bold text-lg tracking-tight">nanotypeDB</h1>
                    </div>
                    <div className="flex items-center gap-2 text-xs text-slate-500 mt-2">
                        <Circle size={8} className="text-green-500 fill-current" />
                        <span className="font-mono">{roomId}</span>
                    </div>
                </div>

                <nav className="flex-1 p-4 space-y-1">
                    <p className="px-2 text-xs font-semibold text-slate-500 uppercase tracking-wider mb-3">Tables</p>
                    {TABLES.map(table => (
                        <button
                            key={table}
                            onClick={() => setSelectedTable(table)}
                            className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-all ${
                                selectedTable === table 
                                    ? 'bg-slate-800 text-green-400' 
                                    : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                            }`}
                        >
                            <Table2 size={18} />
                            {table}
                        </button>
                    ))}
                </nav>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col min-w-0">
                <header className="px-8 py-6 border-b border-slate-800 bg-slate-900">
                    <h2 className="text-2xl font-bold text-white capitalize flex items-center gap-2">
                        {selectedTable}
                        <span className="text-sm font-normal text-slate-500 ml-2 border border-slate-700 px-2 py-0.5 rounded-full">
                            {data.length} records
                        </span>
                    </h2>
                </header>

                <div className="flex-1 overflow-auto p-8 bg-slate-900">
                    <DataGrid data={data} />
                </div>

                <div className="h-auto">
                    <SqlConsole currentTable={selectedTable} />
                </div>
            </main>
        </div>
    );
};