import React, { useState, useEffect } from 'react';
import { Key, Copy, Plus, Trash, Check, Download, FileCode, Shield, Calendar, AlertTriangle, Eye, Lock } from 'lucide-react';
import { ConfirmDialog, Modal } from './Modal';

interface ApiKey {
    id: string;
    name: string;
    created_at: number;
    last_used_at: number | null;
    scopes: string;
}

const HTTP_URL = `${window.location.protocol}//${window.location.host}`;

// Helper function to parse JSON response with fallback
const parseJsonResponse = async (res: Response, defaultError: string = 'An error occurred') => {
    try {
        return await res.json();
    } catch {
        return { error: defaultError };
    }
};

export const ApiKeys: React.FC = () => {
    const [keys, setKeys] = useState<ApiKey[]>([]);
    const [loading, setLoading] = useState(false);
    const [copiedId, setCopiedId] = useState<string | null>(null);
    const [errorMessage, setErrorMessage] = useState<string | null>(null);
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [successMessage, setSuccessMessage] = useState<string | null>(null);

    // Create Modal State
    const [isCreateOpen, setIsCreateOpen] = useState(false);
    const [createForm, setCreateForm] = useState({
        name: '',
        expiresInDays: 90,
        scopes: ['read', 'write']
    });
    const [createdKey, setCreatedKey] = useState<ApiKey & { expires_in_days?: number } | null>(null);

    const fetchKeys = async () => {
        try {
            const res = await fetch(`${HTTP_URL}/api/keys/list`);
            if (res.ok) {
                const data = await res.json();
                // Handle new API response format
                if (data.keys && Array.isArray(data.keys)) {
                    setKeys(data.keys);
                } else if (Array.isArray(data)) {
                    // Backwards compatibility
                    setKeys(data);
                } else {
                    console.error('Unexpected response format:', data);
                    setKeys([]);
                }
            } else {
                const errorData = await parseJsonResponse(res, 'Failed to fetch API keys');
                console.error('Failed to fetch API keys:', errorData.error || res.statusText);
                setErrorMessage(errorData.error || 'Failed to fetch API keys');
            }
        } catch (e) {
            console.error('Failed to fetch API keys', e);
            setErrorMessage('Network error: Failed to fetch API keys. Please check your connection.');
        }
    };

    useEffect(() => {
        fetchKeys();
    }, []);

    const generateKey = async () => {
        if (!createForm.name.trim()) return;
        setLoading(true);
        try {
            const res = await fetch(`${HTTP_URL}/api/keys/generate`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    name: createForm.name,
                    expiresInDays: createForm.expiresInDays,
                    scopes: createForm.scopes
                })
            });

            if (res.ok) {
                const newKey: ApiKey & { expires_in_days?: number } = await res.json();
                setKeys([...keys, newKey]);
                setCreatedKey(newKey);
                setIsCreateOpen(false);
                setCreateForm({ name: '', expiresInDays: 90, scopes: ['read', 'write'] });
                setSuccessMessage('API key created successfully');
            } else {
                const errorData = await parseJsonResponse(res, 'Failed to generate API key');
                console.error('Failed to generate API key:', errorData.error || res.statusText);
                setErrorMessage(errorData.error || 'Failed to generate API key');
            }
        } catch (e) {
            console.error('Failed to generate API key', e);
            setErrorMessage('Network error: Failed to generate API key. Please check your connection.');
        } finally {
            setLoading(false);
        }
    };

    const deleteKey = async (id: string) => {
        setDeleteConfirmId(id);
    };

    const confirmDeleteKey = async () => {
        if (!deleteConfirmId) return;
        const id = deleteConfirmId;
        setDeleteConfirmId(null);

        try {
            const res = await fetch(`${HTTP_URL}/api/keys/delete`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ id })
            });

            if (res.ok) {
                setKeys(keys.filter(k => k.id !== id));
                setSuccessMessage('API key deleted successfully');
            } else {
                const errorData = await parseJsonResponse(res, 'Failed to delete API key');
                console.error('Failed to delete API key:', errorData.error || res.statusText);
                setErrorMessage(errorData.error || 'Failed to delete API key');
            }
        } catch (e) {
            console.error('Failed to delete API key', e);
            setErrorMessage('Network error: Failed to delete API key. Please check your connection.');
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
        <div className="space-y-6">
            {/* Download TypeScript Client Section */}
            <div className="p-6 bg-slate-900 border border-slate-800 rounded-lg">
                <div className="flex justify-between items-center mb-4">
                    <div>
                        <h3 className="text-lg font-bold text-white flex items-center gap-2">
                            <FileCode className="text-green-500" /> TypeScript Client SDK
                        </h3>
                        <p className="text-xs text-slate-500 mt-1">
                            Download a fully typed TypeScript client for your database
                        </p>
                    </div>
                    <button 
                        onClick={async () => {
                            try {
                                const res = await fetch(`${HTTP_URL}/download-client?room_id=demo&token=demo-token`);
                                if (res.ok) {
                                    const blob = await res.blob();
                                    const url = window.URL.createObjectURL(blob);
                                    const a = document.createElement('a');
                                    a.href = url;
                                    a.download = 'nanotype-client.ts';
                                    document.body.appendChild(a);
                                    a.click();
                                    window.URL.revokeObjectURL(url);
                                    document.body.removeChild(a);
                                }
                            } catch (e) {
                                console.error('Failed to download client', e);
                            }
                        }}
                        className="bg-green-600 hover:bg-green-700 px-3 py-1.5 rounded text-sm font-bold flex gap-2 items-center transition-colors"
                    >
                        <Download size={16} /> Download Client
                    </button>
                </div>
                
                <div className="p-4 bg-slate-950 border border-slate-800 rounded">
                    <h4 className="text-xs font-bold text-slate-400 mb-2 uppercase">Features</h4>
                    <ul className="text-xs text-slate-500 space-y-1">
                        <li>✓ Full TypeScript type safety</li>
                        <li>✓ Auto-generated from your schema</li>
                        <li>✓ Typed action methods</li>
                        <li>✓ WebSocket support with real-time updates</li>
                        <li>✓ Promise-based API</li>
                    </ul>
                </div>
            </div>

            {/* API Keys Section */}
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
                    onClick={() => setIsCreateOpen(true)}
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
                                        {/** Mask API key, show only prefix */}
                                        {key.id.substring(0, 10)}...{key.id.substring(key.id.length - 4)}
                                    </div>
                                    {/** Removed copy button for existing keys (security) */}
                                    <div className="bg-slate-800 text-slate-500 text-xs px-2 py-0.5 rounded">
                                        Hidden
                                    </div>
                                </div>
                                <div className="text-xs text-slate-500 mt-1 flex gap-2 items-center">
                                    <span>{key.name || "Unnamed"}</span>
                                    <span>•</span>
                                    <span>Created {formatDate(key.created_at)}</span>
                                    {key.last_used_at && (
                                        <><span>•</span><span>Last used {formatDate(key.last_used_at)}</span></>
                                    )}
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
  apiKey="${keys[0].id.substring(0, 5)}..."
>
  <App />
</DatabaseProvider>`}
                    </pre>
                </div>
            )}
            </div>

            {/* Error/Success banners */}
            {errorMessage && (
                <div className="p-4 bg-red-900/20 border border-red-500/50 rounded-lg flex items-center justify-between">
                    <p className="text-sm text-red-400">{errorMessage}</p>
                    <button onClick={() => setErrorMessage(null)} className="text-red-400 hover:text-white text-xs ml-4">Dismiss</button>
                </div>
            )}
            {successMessage && (
                <div className="p-4 bg-green-900/20 border border-green-500/50 rounded-lg flex items-center justify-between">
                    <p className="text-sm text-green-400 whitespace-pre-wrap">{successMessage}</p>
                    <button onClick={() => setSuccessMessage(null)} className="text-green-400 hover:text-white text-xs ml-4">Dismiss</button>
                </div>
            )}

            {/* Create Key Modal */}
            <Modal
                isOpen={isCreateOpen}
                onClose={() => setIsCreateOpen(false)}
                title="Create API Key"
                footer={
                    <>
                        <button 
                            onClick={() => setIsCreateOpen(false)}
                            className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors"
                        >
                            Cancel
                        </button>
                        <button 
                            onClick={generateKey}
                            disabled={!createForm.name || loading}
                            className="px-4 py-2 bg-green-600 hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed text-white rounded-lg transition-colors flex items-center gap-2"
                        >
                            {loading ? 'Generating...' : 'Generate Key'}
                        </button>
                    </>
                }
            >
                <div className="space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">Key Name</label>
                        <input
                            type="text"
                            value={createForm.name}
                            onChange={(e) => setCreateForm({ ...createForm, name: e.target.value })}
                            placeholder="e.g. Mobile App"
                            className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:outline-none focus:border-green-500"
                        />
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-1">Expiration (Days)</label>
                        <input
                            type="number"
                            value={createForm.expiresInDays}
                            onChange={(e) => setCreateForm({ ...createForm, expiresInDays: parseInt(e.target.value) || 0 })}
                            min="1"
                            max="365"
                            className="w-full bg-slate-950 border border-slate-800 rounded px-3 py-2 text-white focus:outline-none focus:border-green-500"
                        />
                        <p className="text-xs text-slate-500 mt-1">Maximum 365 days</p>
                    </div>
                    <div>
                        <label className="block text-sm font-medium text-slate-400 mb-2">Scopes</label>
                        <div className="flex gap-4">
                            {['read', 'write', 'admin'].map(scope => (
                                <label key={scope} className="flex items-center gap-2 cursor-pointer">
                                    <input
                                        type="checkbox"
                                        checked={createForm.scopes.includes(scope)}
                                        onChange={(e) => {
                                            const newScopes = e.target.checked
                                                ? [...createForm.scopes, scope]
                                                : createForm.scopes.filter(s => s !== scope);
                                            setCreateForm({ ...createForm, scopes: newScopes });
                                        }}
                                        className="rounded border-slate-700 bg-slate-950 text-green-500 focus:ring-green-500 focus:ring-offset-slate-900"
                                    />
                                    <span className="text-sm text-slate-300 capitalize">{scope}</span>
                                </label>
                            ))}
                        </div>
                    </div>
                </div>
            </Modal>

            {/* Reveal Key Modal */}
            <Modal
                isOpen={!!createdKey}
                onClose={() => setCreatedKey(null)}
                title="API Key Generated"
                maxWidth="max-w-lg"
                footer={
                    <button 
                        onClick={() => setCreatedKey(null)}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors w-full"
                    >
                        I have copied the key
                    </button>
                }
            >
                <div className="space-y-4">
                    <div className="bg-yellow-500/10 border border-yellow-500/20 p-4 rounded text-yellow-200 text-sm flex gap-3 items-start">
                        <AlertTriangle className="shrink-0 mt-0.5" size={16} />
                        <p>This key will only be shown once. Please copy it and store it securely. You won't be able to see it again.</p>
                    </div>
                    
                    <div>
                        <label className="block text-xs font-bold text-slate-500 uppercase mb-2">Your API Key</label>
                        <div className="flex gap-2">
                            <code className="flex-1 block w-full bg-slate-950 border border-slate-800 rounded px-3 py-3 text-green-400 font-mono text-sm break-all">
                                {createdKey?.id}
                            </code>
                            <button
                                onClick={() => createdKey && copyToClipboard(createdKey.id)}
                                className="bg-slate-800 hover:bg-slate-700 border border-slate-700 text-white px-3 rounded flex items-center justify-center transition-colors shrink-0"
                                title="Copy to clipboard"
                            >
                                {copiedId === createdKey?.id ? <Check size={18} className="text-green-500" /> : <Copy size={18} />}
                            </button>
                        </div>
                    </div>

                    <div className="grid grid-cols-2 gap-4 mt-4 pt-4 border-t border-slate-800">
                        <div>
                            <span className="text-xs text-slate-500 block uppercase">Name</span>
                            <span className="text-sm text-white">{createdKey?.name}</span>
                        </div>
                        <div>
                            <span className="text-xs text-slate-500 block uppercase">Expiration</span>
                            <span className="text-sm text-white">
                                {createdKey?.expires_in_days ? `${createdKey.expires_in_days} days` : 'Never'}
                            </span>
                        </div>
                    </div>
                </div>
            </Modal>

            {/* Delete confirmation */}
            <ConfirmDialog
                isOpen={!!deleteConfirmId}
                onConfirm={confirmDeleteKey}
                onCancel={() => setDeleteConfirmId(null)}
                title="Delete API Key"
                message="Are you sure you want to delete this API key? This action cannot be undone."
                confirmLabel="Delete"
                confirmVariant="danger"
            />
        </div>
    );
};
