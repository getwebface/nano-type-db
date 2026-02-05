import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { DatabaseContextType, QueryResult, UpdateEvent, ToastMessage } from '../types';

// Mock Worker URL - in production this would be your Cloudflare Worker domain
// For local dev with `wrangler dev`, it usually runs on port 8787
const WORKER_URL = 'ws://localhost:8787'; 

const DatabaseContext = createContext<DatabaseContextType | null>(null);

export const DatabaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [socket, setSocket] = useState<WebSocket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [lastResult, setLastResult] = useState<QueryResult | null>(null);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    
    // We need to keep track of subscribed tables to re-fetch on update
    const subscribedTablesRef = useRef<Set<string>>(new Set());

    const addToast = (message: string) => {
        const id = Math.random().toString(36).substring(7);
        setToasts(prev => [...prev, { id, message, type: 'info' }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 3000);
    };

    const connect = useCallback((roomId: string) => {
        if (socket) {
            socket.close();
        }

        const ws = new WebSocket(`${WORKER_URL}?room_id=${roomId}`);

        ws.onopen = () => {
            console.log('Connected to DO');
            setIsConnected(true);
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.type === 'query_result') {
                setLastResult(data);
            } else if (data.event === 'update') {
                addToast(`Table '${data.table}' updated externally`);
                
                // Magic: Auto re-fetch if we are viewing this table
                // In a real generic hook, we might use an event bus, 
                // but here we will rely on the UI component to trigger the refresh 
                // via a side-effect or we can expose an event emitter.
                // For simplicity in this demo, we broadcast the event to the context
                // effectively by triggering a state update that consumers listen to.
                // However, the cleanest way is to just let the consumer (useRealtimeQuery)
                // handle the refetch based on a signal.
                
                // We'll update a trigger to notify hooks
                window.dispatchEvent(new CustomEvent('db-update', { detail: { table: data.table } }));
            }
        };

        ws.onclose = () => {
            setIsConnected(false);
            setSocket(null);
        };

        setSocket(ws);
    }, [socket]);

    const runQuery = useCallback((sql: string, tableContext?: string) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        
        // If it's an INSERT/UPDATE/DELETE, we assume it's a mutation
        const isMutation = /^(INSERT|UPDATE|DELETE)/i.test(sql.trim());
        
        const payload = {
            action: isMutation ? 'mutate' : 'query',
            sql,
            table: tableContext
        };

        socket.send(JSON.stringify(payload));
    }, [socket]);

    const subscribe = useCallback((table: string) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        subscribedTablesRef.current.add(table);
        socket.send(JSON.stringify({ action: 'subscribe', table }));
    }, [socket]);

    return (
        <DatabaseContext.Provider value={{ isConnected, connect, runQuery, subscribe, lastResult, toasts }}>
            {children}
        </DatabaseContext.Provider>
    );
};

export const useDatabase = () => {
    const context = useContext(DatabaseContext);
    if (!context) throw new Error("useDatabase must be used within DatabaseProvider");
    return context;
};

// The "Convex-like" Hook
export const useRealtimeQuery = (tableName: string) => {
    const { runQuery, subscribe, lastResult, isConnected } = useDatabase();
    const [data, setData] = useState<any[]>([]);

    // Initial Subscribe and Fetch
    useEffect(() => {
        if (isConnected && tableName) {
            subscribe(tableName);
            runQuery(`SELECT * FROM ${tableName}`, tableName);
        }
    }, [isConnected, tableName, subscribe, runQuery]);

    // Listen for global updates via the event dispatched in Provider
    useEffect(() => {
        const handleUpdate = (e: Event) => {
            const customEvent = e as CustomEvent;
            if (customEvent.detail.table === tableName) {
                runQuery(`SELECT * FROM ${tableName}`, tableName);
            }
        };

        window.addEventListener('db-update', handleUpdate);
        return () => window.removeEventListener('db-update', handleUpdate);
    }, [tableName, runQuery]);

    // Update local state when query results come in
    useEffect(() => {
        if (lastResult && lastResult.originalSql.includes(tableName) && !lastResult.originalSql.toLowerCase().startsWith('insert')) {
             // Basic check to ensure the result belongs to this view
             // In a robust app, we'd use Request IDs.
             setData(lastResult.data);
        }
    }, [lastResult, tableName]);

    return data;
};
