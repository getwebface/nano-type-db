import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { DatabaseContextType, QueryResult, UpdateEvent, ToastMessage, Schema, UsageStat, OptimisticUpdate } from '../types';

// Dynamic URL detection for production/dev
const PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const HOST = window.location.host; 
const WORKER_URL = `${PROTOCOL}//${HOST}`; 
const HTTP_URL = `${window.location.protocol}//${HOST}`;

// Configuration constants
const OPTIMISTIC_UPDATE_TIMEOUT = 10000; // 10 seconds

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
    const pendingOptimisticUpdates = useRef<Map<string, OptimisticUpdate>>(new Map());
    
    const subscribedTablesRef = useRef<Set<string>>(new Set());

    const addToast = (message: string, type: 'success' | 'info' | 'error' = 'info') => {
        const id = Math.random().toString(36).substring(7);
        setToasts(prev => [...prev, { id, message, type }]);
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
            } else if (data.type === 'mutation_success') {
                // Remove optimistic update from pending queue on success
                const updateId = data.updateId;
                if (updateId && pendingOptimisticUpdates.current.has(updateId)) {
                    pendingOptimisticUpdates.current.delete(updateId);
                }
                addToast(`Action '${data.action}' completed`, 'success');
            } else if (data.type === 'mutation_error') {
                // Rollback optimistic update on error
                const updateId = data.updateId;
                if (updateId && pendingOptimisticUpdates.current.has(updateId)) {
                    const update = pendingOptimisticUpdates.current.get(updateId)!;
                    update.rollback();
                    pendingOptimisticUpdates.current.delete(updateId);
                    addToast(`Action '${data.action}' failed - rolled back`, 'error');
                }
            } else if (data.event === 'update') {
                addToast(`Table '${data.table}' updated`);
                // Pass diff data with the event
                window.dispatchEvent(new CustomEvent('db-update', { 
                    detail: { 
                        table: data.table,
                        diff: data.diff,
                        fullData: data.fullData
                    } 
                }));
            } else if (data.error) {
                addToast(`Error: ${data.error}`, 'error');
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

    const performOptimisticAction = useCallback((action: string, payload: any, optimisticUpdate: () => void, rollback: () => void) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        
        // Generate unique ID for this update
        const updateId = Math.random().toString(36).substring(7);
        
        // Apply optimistic update immediately
        optimisticUpdate();
        
        // Store rollback function
        pendingOptimisticUpdates.current.set(updateId, {
            id: updateId,
            action,
            payload,
            rollback,
            timestamp: Date.now()
        });
        
        // Send to server with updateId
        socket.send(JSON.stringify({
            action,
            payload,
            updateId
        }));
        
        // Auto-rollback after timeout if no response
        setTimeout(() => {
            if (pendingOptimisticUpdates.current.has(updateId)) {
                const update = pendingOptimisticUpdates.current.get(updateId)!;
                update.rollback();
                pendingOptimisticUpdates.current.delete(updateId);
                addToast(`Action '${action}' timed out - rolled back`, 'error');
            }
        }, OPTIMISTIC_UPDATE_TIMEOUT);
    }, [socket]);

    const subscribe = useCallback((table: string) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        subscribedTablesRef.current.add(table);
        socket.send(JSON.stringify({ action: 'subscribe', table }));
    }, [socket]);

    return (
        <DatabaseContext.Provider value={{ status, isConnected, connect, runQuery, subscribe, lastResult, toasts, schema, refreshSchema, usageStats, refreshUsage, performOptimisticAction }}>
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
                const { diff, fullData } = customEvent.detail;
                
                // If we have diff data, apply it instead of re-fetching
                if (diff && (diff.added.length > 0 || diff.modified.length > 0 || diff.deleted.length > 0)) {
                    setData(currentData => {
                        // Detect primary key field from first row (try 'id' first, then any field ending with 'id')
                        const sampleRow = currentData[0] || diff.added[0] || diff.modified[0] || diff.deleted[0];
                        if (!sampleRow) return currentData;
                        
                        const pkField = sampleRow.hasOwnProperty('id') 
                            ? 'id' 
                            : Object.keys(sampleRow).find(k => k.toLowerCase().endsWith('id')) || 'id';
                        
                        // If rows don't have the detected PK field, fall back to full data
                        if (!sampleRow.hasOwnProperty(pkField)) {
                            return fullData || currentData;
                        }
                        
                        // Create a map for fast lookups
                        const dataMap = new Map(currentData.map(row => [row[pkField], row]));
                        
                        // Remove deleted items
                        diff.deleted.forEach((item: any) => {
                            if (item[pkField] !== undefined) {
                                dataMap.delete(item[pkField]);
                            }
                        });
                        
                        // Add/update modified items
                        diff.modified.forEach((item: any) => {
                            if (item[pkField] !== undefined) {
                                dataMap.set(item[pkField], item);
                            }
                        });
                        
                        // Add new items
                        diff.added.forEach((item: any) => {
                            if (item[pkField] !== undefined) {
                                dataMap.set(item[pkField], item);
                            }
                        });
                        
                        return Array.from(dataMap.values());
                    });
                } else if (fullData) {
                    // Fallback to full data if diff is not available or empty
                    setData(fullData);
                } else {
                    // Fallback to re-fetching if no diff or fullData
                    runQuery(`SELECT * FROM ${tableName}`, tableName);
                }
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