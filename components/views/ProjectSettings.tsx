import React, { useState } from 'react';
import { ApiKeys } from '../ApiKeys';
import { Snapshots } from '../Snapshots';
import { Analytics } from '../Analytics';
import { Settings, Activity, Database } from 'lucide-react';

export const ProjectSettings: React.FC = () => {
  const [settingsTab, setSettingsTab] = useState<'api-keys' | 'snapshots' | 'analytics'>('api-keys');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-8 py-6 border-b border-slate-800 bg-slate-900">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2 mb-4">
          <Settings size={24} />
          Project Settings
        </h2>
        {/* Settings Tabs */}
        <div className="flex gap-2">
          <button
            onClick={() => setSettingsTab('api-keys')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
              settingsTab === 'api-keys'
                ? 'bg-green-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            API Keys
          </button>
          <button
            onClick={() => setSettingsTab('snapshots')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              settingsTab === 'snapshots'
                ? 'bg-green-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <Database size={16} />
            Snapshots
          </button>
          <button
            onClick={() => setSettingsTab('analytics')}
            className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 ${
              settingsTab === 'analytics'
                ? 'bg-green-600 text-white'
                : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
          >
            <Activity size={16} />
            Analytics
          </button>
        </div>
      </header>
      
      <div className="flex-1 overflow-auto p-8 bg-slate-900">
        {settingsTab === 'api-keys' && <ApiKeys />}
        {settingsTab === 'snapshots' && <Snapshots />}
        {settingsTab === 'analytics' && <Analytics />}
      </div>
    </div>
  );
};
