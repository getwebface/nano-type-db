import React, { useState, useEffect } from 'react';
import { RoomCard } from './RoomCard';
import { Plus, Loader2, AlertCircle } from 'lucide-react';
import { ConfirmDialog } from './Modal';

interface Room {
    id: string;
    name: string;
    created_at: number;
    last_accessed_at?: number;
}

interface RoomSelectionProps {
    onSelectRoom: (roomId: string) => void;
}

export const RoomSelection: React.FC<RoomSelectionProps> = ({ onSelectRoom }) => {
    const [rooms, setRooms] = useState<Room[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [showCreateModal, setShowCreateModal] = useState(false);
    const [creating, setCreating] = useState(false);
    const [newRoomId, setNewRoomId] = useState('');
    const [newRoomName, setNewRoomName] = useState('');
    const [projectName, setProjectName] = useState('');
    const [deleteConfirmRoom, setDeleteConfirmRoom] = useState<string | null>(null);

    useEffect(() => {
        loadRooms();
    }, []);

    const generateSlug = (name: string) => {
        return name
            .toLowerCase()
            .replace(/[^a-z0-9]+/g, '-')
            .replace(/(^-|-$)/g, '');
    };

    const handleProjectNameChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const name = e.target.value;
        setProjectName(name);
        setNewRoomName(name);
        setNewRoomId(generateSlug(name));
    };

    const loadRooms = async () => {
        try {
            setLoading(true);
            setError(null);
            const response = await fetch('/api/rooms/list');
            if (!response.ok) {
                throw new Error(`Failed to load rooms: ${response.statusText}`);
            }
            const data = await response.json();
            setRooms(data);
        } catch (e: any) {
            setError(e.message);
        } finally {
            setLoading(false);
        }
    };

    const handleCreateRoom = async (e: React.FormEvent) => {
        e.preventDefault();
        if (!newRoomId.trim() || creating) return;

        try {
            setCreating(true);
            setError(null);
            const response = await fetch('/api/rooms/create', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    roomId: newRoomId.trim(),
                    name: newRoomName.trim() || newRoomId.trim()
                })
            });

            if (!response.ok) {
                const text = await response.text();
                throw new Error(text || `Failed to create room: ${response.statusText}`);
            }

            const newRoom = await response.json();
            setRooms([newRoom, ...rooms]);
            setShowCreateModal(false);
            setNewRoomId('');
            setNewRoomName('');
            setProjectName('');
        } catch (e: any) {
            setError(e.message);
        } finally {
            setCreating(false);
        }
    };

    const handleDeleteRoom = async (roomId: string) => {
        setDeleteConfirmRoom(roomId);
    };

    const confirmDeleteRoom = async () => {
        if (!deleteConfirmRoom) return;
        const roomId = deleteConfirmRoom;
        setDeleteConfirmRoom(null);

        try {
            setError(null);
            const response = await fetch('/api/rooms/delete', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ roomId })
            });

            if (!response.ok) {
                throw new Error(`Failed to delete room: ${response.statusText}`);
            }

            setRooms(rooms.filter(r => r.id !== roomId));
        } catch (e: any) {
            setError(e.message);
        }
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-20">
                <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
            </div>
        );
    }

    return (
        <div className="w-full max-w-6xl mx-auto">
            {error && (
                <div className="mb-6 p-4 bg-red-500/10 border border-red-500/50 rounded-lg flex items-start gap-3">
                    <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
                    <div className="flex-1">
                        <p className="text-sm text-red-400">{error}</p>
                    </div>
                </div>
            )}

            <div className="flex items-center justify-between mb-6">
                <div>
                    <h2 className="text-2xl font-bold text-white">My Databases</h2>
                    <p className="text-sm text-slate-400 mt-1">
                        {rooms.length === 0 ? 'No databases yet. Create your first one!' : `${rooms.length} database${rooms.length === 1 ? '' : 's'}`}
                    </p>
                </div>
                <button
                    onClick={() => setShowCreateModal(true)}
                    className="flex items-center gap-2 px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
                >
                    <Plus size={20} />
                    Create Database
                </button>
            </div>

            {rooms.length === 0 ? (
                <div className="text-center py-20 bg-slate-900 border border-slate-800 rounded-xl">
                    <p className="text-slate-500 mb-4">No databases found</p>
                    <button
                        onClick={() => setShowCreateModal(true)}
                        className="inline-flex items-center gap-2 px-6 py-3 bg-green-600 hover:bg-green-700 text-white rounded-lg font-medium transition-colors"
                    >
                        <Plus size={20} />
                        Create Your First Database
                    </button>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
                    {rooms.map(room => (
                        <RoomCard
                            key={room.id}
                            room={room}
                            onSelect={onSelectRoom}
                            onDelete={handleDeleteRoom}
                        />
                    ))}
                </div>
            )}

            {/* Create Room Modal */}
            {showCreateModal && (
                <div className="fixed inset-0 bg-black/50 flex items-center justify-center p-4 z-50">
                    <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 w-full max-w-md">
                        <h3 className="text-xl font-bold text-white mb-4">Create New Database</h3>
                        <form onSubmit={handleCreateRoom} className="space-y-4">
                            <div>
                                <label htmlFor="project-name" className="block text-sm font-medium text-slate-400 mb-1">
                                    Project Name *
                                </label>
                                <input
                                    id="project-name"
                                    type="text"
                                    required
                                    value={projectName}
                                    onChange={handleProjectNameChange}
                                    className="w-full px-4 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-green-500"
                                    placeholder="e.g. My Awesome Project"
                                    autoFocus
                                />
                            </div>
                            <div>
                                <label htmlFor="room-id" className="block text-sm font-medium text-slate-400 mb-1">
                                    Database ID (Slug) *
                                </label>
                                <input
                                    id="room-id"
                                    type="text"
                                    required
                                    value={newRoomId}
                                    onChange={(e) => setNewRoomId(e.target.value.toLowerCase().replace(/[^a-z0-9-]/g, ''))}
                                    className="w-full px-4 py-2 bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-green-500 font-mono text-sm"
                                    placeholder="e.g. my-awesome-project"
                                    minLength={3}
                                />
                                <p className="text-xs text-slate-500 mt-1">Lowercase letters, numbers, and hyphens only. Min 3 characters.</p>
                            </div>
                            <div className="flex gap-3 pt-2">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setShowCreateModal(false);
                                        setNewRoomId('');
                                        setNewRoomName('');
                                        setError(null);
                                    }}
                                    className="flex-1 px-4 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-lg font-medium transition-colors"
                                >
                                    Cancel
                                </button>
                                <button
                                    type="submit"
                                    disabled={creating || !newRoomId.trim()}
                                    className="flex-1 px-4 py-2 bg-green-600 hover:bg-green-700 disabled:bg-slate-700 disabled:cursor-not-allowed text-white rounded-lg font-medium transition-colors flex items-center justify-center gap-2"
                                >
                                    {creating ? (
                                        <>
                                            <Loader2 className="w-4 h-4 animate-spin" />
                                            Creating...
                                        </>
                                    ) : (
                                        'Create Database'
                                    )}
                                </button>
                            </div>
                        </form>
                    </div>
                </div>
            )}

            <ConfirmDialog
                isOpen={!!deleteConfirmRoom}
                onConfirm={confirmDeleteRoom}
                onCancel={() => setDeleteConfirmRoom(null)}
                title="Delete Database"
                message={`Are you sure you want to delete room "${deleteConfirmRoom}"? This action cannot be undone.`}
                confirmLabel="Delete"
                confirmVariant="danger"
            />
        </div>
    );
};
