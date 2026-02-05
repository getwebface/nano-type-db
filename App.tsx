import React, { useState } from 'react';
import { DatabaseProvider, useDatabase } from './hooks/useDatabase';
import { Shell } from './components/Shell';
import { Toaster } from './components/Toaster';
import { ArrowRight, Database } from 'lucide-react';

const ConnectionScreen: React.FC = () => {
    const { connect, isConnected } = useDatabase();
    const [inputRoom, setInputRoom] = useState('demo-room');

    if (isConnected) {
        return <Shell roomId={inputRoom} />;
    }

    return (
        <div className="min-h-screen flex items-center justify-center bg-slate-950 p-4">
            <div className="w-full max-w-md space-y-8">
                <div className="text-center">
                    <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-slate-900 border border-slate-800 mb-6">
                        <Database className="w-8 h-8 text-green-500" />
                    </div>
                    <h2 className="text-3xl font-extrabold text-white tracking-tight">
                        Connect to nanotypeDB
                    </h2>
                    <p className="mt-2 text-sm text-slate-400">
                        Enter a Room ID to spin up a Durable Object.
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
                        className="group w-full flex justify-center py-3 px-4 border border-transparent text-sm font-bold rounded-lg text-white bg-green-600 hover:bg-green-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-green-500 focus:ring-offset-slate-900 transition-all"
                    >
                        Connect
                        <ArrowRight className="ml-2 w-4 h-4 group-hover:translate-x-1 transition-transform" />
                    </button>
                </form>
            </div>
        </div>
    );
};

function App() {
    return (
        <DatabaseProvider>
            <Toaster />
            <ConnectionScreen />
        </DatabaseProvider>
    );
}

export default App;