import React from 'react';
import { useRealtimeQuery, useDatabase } from '../../hooks/useDatabase';
import { DataGrid } from '../DataGrid';
import { Webhook } from 'lucide-react';

export const WebhooksView: React.FC = () => {
  const { schema } = useDatabase();
  const webhooksData = useRealtimeQuery('_webhooks');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-8 py-6 border-b border-slate-800 bg-slate-900">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Webhook size={24} />
          Webhooks
        </h2>
        <p className="text-sm text-slate-400 mt-2">
          Manage webhook endpoints and event subscriptions
        </p>
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
    </div>
  );
};
