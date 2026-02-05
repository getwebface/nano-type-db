import React from 'react';
import { ApiKeys } from './ApiKeys';
import { ArrowLeft } from 'lucide-react';

interface AccountSettingsProps {
    onBack: () => void;
}

export const AccountSettings: React.FC<AccountSettingsProps> = ({ onBack }) => {
    return (
        <div className="min-h-screen bg-slate-950 p-4">
            <div className="max-w-4xl mx-auto">
                <button
                    onClick={onBack}
                    className="flex items-center gap-2 text-slate-400 hover:text-white mb-6 transition-colors"
                >
                    <ArrowLeft size={20} />
                    Back to Databases
                </button>

                <div className="bg-slate-900 border border-slate-800 rounded-xl p-8">
                    <h1 className="text-3xl font-bold text-white mb-2">Account Settings</h1>
                    <p className="text-slate-400 mb-8">Manage your API keys and account preferences</p>

                    <div className="border-t border-slate-800 pt-8">
                        <h2 className="text-xl font-bold text-white mb-4">API Keys</h2>
                        <p className="text-sm text-slate-400 mb-6">
                            API keys allow external applications to access your databases programmatically.
                            These are account-level credentials that work across all your databases.
                        </p>
                        <ApiKeys />
                    </div>
                </div>
            </div>
        </div>
    );
};
