import React, { useState, useEffect } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { Sidebar } from './Sidebar';
import { Topbar } from './Topbar';
import { Overview } from '../views/Overview';
import { TablesView } from '../views/TablesView';
import { DataExplorer } from '../views/DataExplorer';
import { ChatDatabase } from '../views/ChatDatabase';
import { SqlRunner } from '../views/SqlRunner';
import { WebhooksView } from '../views/Webhooks';
import { ProjectSettings } from '../views/ProjectSettings';

type ViewState = 'overview' | 'tables' | 'data' | 'chat' | 'sql' | 'webhooks' | 'settings';

export const ProjectLayout: React.FC<{ roomId: string; onExit?: () => void; userTier?: string }> = ({ roomId, onExit, userTier }) => {
  const [currentView, setCurrentView] = useState<ViewState>('overview');
  const { status, usageStats, rpc } = useDatabase();
  const [presenceData, setPresenceData] = useState<any[]>([]);

  // Fetch presence data periodically
  useEffect(() => {
    const fetchPresence = async () => {
      try {
        const result = await rpc('getPresence', {});
        if (result?.data) {
          setPresenceData(result.data);
        }
      } catch (e) {
        console.error('Failed to fetch presence:', e);
      }
    };

    fetchPresence();
    const interval = setInterval(fetchPresence, 5000); // Update every 5 seconds
    return () => clearInterval(interval);
  }, [rpc]);

  const renderView = () => {
    switch (currentView) {
      case 'overview':
        return <Overview roomId={roomId} usageStats={usageStats} />;
      case 'tables':
        return <TablesView />;
      case 'data':
        return <DataExplorer />;
      case 'chat':
        return <ChatDatabase />;
      case 'sql':
        return <SqlRunner />;
      case 'webhooks':
        return <WebhooksView />;
      case 'settings':
        return <ProjectSettings />;
      default:
        return <Overview roomId={roomId} usageStats={usageStats} />;
    }
  };

  return (
    <div className="flex h-screen overflow-hidden bg-slate-900 text-slate-100 font-sans">
      <Sidebar currentView={currentView} onViewChange={setCurrentView} />
      
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <Topbar 
          roomId={roomId} 
          status={status} 
          presenceData={presenceData}
          onExit={onExit}
          userTier={userTier}
        />
        
        <div className="flex-1 overflow-hidden">
          {renderView()}
        </div>
      </main>
    </div>
  );
};
