import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { DatabaseContextType, QueryResult, UpdateEvent, ToastMessage, Schema } from '../types';

// Mock Worker URL - in production this would be your Cloudflare Worker domain
// For local dev with `wrangler dev`, it usually runs on port 8787
const WORKER_URL = 'ws://localhost:8787'; 
const HTTP_URL = 'http://localhost:8787'; // Helper for fetch requests
const DEMO_TOKEN = 'demo-token'; // Hardcoded for demo purposes

const DatabaseContext = createContext<DatabaseContextType | null>(null);

export const DatabaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [socket, setSocket] = useState<WebSocket | null>(null);
    const [isConnected, setIsConnected] = useState(false);
    const [lastResult, setLastResult] = useState<QueryResult | null>(null);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [schema, setSchema] = useState<Schema | null>(null);
    const currentRoomIdRef = useRef<string>("");
    
    const subscribedTablesRef = useRef<Set<string>>(new Set());

    const addToast = (message: string) => {
        const id = Math.random().toString(36).substring(7);
        setToasts(prev => [...prev, { id, message, type: 'info' }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 3000);
    };

    const refreshSchema = useCallback(async () => {
        if (!currentRoomIdRef.current) return;
        try {
            // Pass Authorization header
            const res = await fetch(`${HTTP_URL}/schema?room_id=${currentRoomIdRef.current}`, {
                headers: { 'Authorization': `Bearer ${DEMO_TOKEN}` }
            });
            if (res.ok) {
                const data = await res.json();
                setSchema(data);
            }
        } catch (e) {
            console.error("Failed to fetch schema", e);
        }
    }, []);

    const connect = useCallback((roomId: string) => {
        if (socket) {
            socket.close();
        }

        currentRoomIdRef.current = roomId;
        // Pass token in query param for WebSocket connection
        const ws = new WebSocket(`${WORKER_URL}?room_id=${roomId}&token=${DEMO_TOKEN}`);

        ws.onopen = () => {
            console.log('Connected to DO');
            setIsConnected(true);
            // Fetch schema immediately upon connection
            refreshSchema();
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.type === 'query_result') {
                setLastResult(data);
            } else if (data.event === 'update') {
                addToast(`Table '${data.table}' updated`);
                window.dispatchEvent(new CustomEvent('db-update', { detail: { table: data.table } }));
            } else if (data.error) {
                addToast(`Error: ${data.error}`);
            }
        };

        ws.onclose = () => {
            setIsConnected(false);
            setSocket(null);
            setSchema(null);
        };

        setSocket(ws);
    }, [socket, refreshSchema]);

    const runQuery = useCallback((sql: string, tableContext?: string) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        
        // Simple heuristic to detect if this is a "Create Task" intent from the demo UI
        // In a real app, you would call a specific function like `createTask()`
        const isInsertTask = /INSERT INTO tasks/i.test(sql);
        
        if (isInsertTask) {
             // EXTRACT TITLE for RPC
             // Very basic regex to extract 'Value' from: INSERT INTO tasks ... VALUES ('Value', ...)
             const match = sql.match(/VALUES\s*\(\s*'([^']*)'/i);
             const title = match ? match[1] : "New Task";
             
             socket.send(JSON.stringify({
                 action: 'createTask',
                 payload: { title }
             }));
             return;
        }

        // Fallback for other queries (Read-Only)
        const isMutation = /^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/i.test(sql.trim());
        const isSchemaChange = /^(CREATE|ALTER|DROP)/i.test(sql.trim());

        // We still send "mutate" for other things, but backend will likely reject it now.
        const payload = {
            action: isMutation ? 'mutate' : 'query',
            sql,
            table: tableContext
        };

        socket.send(JSON.stringify(payload));

        if (isSchemaChange) {
            setTimeout(refreshSchema, 500);
        }

    }, [socket, refreshSchema]);

    const subscribe = useCallback((table: string) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        subscribedTablesRef.current.add(table);
        socket.send(JSON.stringify({ action: 'subscribe', table }));
    }, [socket]);

    return (
        <DatabaseContext.Provider value={{ isConnected, connect, runQuery, subscribe, lastResult, toasts, schema, refreshSchema }}>
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

    useEffect(() => {
        if (isConnected && tableName) {
            subscribe(tableName);
            runQuery(`SELECT * FROM ${tableName}`, tableName);
        }
    }, [isConnected, tableName, subscribe, runQuery]);

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

    useEffect(() => {
        if (lastResult && lastResult.originalSql && lastResult.originalSql.includes(tableName) && !lastResult.originalSql.toLowerCase().startsWith('insert')) {
             setData(lastResult.data);
        }
    }, [lastResult, tableName]);

    return data;
};
