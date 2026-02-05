import React, { useState } from 'react';
import { DatabaseProvider, useDatabase } from './hooks/useDatabase';
import { Shell } from './components/Shell';
import { Toaster } from './components/Toaster';
import { AuthScreen } from './components/AuthScreen';
import { authClient } from './src/lib/auth-client';
import { ArrowRight, Database, LogOut, Loader2 } from 'lucide-react';

const ConnectionScreen: React.FC = () => {
    const { connect, isConnected, status } = useDatabase();
    const [inputRoom, setInputRoom] = useState('demo-room');
    
    // Allow user to logout
    const handleLogout = async () => {
        await authClient.signOut();
        window.location.reload();
    };

    if (isConnected) {
        return <Shell roomId={inputRoom} />;
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4 relative">
            <button 
                onClick={handleLogout}
                className="absolute top-4 right-4 flex items-center gap-2 text-slate-400 hover:text-white text-sm"
            >
                <LogOut size={16} /> Sign Out
            </button>

            <div className="w-full max-w-md space-y-8">
                <div className="text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-900 border border-slate-800 mb-6">
                        <Database className="w-8 h-8 text-green-500" />
                    </div>
                    <h2 className="text-3xl font-extrabold text-white tracking-tight">
                        Connect Database
                    </h2>
                    <p className="mt-2 text-sm text-slate-400">
                        Enter a Room ID to spin up your instance.
                    </p>
                </div>
                
                <form 
                    onSubmit={(e) => { e.preventDefault(); connect(inputRoom); }}
                    className="mt-8 space-y-6 bg-slate-900 p-8 rounded-xl border border-slate-800 shadow-2xl"
                >
                    <div>
                        <label htmlFor="room-id" className="block text-sm font-medium text-slate-400">
                            Room ID
                        </label>
                        <input
                            id="room-id"
                            type="text"
                            required
                            value={inputRoom}
                            onChange={(e) => setInputRoom(e.target.value)}
                            className="mt-1 block w-full px-4 py-3 bg-slate-950 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-green-500 focus:border-transparent transition-all"
                            placeholder="e.g. my-production-db"
                        />
                    </div>

                    <button
                        type="submit"
                        disabled={status === 'connecting'}
                        className="group w-full flex justify-center py-3 px-4 border border-transparent text-sm font-bold rounded-lg text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 focus:ring-offset-slate-900 transition-all"
                    >
                        {status === 'connecting' ? (
                            <span className="flex items-center gap-2">
                                <Loader2 className="animate-spin" /> Waking up Database...
                            </span>
                        ) : (
                            <>
                            Connect
                            <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                            </>
                        )}
                    </button>
                </form>
            </div>
        </div>
    );
};

function App() {
    // Check session status using Better Auth hook
    const { data: session, isPending } = authClient.useSession();

    if (isPending) {
        return <div className="min-h-screen bg-slate-950 flex items-center justify-center text-slate-500">Loading...</div>;
    }

    if (!session) {
        return <AuthScreen />;
    }

    return (
        <DatabaseProvider psychic={true}>
            <Toaster />
            <ConnectionScreen />
        </DatabaseProvider>
    );
}

export default App;