import React from 'react';
import { 
  LayoutDashboard, 
  Table2, 
  Terminal, 
  Webhook, 
  Settings, 
  HardDrive,
  Brain,
  MessageSquare
} from 'lucide-react';

type ViewState = 'overview' | 'tables' | 'data' | 'chat' | 'sql' | 'webhooks' | 'settings';

interface SidebarProps {
  currentView: ViewState;
  onViewChange: (view: ViewState) => void;
}

export const Sidebar: React.FC<SidebarProps> = ({ currentView, onViewChange }) => {
  const navItems = [
    { id: 'overview' as ViewState, label: 'Overview', icon: LayoutDashboard },
    { id: 'tables' as ViewState, label: 'Tables', icon: Table2 },
    { id: 'data' as ViewState, label: 'Data Explorer', icon: Brain },
    { id: 'chat' as ViewState, label: 'Chat with DB', icon: MessageSquare },
    { id: 'sql' as ViewState, label: 'SQL Runner', icon: Terminal },
    { id: 'webhooks' as ViewState, label: 'Webhooks', icon: Webhook },
    { id: 'settings' as ViewState, label: 'Settings', icon: Settings },
  ];

  return (
    <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col">
      <div className="p-6 border-b border-slate-800">
        <div className="flex items-center gap-3 text-white mb-1">
          <HardDrive className="text-green-500" />
          <h1 className="font-bold text-lg tracking-tight">nanotypeDB</h1>
        </div>
      </div>

      <nav className="flex-1 p-4 space-y-1">
        <div className="flex items-center justify-between px-2 mb-3">
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Navigation</p>
        </div>
        
        {navItems.map(item => {
          const Icon = item.icon;
          return (
            <button
              key={item.id}
              onClick={() => onViewChange(item.id)}
              className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-all ${
                currentView === item.id
                  ? 'bg-slate-800 text-green-400' 
                  : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
              }`}
            >
              <Icon size={18} />
              {item.label}
            </button>
          );
        })}
      </nav>
    </aside>
  );
};
