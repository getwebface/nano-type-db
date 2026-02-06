import React from 'react';
import { Circle, Users } from 'lucide-react';

interface TopbarProps {
  roomId: string;
  status: 'disconnected' | 'connecting' | 'connected';
  presenceData?: any[];
  onExit?: () => void;
}

export const Topbar: React.FC<TopbarProps> = ({ roomId, status, presenceData = [], onExit }) => {
  return (
    <div className="px-8 py-4 border-b border-slate-800 bg-slate-900 flex items-center justify-between">
      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-xs text-slate-500">
          <Circle 
            size={8} 
            className={`${
              status === 'connected' 
                ? 'text-green-500 fill-current' 
                : status === 'connecting'
                ? 'text-yellow-500 fill-current animate-pulse'
                : 'text-red-500 fill-current'
            }`} 
          />
          <span className="font-mono">{roomId}</span>
          <span className={`ml-2 text-xs ${
            status === 'connected' 
              ? 'text-green-500' 
              : status === 'connecting'
              ? 'text-yellow-500'
              : 'text-red-500'
          }`}>
            {status}
          </span>
        </div>

        {/* Active Users Presence */}
        {presenceData.length > 0 && (
          <div className="flex items-center gap-2 ml-4">
            <Users size={14} className="text-slate-500" />
            <span className="text-xs text-slate-500">
              {presenceData.length} active {presenceData.length === 1 ? 'user' : 'users'}
            </span>
            <div className="flex -space-x-2 ml-2">
              {presenceData.slice(0, 5).map((user) => (
                <div
                  key={user.userId}
                  className="w-6 h-6 rounded-full bg-gradient-to-br from-green-400 to-blue-500 border-2 border-slate-900 flex items-center justify-center text-xs font-bold text-white"
                  title={user.userId}
                >
                  {user.userId.substring(0, 2).toUpperCase()}
                </div>
              ))}
              {presenceData.length > 5 && (
                <div className="w-6 h-6 rounded-full bg-slate-800 border-2 border-slate-900 flex items-center justify-center text-xs font-bold text-slate-400">
                  +{presenceData.length - 5}
                </div>
              )}
            </div>
          </div>
        )}
      </div>

      {onExit && (
        <button
          onClick={onExit}
          className="text-xs text-slate-400 hover:text-white transition-colors"
        >
          Exit Project
        </button>
      )}
    </div>
  );
};
