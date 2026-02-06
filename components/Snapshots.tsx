import React, { useState, useEffect } from 'react';
import { Database, Download, RotateCcw, Loader2, Clock, HardDrive } from 'lucide-react';
import { ConfirmDialog } from './Modal';

interface Backup {
    key: string;
    size: number;
    uploaded: string;
    timestamp: string;
}

export const Snapshots: React.FC = () => {
    const [backups, setBackups] = useState<Backup[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [restoring, setRestoring] = useState<string | null>(null);
    const [restoreConfirm, setRestoreConfirm] = useState<string | null>(null);

    // Get current room ID from URL params or localStorage
    const getRoomId = () => {
        const params = new URLSearchParams(window.location.search);
        return params.get('room_id') || 'demo-room';
    };

    useEffect(() => {
        fetchBackups();
    }, []);

    const fetchBackups = async () => {
        setLoading(true);
        setError(null);
        try {
            const roomId = getRoomId();
            const response = await fetch(`/backups?room_id=${roomId}`);
            
            if (!response.ok) {
                throw new Error('Failed to fetch backups');
            }
            
            const data = await response.json();
            setBackups(data.backups || []);
        } catch (err: any) {
            setError(err.message);
            console.error('Failed to fetch backups:', err);
        } finally {
            setLoading(false);
        }
    };

    const handleRestore = async (backupKey: string) => {
        setRestoreConfirm(backupKey);
    };

    const confirmRestore = async () => {
        if (!restoreConfirm) return;
        const backupKey = restoreConfirm;
        setRestoreConfirm(null);

        setRestoring(backupKey);
        try {
            const roomId = getRoomId();
            const response = await fetch(`/restore?room_id=${roomId}`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ backupKey })
            });

            const data = await response.json();
            
            if (!response.ok) {
                throw new Error(data.error || 'Restore failed');
            }

            window.location.reload();
        } catch (err: any) {
            setError(`Restore failed: ${err.message}`);
            console.error('Failed to restore backup:', err);
        } finally {
            setRestoring(null);
        }
    };

    const formatBytes = (bytes: number) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return Math.round(bytes / Math.pow(k, i) * 100) / 100 + ' ' + sizes[i];
    };

    const formatDate = (isoString: string) => {
        const date = new Date(isoString);
        return date.toLocaleString();
    };

    return (
        <div className="space-y-6">
            <div className="flex items-center justify-between">
                <div>
                    <h3 className="text-xl font-bold text-white flex items-center gap-2">
                        <Database size={24} />
                        Database Snapshots
                    </h3>
                    <p className="text-sm text-slate-400 mt-1">
                        Browse and restore from R2 backups
                    </p>
                </div>
                <button
                    onClick={fetchBackups}
                    disabled={loading}
                    className="flex items-center gap-2 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg transition-colors disabled:opacity-50"
                >
                    {loading ? <Loader2 className="animate-spin" size={16} /> : <RotateCcw size={16} />}
                    Refresh
                </button>
            </div>

            {error && (
                <div className="bg-red-900/20 border border-red-500 text-red-200 px-4 py-3 rounded-lg">
                    <p className="text-sm">{error}</p>
                </div>
            )}

            {loading ? (
                <div className="flex items-center justify-center py-12">
                    <Loader2 className="animate-spin text-slate-400" size={32} />
                </div>
            ) : backups.length === 0 ? (
                <div className="text-center py-12 bg-slate-800/50 rounded-lg border border-slate-700">
                    <Database className="mx-auto text-slate-600 mb-4" size={48} />
                    <p className="text-slate-400 text-sm">No backups found</p>
                    <p className="text-slate-500 text-xs mt-1">Backups are created hourly via cron trigger</p>
                </div>
            ) : (
                <div className="space-y-2">
                    {backups.map((backup) => (
                        <div
                            key={backup.key}
                            className="bg-slate-800 border border-slate-700 rounded-lg p-4 hover:border-slate-600 transition-colors"
                        >
                            <div className="flex items-center justify-between">
                                <div className="flex-1">
                                    <div className="flex items-center gap-3">
                                        <HardDrive className="text-green-500" size={20} />
                                        <div>
                                            <h4 className="text-white font-medium font-mono text-sm">
                                                {backup.key}
                                            </h4>
                                            <div className="flex items-center gap-4 mt-1">
                                                <span className="text-xs text-slate-400 flex items-center gap-1">
                                                    <Clock size={12} />
                                                    {formatDate(backup.uploaded)}
                                                </span>
                                                <span className="text-xs text-slate-400">
                                                    {formatBytes(backup.size)}
                                                </span>
                                            </div>
                                        </div>
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => handleRestore(backup.key)}
                                        disabled={restoring !== null}
                                        className="flex items-center gap-2 px-4 py-2 bg-orange-600 hover:bg-orange-700 text-white rounded-lg transition-colors disabled:opacity-50 text-sm font-medium"
                                    >
                                        {restoring === backup.key ? (
                                            <>
                                                <Loader2 className="animate-spin" size={16} />
                                                Restoring...
                                            </>
                                        ) : (
                                            <>
                                                <RotateCcw size={16} />
                                                Rollback
                                            </>
                                        )}
                                    </button>
                                </div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            <ConfirmDialog
                isOpen={!!restoreConfirm}
                onConfirm={confirmRestore}
                onCancel={() => setRestoreConfirm(null)}
                title="Restore Backup"
                message={`Are you sure you want to restore from backup ${restoreConfirm}? This will replace all current data.`}
                confirmLabel="Restore"
                confirmVariant="danger"
            />
        </div>
    );
};
