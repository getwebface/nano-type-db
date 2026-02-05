import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { DatabaseContextType, QueryResult, UpdateEvent, ToastMessage, Schema, UsageStat } from '../types';

// Dynamic URL detection for production/dev
const PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const HOST = window.location.host; 
const WORKER_URL = `${PROTOCOL}//${HOST}`; 
const HTTP_URL = `${window.location.protocol}//${HOST}`;

const DatabaseContext = createContext<DatabaseContextType | null>(null);

export const DatabaseProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
    const [socket, setSocket] = useState<WebSocket | null>(null);
    const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
    const [isConnected, setIsConnected] = useState(false);
    const [lastResult, setLastResult] = useState<QueryResult | null>(null);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [schema, setSchema] = useState<Schema | null>(null);
    const [usageStats, setUsageStats] = useState<UsageStat[]>([]);
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
            // Browser automatically sends Cookies (Better Auth Session)
            const res = await fetch(`${HTTP_URL}/schema?room_id=${currentRoomIdRef.current}`);
            if (res.ok) {
                const data = await res.json();
                setSchema(data);
            }
        } catch (e) {
            console.error("Failed to fetch schema", e);
        }
    }, []);

    const refreshUsage = useCallback(() => {
        if (socket && socket.readyState === WebSocket.OPEN) {
             socket.send(JSON.stringify({ action: 'rpc', method: 'getUsage' }));
        }
    }, [socket]);

    const connect = useCallback((roomId: string) => {
        if (socket) {
            socket.onclose = null;
            socket.close();
        }

        setStatus('connecting');
        currentRoomIdRef.current = roomId;
        
        // Browser automatically sends Cookies (Better Auth Session) with WebSocket
        const ws = new WebSocket(`${WORKER_URL}?room_id=${roomId}`);

        ws.onopen = () => {
            console.log('Connected to DO');
            setStatus('connected');
            setIsConnected(true);
            refreshSchema();
            // Initial usage fetch
            setTimeout(() => {
                ws.send(JSON.stringify({ action: 'rpc', method: 'getUsage' }));
            }, 500);
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);

            if (data.type === 'query_result') {
                if (data.originalSql === 'getUsage') {
                    setUsageStats(data.data);
                } else if (data.originalSql === 'getAuditLog') {
                    // Handle audit log if needed
                } else {
                    setLastResult(data);
                }
            } else if (data.event === 'update') {
                addToast(`Table '${data.table}' updated`);
                window.dispatchEvent(new CustomEvent('db-update', { detail: { table: data.table } }));
            } else if (data.error) {
                addToast(`Error: ${data.error}`);
            }
        };

        ws.onclose = () => {
            setIsConnected(false);
            setStatus('disconnected');
            setSocket(null);
            setSchema(null);
        };

        setSocket(ws);
    }, [socket, refreshSchema]);

    const runQuery = useCallback((sql: string, tableContext?: string) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        
        const isInsertTask = /INSERT INTO tasks/i.test(sql);
        
        if (isInsertTask) {
             const match = sql.match(/VALUES\s*\(\s*'([^']*)'/i);
             const title = match ? match[1] : "New Task";
             
             socket.send(JSON.stringify({
                 action: 'createTask',
                 payload: { title }
             }));
             return;
        }

        const isMutation = /^(INSERT|UPDATE|DELETE|CREATE|ALTER|DROP)/i.test(sql.trim());
        const isSchemaChange = /^(CREATE|ALTER|DROP)/i.test(sql.trim());

        const payload = {
            action: isMutation ? 'mutate' : 'query',
            sql,
            table: tableContext
        };

        socket.send(JSON.stringify(payload));

        if (isSchemaChange) {
            setTimeout(refreshSchema, 500);
        }
        
        // Refresh usage stats after queries (demo purpose)
        setTimeout(refreshUsage, 1000);

    }, [socket, refreshSchema, refreshUsage]);

    const subscribe = useCallback((table: string) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        subscribedTablesRef.current.add(table);
        socket.send(JSON.stringify({ action: 'subscribe', table }));
    }, [socket]);

    return (
        <DatabaseContext.Provider value={{ status, isConnected, connect, runQuery, subscribe, lastResult, toasts, schema, refreshSchema, usageStats, refreshUsage }}>
            {children}
        </DatabaseContext.Provider>
    );
};

export const useDatabase = () => {
    const context = useContext(DatabaseContext);
    if (!context) throw new Error("useDatabase must be used within DatabaseProvider");
    return context;
};

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