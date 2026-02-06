import React from 'react';
import { useDatabase } from '../hooks/useDatabase';
import { Bell, CheckCircle, AlertTriangle, Info } from 'lucide-react';

const toastStyles: Record<string, { border: string; text: string; icon: React.ReactNode }> = {
    success: { border: 'border-green-500', text: 'text-green-400', icon: <CheckCircle size={18} /> },
    error: { border: 'border-red-500', text: 'text-red-400', icon: <AlertTriangle size={18} /> },
    info: { border: 'border-blue-500', text: 'text-blue-400', icon: <Info size={18} /> },
};

export const Toaster: React.FC = () => {
    const { toasts } = useDatabase();

    return (
        <div className="fixed top-4 right-4 z-[60] flex flex-col gap-2 pointer-events-none">
            {toasts.map((toast) => {
                const style = toastStyles[toast.type] || toastStyles.info;
                return (
                    <div 
                        key={toast.id}
                        className={`flex items-center gap-3 bg-slate-800 border ${style.border} ${style.text} px-4 py-3 rounded shadow-lg animate-bounce-in pointer-events-auto`}
                    >
                        {style.icon}
                        <span className="text-sm font-medium">{toast.message}</span>
                    </div>
                );
            })}
        </div>
    );
};
