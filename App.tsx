import React, { useState } from 'react';
import { DatabaseProvider, useDatabase } from './hooks/useDatabase';
import { ProjectLayout } from './components/layout/ProjectLayout';
import { Toaster } from './components/Toaster';
import { AuthScreen } from './components/AuthScreen';
import { RoomSelection } from './components/RoomSelection';
import { AccountSettings } from './components/AccountSettings';
import { authClient } from './src/lib/auth-client';
import { LogOut, Settings } from 'lucide-react';

type AppView = 'rooms' | 'settings' | 'shell';

const ConnectionScreen: React.FC<{ userTier: string }> = ({ userTier }) => {
    const { connect, isConnected } = useDatabase();
    const [currentView, setCurrentView] = useState<AppView>('rooms');
    const [selectedRoom, setSelectedRoom] = useState<string>('');
    
    // Allow user to logout
    const handleLogout = async () => {
        await authClient.signOut();
        window.location.reload();
    };

    const handleSelectRoom = (roomId: string) => {
        setSelectedRoom(roomId);
        connect(roomId);
    };

    if (isConnected && selectedRoom) {
        return <ProjectLayout roomId={selectedRoom} userTier={userTier} />;
    }

    if (currentView === 'settings') {
        return <AccountSettings onBack={() => setCurrentView('rooms')} />;
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4 relative">
            <div className="absolute top-4 right-4 flex items-center gap-2">
                <button 
                    onClick={() => setCurrentView(currentView === 'settings' ? 'rooms' : 'settings')}
                    className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors"
                >
                    <Settings size={16} /> {currentView === 'settings' ? 'Databases' : 'Settings'}
                </button>
                <button 
                    onClick={handleLogout}
                    className="flex items-center gap-2 text-slate-400 hover:text-white text-sm transition-colors"
                >
                    <LogOut size={16} /> Sign Out
                </button>
            </div>

            <RoomSelection onSelectRoom={handleSelectRoom} />
        </div>
    );
};

function App() {
    // Check session status using Better Auth hook
    const { data: session, isPending } = authClient.useSession();
    const [userTier, setUserTier] = useState<string>('free');

    // Fetch user tier when session is available
    React.useEffect(() => {
        if (session?.user?.id) {
            // Fetch user tier from the server
            // The endpoint authenticates the session and extracts the user ID
            fetch(`/api/user-tier`)
                .then(res => res.json())
                .then(data => {
                    if (data.tier) {
                        setUserTier(data.tier);
                    }
                })
                .catch(err => {
                    console.error('Failed to fetch user tier:', err);
                    // Default to free tier on error
                    setUserTier('free');
                });
        }
    }, [session?.user?.id]);

    if (isPending) {
        return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500">Loading...</div>;
    }

    if (!session) {
        return <AuthScreen />;
    }

    // Only enable psychic auto-sensing for pro tier users
    const isPro = userTier === 'pro';

    return (
        <DatabaseProvider psychic={isPro}>
            <Toaster />
            <ConnectionScreen userTier={userTier} />
        </DatabaseProvider>
    );
}

export default App;