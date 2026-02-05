import React from 'react';
import { Database, Trash2, Clock } from 'lucide-react';

interface RoomCardProps {
    room: {
        id: string;
        name: string;
        created_at: number;
        last_accessed_at?: number;
    };
    onSelect: (roomId: string) => void;
    onDelete: (roomId: string) => void;
}

export const RoomCard: React.FC<RoomCardProps> = ({ room, onSelect, onDelete }) => {
    const formatDate = (timestamp?: number) => {
        if (!timestamp) return 'Never';
        const date = new Date(timestamp);
        const now = new Date();
        const diffMs = now.getTime() - date.getTime();
        const diffMins = Math.floor(diffMs / 60000);
        const diffHours = Math.floor(diffMs / 3600000);
        const diffDays = Math.floor(diffMs / 86400000);

        if (diffMins < 1) return 'Just now';
        if (diffMins < 60) return `${diffMins}m ago`;
        if (diffHours < 24) return `${diffHours}h ago`;
        if (diffDays < 7) return `${diffDays}d ago`;
        return date.toLocaleDateString();
    };

    return (
        <div 
            className="group relative bg-slate-900 border border-slate-800 rounded-xl p-6 hover:border-green-500 hover:shadow-lg hover:shadow-green-500/10 transition-all cursor-pointer"
        >
            <div onClick={() => onSelect(room.id)} className="flex-1">
                <div className="flex items-start gap-4">
                    <div className="flex-shrink-0 w-12 h-12 rounded-lg bg-slate-800 border border-slate-700 flex items-center justify-center group-hover:bg-green-500/10 group-hover:border-green-500/50 transition-all">
                        <Database className="w-6 h-6 text-green-500" />
                    </div>
                    <div className="flex-1 min-w-0">
                        <h3 className="text-lg font-bold text-white truncate group-hover:text-green-400 transition-colors">
                            {room.name}
                        </h3>
                        <p className="text-sm font-mono text-slate-500 truncate mt-1">
                            {room.id}
                        </p>
                        <div className="flex items-center gap-4 mt-3 text-xs text-slate-500">
                            <span className="flex items-center gap-1">
                                <Clock size={12} />
                                {formatDate(room.last_accessed_at)}
                            </span>
                        </div>
                    </div>
                </div>
            </div>
            
            <button
                onClick={(e) => {
                    e.stopPropagation();
                    onDelete(room.id);
                }}
                className="absolute top-4 right-4 p-2 text-slate-500 hover:text-red-500 hover:bg-red-500/10 rounded-lg transition-all opacity-0 group-hover:opacity-100"
                title="Delete room"
            >
                <Trash2 size={16} />
            </button>
        </div>
    );
};
