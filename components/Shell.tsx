import React, { useState, useEffect } from 'react';
import { useRealtimeQuery, useDatabase } from '../hooks/useDatabase';
import { DataGrid } from './DataGrid';
import { SqlConsole } from './SqlConsole';
import { Layout, Table2, HardDrive, Circle, Plus, Loader2, Activity } from 'lucide-react';

export const Shell: React.FC<{ roomId: string }> = ({ roomId }) => {
    const { schema, usageStats, status } = useDatabase();
    const [selectedTable, setSelectedTable] = useState<string>('tasks');
    
    useEffect(() => {
        if (schema) {
            const tables = Object.keys(schema);
            if (tables.length > 0 && !tables.includes(selectedTable)) {
                setSelectedTable(tables[0]);
            }
        }
    }, [schema]);

    const data = useRealtimeQuery(selectedTable);
    const tableList = schema ? Object.keys(schema) : [];

    // Calculate totals
    const totalReads = usageStats.reduce((acc, stat) => acc + stat.reads, 0);
    const totalWrites = usageStats.reduce((acc, stat) => acc + stat.writes, 0);

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
                        <Circle 
                            size={8} 
                            className={`${
                                status === 'connected' 
                                    ? 'text-green-500 fill-current' 
                                    : status === 'connecting'
                                    ? 'text-yellow-500 fill-current animate-pulse'
                                    : 'text-red-500 fill-current'
                            }`} 
                        />
                        <span className="font-mono">{roomId}</span>
                        <span className={`ml-auto text-xs ${
                            status === 'connected' 
                                ? 'text-green-500' 
                                : status === 'connecting'
                                ? 'text-yellow-500'
                                : 'text-red-500'
                        }`}>
                            {status}
                        </span>
                    </div>
                </div>

                <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
                    <div className="flex items-center justify-between px-2 mb-3">
                        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Tables</p>
                    </div>
                    
                    {tableList.length === 0 ? (
                        <div className="px-2 py-4 text-center">
                            <p className="text-xs text-slate-600 mb-2">No tables found.</p>
                        </div>
                    ) : (
                        tableList.map(table => (
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
                        ))
                    )}
                </nav>

                {/* Usage Meter */}
                <div className="p-4 border-t border-slate-800 bg-slate-900/50">
                    <div className="flex items-center gap-2 mb-3 text-slate-400">
                        <Activity size={16} />
                        <span className="text-xs font-bold uppercase tracking-wider">Usage (Session)</span>
                    </div>
                    <div className="space-y-3">
                        <div>
                            <div className="flex justify-between text-xs mb-1">
                                <span className="text-slate-500">Reads</span>
                                <span className="text-slate-200">{totalReads}</span>
                            </div>
                            <div className="w-full bg-slate-800 rounded-full h-1.5">
                                <div className="bg-blue-500 h-1.5 rounded-full" style={{ width: `${Math.min(totalReads, 100)}%` }}></div>
                            </div>
                        </div>
                        <div>
                            <div className="flex justify-between text-xs mb-1">
                                <span className="text-slate-500">Writes</span>
                                <span className="text-slate-200">{totalWrites}</span>
                            </div>
                            <div className="w-full bg-slate-800 rounded-full h-1.5">
                                <div className="bg-orange-500 h-1.5 rounded-full" style={{ width: `${Math.min(totalWrites * 5, 100)}%` }}></div>
                            </div>
                        </div>
                    </div>
                </div>
            </aside>

            {/* Main Content */}
            <main className="flex-1 flex flex-col min-w-0">
                <header className="px-8 py-6 border-b border-slate-800 bg-slate-900 flex justify-between items-center">
                    <h2 className="text-2xl font-bold text-white capitalize flex items-center gap-2">
                        {selectedTable}
                        <span className="text-sm font-normal text-slate-500 ml-2 border border-slate-700 px-2 py-0.5 rounded-full">
                            {data ? data.length : 0} records
                        </span>
                    </h2>
                    
                    {/* Schema Info Badge */}
                    <div className="hidden md:flex gap-2">
                        {schema && schema[selectedTable] && schema[selectedTable].map(col => (
                            <span key={col.name} className="text-xs font-mono text-slate-500 bg-slate-800 px-2 py-1 rounded">
                                {col.name}: {col.type}
                            </span>
                        ))}
                    </div>
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
