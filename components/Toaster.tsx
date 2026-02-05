import React from 'react';
import { useDatabase } from '../hooks/useDatabase';
import { Bell } from 'lucide-react';

export const Toaster: React.FC = () => {
    const { toasts } = useDatabase();

    return (
        <div className="fixed top-4 right-4 z-50 flex flex-col gap-2">
            {toasts.map((toast) => (
                <div 
                    key={toast.id}
                    className="flex items-center gap-3 bg-slate-800 border border-green-500 text-green-400 px-4 py-3 rounded shadow-lg animate-bounce-in"
                >
                    <Bell size={18} />
                    <span className="text-sm font-medium">{toast.message}</span>
                </div>
            ))}
        </div>
    );
};
