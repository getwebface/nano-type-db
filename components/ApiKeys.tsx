import React, { useState, useEffect } from 'react';
import { Key, Copy, Plus, Trash, Check } from 'lucide-react';

interface ApiKey {
    id: string;
    name: string;
    created_at: number;
    last_used_at: number | null;
    scopes: string;
}

const HTTP_URL = `${window.location.protocol}//${window.location.host}`;

export const ApiKeys: React.FC = () => {
    const [keys, setKeys] = useState<ApiKey[]>([]);
    const [loading, setLoading] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);

    const fetchKeys = async () => {
        try {
            const res = await fetch(`${HTTP_URL}/api/keys/list`);
            if (res.ok) {
                const data = await res.json();
                setKeys(data);
            }
        } catch (e) {
            console.error('Failed to fetch API keys', e);
        }
    };

    useEffect(() => {
        fetchKeys();
    }, []);

    const generateKey = async () => {
        const name = prompt('Enter a name for this API key (e.g., "Production Website"):');
        if (!name) return;

        setLoading(true);
        try {
            const res = await fetch(`${HTTP_URL}/api/keys/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name })
            });

            if (res.ok) {
                const newKey = await res.json();
                setKeys([...keys, newKey]);
                // Auto-copy the key to clipboard
                await navigator.clipboard.writeText(newKey.id);
                setCopiedId(newKey.id);
                setTimeout(() => setCopiedId(null), 2000);
            }
        } catch (e) {
            console.error('Failed to generate API key', e);
        } finally {
            setLoading(false);
        }
    };

    const deleteKey = async (id: string) => {
        if (!confirm('Are you sure you want to delete this API key? This action cannot be undone.')) {
            return;
        }

        try {
            const res = await fetch(`${HTTP_URL}/api/keys/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });

            if (res.ok) {
                setKeys(keys.filter(k => k.id !== id));
            }
        } catch (e) {
            console.error('Failed to delete API key', e);
        }
    };

    const copyToClipboard = async (text: string) => {
        try {
            await navigator.clipboard.writeText(text);
            setCopiedId(text);
            setTimeout(() => setCopiedId(null), 2000);
        } catch (e) {
            console.error('Failed to copy to clipboard', e);
        }
    };

    const formatDate = (timestamp: number) => {
        return new Date(timestamp).toLocaleDateString('en-US', { 
            year: 'numeric', 
            month: 'short', 
            day: 'numeric' 
        });
    };

    return (
        <div className="p-6 bg-slate-900 border border-slate-800 rounded-lg">
            <div className="flex justify-between items-center mb-6">
                <div>
                    <h3 className="text-lg font-bold text-white flex items-center gap-2">
                        <Key className="text-green-500" /> API Keys
                    </h3>
                    <p className="text-xs text-slate-500 mt-1">
                        Use these keys to connect your apps to nanotypeDB
                    </p>
                </div>
                <button 
                    onClick={generateKey}
                    disabled={loading}
                    className="bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded text-sm font-bold flex gap-2 items-center disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
                >
                    <Plus size={16} /> New Key
                </button>
            </div>
            
            <div className="space-y-3">
                {keys.length === 0 ? (
                    <div className="text-center py-8 text-slate-500 text-sm">
                        No API keys yet. Create one to get started.
                    </div>
                ) : (
                    keys.map(key => (
                        <div 
                            key={key.id}
                            className="flex items-center justify-between bg-slate-950 p-3 rounded border border-slate-800 hover:border-slate-700 transition-colors"
                        >
                            <div className="flex-1 min-w-0">
                                <div className="flex items-center gap-2">
                                    <div className="font-mono text-slate-300 text-sm truncate">
                                        {key.id}
                                    </div>
                                    <button
                                        onClick={() => copyToClipboard(key.id)}
                                        className="text-slate-500 hover:text-white transition-colors"
                                        title="Copy to clipboard"
                                    >
                                        {copiedId === key.id ? (
                                            <Check size={16} className="text-green-500" />
                                        ) : (
                                            <Copy size={16} />
                                        )}
                                    </button>
                                </div>
                                <div className="text-xs text-slate-500 mt-1">
                                    {key.name} • Created {formatDate(key.created_at)}
                                    {key.last_used_at && ` • Last used ${formatDate(key.last_used_at)}`}
                                </div>
                            </div>
                            <button
                                onClick={() => deleteKey(key.id)}
                                className="ml-3 text-slate-500 hover:text-red-500 transition-colors"
                                title="Delete key"
                            >
                                <Trash size={16} />
                            </button>
                        </div>
                    ))
                )}
            </div>

            {keys.length > 0 && (
                <div className="mt-6 p-4 bg-slate-950 border border-slate-800 rounded">
                    <h4 className="text-xs font-bold text-slate-400 mb-2 uppercase">Usage Example</h4>
                    <pre className="text-xs text-slate-500 font-mono overflow-x-auto">
{`<DatabaseProvider 
  apiKey="${keys[0].id}"
>
  <App />
</DatabaseProvider>`}
                    </pre>
                </div>
            )}
        </div>
    );
};
