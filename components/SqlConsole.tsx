import React, { useState } from 'react';
import { useDatabase } from '../hooks/useDatabase';
import { Play, Database } from 'lucide-react';

interface SqlConsoleProps {
    currentTable: string;
}

export const SqlConsole: React.FC<SqlConsoleProps> = ({ currentTable }) => {
    const { runQuery, lastResult } = useDatabase();
    const [sql, setSql] = useState('');

    const handleRun = () => {
        if (!sql.trim()) return;
        runQuery(sql, currentTable);
    };

    return (
        <div className="flex flex-col h-full bg-slate-800 border-t border-slate-700">
            <div className="flex items-center justify-between px-4 py-2 bg-slate-900 border-b border-slate-700">
                <div className="flex items-center gap-2 text-slate-300">
                    <Database size={16} />
                    <span className="text-xs font-mono font-bold uppercase tracking-wide">SQL Console</span>
                </div>
                <button 
                    onClick={handleRun}
                    className="flex items-center gap-2 bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-xs font-bold transition-colors"
                >
                    <Play size={12} fill="currentColor" />
                    RUN
                </button>
            </div>
            
            <div className="flex-1 flex flex-col md:flex-row h-64 md:h-48">
                <div className="flex-1 relative">
                    <textarea
                        value={sql}
                        onChange={(e) => setSql(e.target.value)}
                        placeholder={`INSERT INTO ${currentTable} (title, status) VALUES ('New Item', 'pending');`}
                        className="w-full h-full bg-slate-900 text-slate-200 font-mono text-sm p-4 resize-none focus:outline-none focus:ring-1 focus:ring-slate-700"
                        spellCheck={false}
                    />
                </div>
                
                <div className="flex-1 border-t md:border-t-0 md:border-l border-slate-700 bg-slate-900/50 p-4 overflow-auto font-mono text-xs">
                    {lastResult ? (
                        <div>
                            <div className="mb-2 text-slate-500">Result ({lastResult.data.length} rows):</div>
                            <pre className="text-green-400 whitespace-pre-wrap">
                                {JSON.stringify(lastResult.data, null, 2)}
                            </pre>
                        </div>
                    ) : (
                        <span className="text-slate-600 italic">Results will appear here...</span>
                    )}
                </div>
            </div>
        </div>
    );
};
