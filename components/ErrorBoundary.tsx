import React, { Component, ErrorInfo, ReactNode } from 'react';
import { AlertTriangle, RefreshCw } from 'lucide-react';

interface Props {
    children: ReactNode;
}

interface State {
    hasError: boolean;
    error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
    public state: State = {
        hasError: false,
        error: null
    };

    public static getDerivedStateFromError(error: Error): State {
        return { hasError: true, error };
    }

    public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
        console.error('Uncaught error:', error, errorInfo);
    }

    private handleReload = () => {
        window.location.reload();
    };

    public render() {
        if (this.state.hasError) {
            return (
                <div className="flex h-screen items-center justify-center bg-slate-900 text-white">
                    <div className="max-w-md w-full p-8 bg-slate-800 rounded-xl border border-slate-700 text-center">
                        <div className="w-16 h-16 bg-red-500/20 rounded-full flex items-center justify-center mx-auto mb-6">
                            <AlertTriangle size={32} className="text-red-500" />
                        </div>
                        <h2 className="text-2xl font-bold mb-2">Something went wrong</h2>
                        <p className="text-slate-400 mb-6">
                            {this.state.error?.message || 'An unexpected error occurred.'}
                        </p>
                        <button
                            onClick={this.handleReload}
                            className="bg-green-600 hover:bg-green-700 text-white px-6 py-2 rounded-lg font-medium transition-colors flex items-center justify-center gap-2 w-full"
                        >
                            <RefreshCw size={20} />
                            Reload Page
                        </button>
                    </div>
                </div>
            );
        }

        return this.props.children;
    }
}
