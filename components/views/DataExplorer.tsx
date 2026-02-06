import React, { useState } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { VisualSchemaEditor } from '../VisualSchemaEditor';
import { PsychicSearch } from '../PsychicSearch';
import { Analytics } from '../Analytics';
import { Brain, Network, Database, Zap, HardDrive } from 'lucide-react';

export const DataExplorer: React.FC = () => {
  const { schema } = useDatabase();
  const [activeTab, setActiveTab] = useState<'semantic' | 'vectorization' | 'schema' | 'r2' | 'connected'>('semantic');
  
  const tableList = schema ? Object.keys(schema) : [];

  const tabs = [
    { id: 'semantic' as const, label: 'Semantic Categorization', icon: Brain },
    { id: 'vectorization' as const, label: 'Vectorization Analytics', icon: Network },
    { id: 'schema' as const, label: 'Schema Insights', icon: Database },
    { id: 'r2' as const, label: 'R2 Storage', icon: HardDrive },
    { id: 'connected' as const, label: 'Connected Apps', icon: Zap },
  ];

  return (
    <div className="h-full flex flex-col overflow-hidden">
      {/* Header */}
      <header className="px-8 py-6 border-b border-slate-800 bg-slate-900">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2 mb-4">
          <Brain size={24} />
          Data Explorer
        </h2>
        <p className="text-sm text-slate-400 mb-4">
          Insights, AI features, and analytics for your database
        </p>
        
        {/* Tabs */}
        <div className="flex gap-2 overflow-x-auto pb-2">
          {tabs.map(tab => {
            const Icon = tab.icon;
            return (
              <button
                key={tab.id}
                onClick={() => setActiveTab(tab.id)}
                className={`px-4 py-2 rounded-lg text-sm font-medium transition-colors flex items-center gap-2 whitespace-nowrap ${
                  activeTab === tab.id
                    ? 'bg-green-600 text-white'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
                }`}
              >
                <Icon size={16} />
                {tab.label}
              </button>
            );
          })}
        </div>
      </header>

      {/* Main Content */}
      <div className="flex-1 overflow-auto p-8 bg-slate-900">
        {activeTab === 'semantic' && (
          <div className="space-y-6">
            <div className="bg-slate-800 rounded-lg p-6">
              <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Brain size={20} />
                Semantic Search & Reflex
              </h3>
              <p className="text-slate-400 mb-6">
                Subscribe to events based on meaning using AI embeddings. Get instant notifications when new data matches semantic criteria.
              </p>
              
              <PsychicSearch />
            </div>

            <div className="bg-slate-800 rounded-lg p-6">
              <h4 className="text-lg font-semibold text-white mb-3">Active Semantic Topics</h4>
              <p className="text-slate-500 text-sm">
                No active semantic topics. Create semantic subscriptions to monitor data based on meaning rather than exact matches.
              </p>
            </div>
          </div>
        )}

        {activeTab === 'vectorization' && (
          <div className="space-y-6">
            <div className="bg-slate-800 rounded-lg p-6">
              <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Network size={20} />
                Vectorization Analytics
              </h3>
              <p className="text-slate-400 mb-6">
                Monitor embedding generation, similarity scores, and vector search performance.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-900 rounded-lg p-4">
                  <div className="text-sm text-slate-500 mb-1">Total Vectors</div>
                  <div className="text-2xl font-bold text-white">0</div>
                </div>
                <div className="bg-slate-900 rounded-lg p-4">
                  <div className="text-sm text-slate-500 mb-1">Avg Similarity</div>
                  <div className="text-2xl font-bold text-white">-</div>
                </div>
                <div className="bg-slate-900 rounded-lg p-4">
                  <div className="text-sm text-slate-500 mb-1">Embeddings Today</div>
                  <div className="text-2xl font-bold text-white">0</div>
                </div>
              </div>
            </div>

            <Analytics />
          </div>
        )}

        {activeTab === 'schema' && (
          <div className="space-y-6">
            <div className="bg-slate-800 rounded-lg p-6">
              <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Database size={20} />
                Schema Insights
              </h3>
              <p className="text-slate-400 mb-6">
                Visual representation and analysis of your database structure.
              </p>
              
              <VisualSchemaEditor />
            </div>

            <div className="bg-slate-800 rounded-lg p-6">
              <h4 className="text-lg font-semibold text-white mb-3">Tables Summary</h4>
              <div className="space-y-3">
                {tableList.length === 0 ? (
                  <p className="text-slate-500 text-sm">No tables found in your database.</p>
                ) : (
                  tableList.map(table => {
                    const columns = schema?.[table] || [];
                    return (
                      <div key={table} className="bg-slate-900 rounded-lg p-4">
                        <div className="font-semibold text-white mb-2">{table}</div>
                        <div className="text-sm text-slate-400">
                          {columns.length} column{columns.length !== 1 ? 's' : ''}: {columns.map(c => c.name).join(', ')}
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>
          </div>
        )}

        {activeTab === 'r2' && (
          <div className="space-y-6">
            <div className="bg-slate-800 rounded-lg p-6">
              <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <HardDrive size={20} />
                R2 Storage
              </h3>
              <p className="text-slate-400 mb-6">
                Cloudflare R2 object storage integration for files and assets.
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                <div className="bg-slate-900 rounded-lg p-4">
                  <div className="text-sm text-slate-500 mb-1">Storage Used</div>
                  <div className="text-2xl font-bold text-white">0 GB</div>
                </div>
                <div className="bg-slate-900 rounded-lg p-4">
                  <div className="text-sm text-slate-500 mb-1">Total Objects</div>
                  <div className="text-2xl font-bold text-white">0</div>
                </div>
              </div>

              <div className="mt-6">
                <p className="text-slate-500 text-sm">
                  R2 storage integration allows you to store and retrieve large files efficiently alongside your database.
                </p>
              </div>
            </div>
          </div>
        )}

        {activeTab === 'connected' && (
          <div className="space-y-6">
            <div className="bg-slate-800 rounded-lg p-6">
              <h3 className="text-xl font-bold text-white mb-4 flex items-center gap-2">
                <Zap size={20} />
                Connected Apps & Integrations
              </h3>
              <p className="text-slate-400 mb-6">
                View applications and services connected to your database.
              </p>

              <div className="space-y-3">
                <div className="bg-slate-900 rounded-lg p-4">
                  <div className="font-semibold text-white mb-2">API Endpoints</div>
                  <div className="text-sm text-slate-400">
                    REST and WebSocket connections for real-time data access
                  </div>
                </div>

                <div className="bg-slate-900 rounded-lg p-4">
                  <div className="font-semibold text-white mb-2">Webhooks</div>
                  <div className="text-sm text-slate-400">
                    Event-driven integrations for automated workflows
                  </div>
                </div>

                <div className="bg-slate-900 rounded-lg p-4">
                  <div className="font-semibold text-white mb-2">Workers AI</div>
                  <div className="text-sm text-slate-400">
                    AI-powered features including semantic search and embeddings
                  </div>
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};
