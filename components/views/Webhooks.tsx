import React, { useState } from 'react';
import { useRealtimeQuery, useDatabase } from '../../hooks/useDatabase';
import { DataGrid } from '../DataGrid';
import { Webhook, Plus, Eye, EyeOff } from 'lucide-react';

export const WebhooksView: React.FC = () => {
  const { schema, rpc, addToast } = useDatabase();
  const webhooksData = useRealtimeQuery('_webhooks');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [newWebhookEvents, setNewWebhookEvents] = useState<string[]>([]);
  const [newWebhookSecret, setNewWebhookSecret] = useState('');
  const [showSecrets, setShowSecrets] = useState<Set<number>>(new Set());

  // Build event catalog from schema
  const eventCatalog: string[] = React.useMemo(() => {
    if (!schema) return [];
    const events: string[] = [];
    const actions = ['added', 'modified', 'deleted'];
    for (const table of Object.keys(schema)) {
      if (table.startsWith('_')) continue; // skip system tables
      for (const action of actions) {
        events.push(`${table}.${action}`);
      }
    }
    return events;
  }, [schema]);

  const toggleEvent = (event: string) => {
    setNewWebhookEvents(prev =>
      prev.includes(event) ? prev.filter(e => e !== event) : [...prev, event]
    );
  };

  const toggleSecretVisibility = (idx: number) => {
    setShowSecrets(prev => {
      const next = new Set(prev);
      if (next.has(idx)) next.delete(idx); else next.add(idx);
      return next;
    });
  };

  const handleCreateWebhook = async () => {
    if (!newWebhookUrl.trim()) {
      addToast('Please enter a webhook URL', 'error');
      return;
    }

    if (newWebhookEvents.length === 0) {
      addToast('Please select at least one event', 'error');
      return;
    }

    try {
      await rpc('createWebhook', {
        url: newWebhookUrl,
        events: newWebhookEvents.join(','),
        secret: newWebhookSecret || undefined
      });
      
      addToast('Webhook created successfully', 'success');
      setShowCreateModal(false);
      setNewWebhookUrl('');
      setNewWebhookEvents([]);
      setNewWebhookSecret('');
    } catch (error) {
      console.error('Failed to create webhook:', error);
      addToast('Failed to create webhook: ' + (error as Error).message, 'error');
    }
  };

  // Mask secret values in webhook list display
  const maskedWebhooksData = React.useMemo(() => {
    if (!webhooksData) return null;
    return webhooksData.map((row: any, idx: number) => ({
      ...row,
      secret: row.secret
        ? (showSecrets.has(idx) ? row.secret : '••••••••')
        : ''
    }));
  }, [webhooksData, showSecrets]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-8 py-6 border-b border-slate-800 bg-slate-900 flex justify-between items-center">
        <div>
          <h2 className="text-2xl font-bold text-white flex items-center gap-2">
            <Webhook size={24} />
            Webhooks
          </h2>
          <p className="text-sm text-slate-400 mt-2">
            Manage webhook endpoints and event subscriptions
          </p>
        </div>
        <button
          onClick={() => setShowCreateModal(true)}
          className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
        >
          <Plus size={18} />
          Create Webhook
        </button>
      </header>

      <div className="flex-1 overflow-auto p-8 bg-slate-900">
        {schema && schema['_webhooks'] ? (
          <>
            {webhooksData && webhooksData.length > 0 && webhooksData.some((r: any) => r.secret) && (
              <div className="mb-4 space-y-2">
                <div className="flex items-center gap-2 text-xs text-slate-500">
                  <EyeOff size={14} />
                  <span>Secrets are hidden. Click to reveal.</span>
                </div>
                <div className="flex flex-wrap gap-2">
                  {webhooksData.map((_: any, idx: number) => (
                    webhooksData[idx]?.secret ? (
                      <button
                        key={idx}
                        onClick={() => toggleSecretVisibility(idx)}
                        className="text-xs text-slate-400 hover:text-white flex items-center gap-1 bg-slate-800 px-2 py-1 rounded border border-slate-700"
                      >
                        {showSecrets.has(idx) ? <EyeOff size={12} /> : <Eye size={12} />}
                        Row {idx + 1} secret
                      </button>
                    ) : null
                  ))}
                </div>
              </div>
            )}
            <DataGrid 
              data={maskedWebhooksData} 
              tableName="_webhooks" 
              schema={schema['_webhooks']}
            />
          </>
        ) : (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <Webhook size={48} className="text-slate-600 mx-auto mb-4" />
              <p className="text-slate-400">No webhooks table found</p>
              <p className="text-sm text-slate-500 mt-2">
                Create a _webhooks table to manage webhook endpoints
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Create Webhook Modal */}
      {showCreateModal && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-lg max-w-md w-full max-h-[80vh] overflow-hidden flex flex-col">
            <div className="p-6 border-b border-slate-800">
              <h2 className="text-xl font-bold text-white">Create New Webhook</h2>
            </div>
            
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Webhook URL
                </label>
                <input
                  type="url"
                  value={newWebhookUrl}
                  onChange={(e) => setNewWebhookUrl(e.target.value)}
                  placeholder="https://example.com/webhook"
                  className="w-full bg-slate-800 text-slate-100 px-4 py-2 rounded border border-slate-700 focus:outline-none focus:border-green-500"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Events
                </label>
                {eventCatalog.length > 0 ? (
                  <div className="space-y-1 max-h-48 overflow-y-auto bg-slate-800 rounded border border-slate-700 p-2">
                    {eventCatalog.map(event => (
                      <label key={event} className="flex items-center gap-2 px-2 py-1.5 hover:bg-slate-700/50 rounded cursor-pointer">
                        <input
                          type="checkbox"
                          checked={newWebhookEvents.includes(event)}
                          onChange={() => toggleEvent(event)}
                          className="rounded border-slate-600"
                        />
                        <span className="text-sm text-slate-300 font-mono">{event}</span>
                      </label>
                    ))}
                  </div>
                ) : (
                  <p className="text-xs text-slate-500">No tables found. Create a table first to configure events.</p>
                )}
                {newWebhookEvents.length > 0 && (
                  <p className="text-xs text-slate-400 mt-2">
                    Selected: {newWebhookEvents.join(', ')}
                  </p>
                )}
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Secret (optional)
                </label>
                <input
                  type="password"
                  value={newWebhookSecret}
                  onChange={(e) => setNewWebhookSecret(e.target.value)}
                  placeholder="Optional secret for webhook signature"
                  className="w-full bg-slate-800 text-slate-100 px-4 py-2 rounded border border-slate-700 focus:outline-none focus:border-green-500"
                />
              </div>
            </div>

            <div className="p-6 border-t border-slate-800 flex justify-end gap-3">
              <button
                onClick={() => {
                  setShowCreateModal(false);
                  setNewWebhookUrl('');
                  setNewWebhookEvents([]);
                  setNewWebhookSecret('');
                }}
                className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                onClick={handleCreateWebhook}
                className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors"
              >
                Create Webhook
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
