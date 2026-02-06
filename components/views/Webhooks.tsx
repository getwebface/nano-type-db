import React, { useState } from 'react';
import { useRealtimeQuery, useDatabase } from '../../hooks/useDatabase';
import { DataGrid } from '../DataGrid';
import { Webhook, Plus } from 'lucide-react';

export const WebhooksView: React.FC = () => {
  const { schema, rpc } = useDatabase();
  const webhooksData = useRealtimeQuery('_webhooks');
  const [showCreateModal, setShowCreateModal] = useState(false);
  const [newWebhookUrl, setNewWebhookUrl] = useState('');
  const [newWebhookEvents, setNewWebhookEvents] = useState('');
  const [newWebhookSecret, setNewWebhookSecret] = useState('');

  const handleCreateWebhook = async () => {
    if (!newWebhookUrl.trim()) {
      alert('Please enter a webhook URL');
      return;
    }

    if (!newWebhookEvents.trim()) {
      alert('Please enter events (comma-separated)');
      return;
    }

    try {
      await rpc('createWebhook', {
        url: newWebhookUrl,
        events: newWebhookEvents,
        secret: newWebhookSecret || undefined
      });
      
      setShowCreateModal(false);
      setNewWebhookUrl('');
      setNewWebhookEvents('');
      setNewWebhookSecret('');
    } catch (error) {
      console.error('Failed to create webhook:', error);
      alert('Failed to create webhook: ' + (error as Error).message);
    }
  };

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
          <DataGrid 
            data={webhooksData} 
            tableName="_webhooks" 
            schema={schema['_webhooks']}
          />
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
          <div className="bg-slate-900 border border-slate-700 rounded-lg max-w-md w-full">
            <div className="p-6 border-b border-slate-800">
              <h2 className="text-xl font-bold text-white">Create New Webhook</h2>
            </div>
            
            <div className="p-6 space-y-4">
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
                  Events (comma-separated)
                </label>
                <input
                  type="text"
                  value={newWebhookEvents}
                  onChange={(e) => setNewWebhookEvents(e.target.value)}
                  placeholder="tasks.added,tasks.modified,tasks.deleted"
                  className="w-full bg-slate-800 text-slate-100 px-4 py-2 rounded border border-slate-700 focus:outline-none focus:border-green-500"
                />
                <p className="text-xs text-slate-500 mt-1">
                  Example: tasks.added,tasks.modified
                </p>
              </div>

              <div>
                <label className="block text-sm font-medium text-slate-300 mb-2">
                  Secret (optional)
                </label>
                <input
                  type="text"
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
                  setNewWebhookEvents('');
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
