import React from 'react';
import { Analytics } from '../Analytics';
import { Activity, Database } from 'lucide-react';

interface OverviewProps {
  roomId: string;
  usageStats: any[];
}

export const Overview: React.FC<OverviewProps> = ({ roomId, usageStats }) => {
  const totalReads = usageStats.reduce((acc, stat) => acc + stat.reads, 0);
  const totalWrites = usageStats.reduce((acc, stat) => acc + stat.writes, 0);

  return (
    <div className="p-8 space-y-8">
      <div>
        <h2 className="text-2xl font-bold text-white mb-6 flex items-center gap-2">
          <Database size={24} />
          Project Overview
        </h2>
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <div className="bg-slate-800 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-2 text-slate-400">
              <Activity size={16} />
              <span className="text-xs font-bold uppercase tracking-wider">Session Reads</span>
            </div>
            <div className="text-3xl font-bold text-white">{totalReads}</div>
            <div className="w-full bg-slate-700 rounded-full h-2 mt-3">
              <div className="bg-blue-500 h-2 rounded-full" style={{ width: `${Math.min(totalReads, 100)}%` }}></div>
            </div>
          </div>
          
          <div className="bg-slate-800 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-2 text-slate-400">
              <Activity size={16} />
              <span className="text-xs font-bold uppercase tracking-wider">Session Writes</span>
            </div>
            <div className="text-3xl font-bold text-white">{totalWrites}</div>
            <div className="w-full bg-slate-700 rounded-full h-2 mt-3">
              <div className="bg-orange-500 h-2 rounded-full" style={{ width: `${Math.min(totalWrites * 5, 100)}%` }}></div>
            </div>
          </div>

          <div className="bg-slate-800 rounded-lg p-6">
            <div className="flex items-center gap-2 mb-2 text-slate-400">
              <Database size={16} />
              <span className="text-xs font-bold uppercase tracking-wider">Room ID</span>
            </div>
            <div className="text-lg font-mono text-white break-all">{roomId}</div>
          </div>
        </div>
      </div>

      {/* Analytics Component */}
      <div>
        <h3 className="text-xl font-bold text-white mb-4">Analytics & Health</h3>
        <Analytics />
      </div>
    </div>
  );
};
