import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { useWebSocket } from 'partysocket/react';
import { DatabaseContextType, QueryResult, ToastMessage, Schema, UsageStat, OptimisticUpdate } from '../types';
import { authClient } from '../src/lib/auth-client';

// Dynamic URL detection for production/dev
const HOST = window.location.host;
const WS_PROTOCOL = window.location.protocol === 'https:' ? 'wss' : 'ws';
const HTTP_URL = `${window.location.protocol}//${HOST}`;

// In development with Vite proxy, use proxied WebSocket path
const IS_DEV = import.meta.env.DEV;
const WS_BASE_PATH = IS_DEV ? '__ws/websocket' : 'websocket';

// Configuration constants
const OPTIMISTIC_UPDATE_TIMEOUT = 10000; // 10 seconds

const DatabaseContext = createContext<DatabaseContextType | null>(null);

export const DatabaseProvider: React.FC<{ children: React.ReactNode; psychic?: boolean; apiKey?: string }> = ({ children, psychic = false, apiKey }) => {
    const [roomId, setRoomId] = useState<string>('');
    const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
    const [isConnected, setIsConnected] = useState(false);
    const [lastResult, setLastResult] = useState<QueryResult | null>(null);
    const [toasts, setToasts] = useState<ToastMessage[]>([]);
    const [schema, setSchema] = useState<Schema | null>(null);
    const [usageStats, setUsageStats] = useState<UsageStat[]>([]);
    const currentRoomIdRef = useRef<string>("");
    const pendingOptimisticUpdates = useRef<Map<string, OptimisticUpdate>>(new Map());
    const pendingRequests = useRef<Map<string, { resolve: (value: any) => void; reject: (reason?: any) => void }>>(new Map());
    const subscribedTablesRef = useRef<Set<string>>(new Set());

    const { data: sessionData } = authClient.useSession();

    // Reconnection countdown state
    const [reconnectInfo, setReconnectInfo] = useState<{ attempt: number; maxAttempts: number; nextRetryAt: number | null }>({
        attempt: 0,
        maxAttempts: 0,
        nextRetryAt: null
    });

    // Connection quality metrics
    const [connectionQuality, setConnectionQuality] = useState<{ latency: number; pingsLost: number; totalPings: number }>({
        latency: 0,
        pingsLost: 0,
        totalPings: 0
    });

    // WebSocket debug mode
    const [wsDebug, setWsDebug] = useState<boolean>(IS_DEV);
    
    // Psychic cache for pre-fetched data (ref to avoid re-renders)
    const psychicCache = useRef<Map<string, any>>(new Map());
    const debounceTimerRef = useRef<NodeJS.Timeout | null>(null);
    
    // Track current cursor and presence for re-announcing after reset
    const lastCursorRef = useRef<{ userId: string; position: any } | null>(null);
    const lastPresenceRef = useRef<{ userId: string; status: any } | null>(null);
    
    const addToast = (message: string, type: 'success' | 'info' | 'error' = 'info') => {
        const id = Math.random().toString(36).substring(7);
        setToasts(prev => [...prev, { id, message, type }]);
        setTimeout(() => {
            setToasts(prev => prev.filter(t => t.id !== id));
        }, 3000);
    };

    /** Debug logger - only logs when wsDebug is enabled */
    const wsLog = useCallback((...args: any[]) => {
        if (wsDebug) {
            console.log('[WS Debug]', ...args);
        }
    }, [wsDebug]);

    function handleSocketMessage(event: MessageEvent) {
        const data = JSON.parse(event.data);

        if (data.requestId && pendingRequests.current.has(data.requestId)) {
            const { resolve, reject } = pendingRequests.current.get(data.requestId)!;
            if (data.type === 'error' || data.type === 'rpc_error' || data.type === 'mutation_error') {
                reject(new Error(data.error || 'RPC call failed'));
            } else {
                resolve(data);
            }
            pendingRequests.current.delete(data.requestId);
        }

        // Handle psychic_push message for pre-fetched data
        if (data.type === 'psychic_push') {
            console.log('🔮 Psychic Catch - Storing data in cache');
            if (data.data && Array.isArray(data.data)) {
                data.data.forEach((record: any) => {
                    if (record.id) {
                        psychicCache.current.set(String(record.id), record);
                    }
                });
            }
            return;
        }

        // Handle schema_update message for reactive schema changes
        if (data.type === 'schema_update') {
            console.log('🔄 Schema Update - Refreshing schema');
            if (data.schema) {
                setSchema(data.schema);
            } else {
                // Fallback: fetch schema from HTTP endpoint
                refreshSchema();
            }
            return;
        }

        if (data.type === 'query_result') {
            if (data.originalSql === 'getUsage') {
                setUsageStats(data.data);
            } else if (data.originalSql === 'getAuditLog') {
                // Handle audit log if needed
            } else {
                setLastResult(data);
            }
        } else if (data.type === 'error') {
             if (data.code === 'TABLE_NOT_FOUND' && data.details?.table) {
                addToast(`Table '${data.details.table}' not found. Please create it first.`, 'error');
                // Trigger Create Table Modal via window event (handled in App.tsx)
                window.dispatchEvent(new CustomEvent('open-create-table-modal', { 
                    detail: { tableName: data.details.table } 
                }));
             } else {
                addToast(data.error || 'An error occurred', 'error');
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
            // Pass action-based update data with the event
            window.dispatchEvent(new CustomEvent('db-update', { 
                detail: { 
                    table: data.table,
                    action: data.action, // 'added', 'modified', 'deleted'
                    row: data.row,
                    // Legacy support for old diff format (if needed)
                    diff: data.diff,
                    fullData: data.fullData
                } 
            }));
        } else if (data.error) {
            addToast(`Error: ${data.error}`, 'error');
        }
    }

    const BASE_WS_URL = `${WS_PROTOCOL}://${HOST}/${WS_BASE_PATH}`;

    const socket = useWebSocket(BASE_WS_URL, undefined, {
        query: {
            room_id: roomId,
            ...(apiKey ? { key: apiKey } : {}),
            ...(sessionData?.session?.token ? { session_token: sessionData.session.token } : {})
        },
        enabled: Boolean(roomId),
        onOpen: () => {
            wsLog('Connected to WebSocket');
            setStatus('connected');
            setIsConnected(true);
            setReconnectInfo({ attempt: 0, maxAttempts: 0, nextRetryAt: null });
            setConnectionQuality({ latency: 0, pingsLost: 0, totalPings: 0 });
            addToast('Connected to database', 'success');

            if (lastCursorRef.current) {
                socket.send(JSON.stringify({
                    action: 'setCursor',
                    payload: lastCursorRef.current
                }));
            }
            if (lastPresenceRef.current) {
                socket.send(JSON.stringify({
                    action: 'setPresence',
                    payload: lastPresenceRef.current
                }));
            }

            subscribedTablesRef.current.forEach(table => {
                socket.send(JSON.stringify({ action: 'subscribe', table }));
            });

            socket.send(JSON.stringify({ action: 'rpc', method: 'getSchema' }));
            socket.send(JSON.stringify({ action: 'rpc', method: 'getUsage' }));
        },
        onMessage: (event) => {
            handleSocketMessage(event);
        },
        onClose: (event) => {
            wsLog('WebSocket closed:', event.code, event.reason);
            setStatus('disconnected');
            setIsConnected(false);
            setConnectionQuality(prev => ({ ...prev, latency: 0 }));
            setReconnectInfo({
                attempt: socket.retryCount || 0,
                maxAttempts: 0,
                nextRetryAt: null
            });
        },
        onError: (error) => {
            wsLog('WebSocket error:', error);
            // Often a 401 will just manifest as a close/error here
        }
    });

    /** Manually trigger a reconnection using PartySocket */
    const manualReconnect = useCallback(() => {
        if (!roomId) return;
        addToast('Manually reconnecting...', 'info');
        socket.reconnect();
    }, [socket, roomId]);

    const performOptimisticAction = useCallback((id: string, action: string, payload: any, rollback: () => void) => {
        // Record optimistic update
        const updateId = Math.random().toString(36).substring(7);
        pendingOptimisticUpdates.current.set(updateId, {
            id: updateId,
            action,
            payload,
            rollback,
            timestamp: Date.now()
        });
        
        // Timeout cleanup (if server never responds)
        setTimeout(() => {
            if (pendingOptimisticUpdates.current.has(updateId)) {
                const update = pendingOptimisticUpdates.current.get(updateId);
                // Optionally rollback or just clear
                // update?.rollback(); 
                pendingOptimisticUpdates.current.delete(updateId);
            }
        }, OPTIMISTIC_UPDATE_TIMEOUT);
        
        return updateId;
    }, []);

    const runQuery = useCallback((sql: string, tableContext?: string) => {
        if (tableContext) {
            socket.send(JSON.stringify({ action: 'subscribe_query', sql, table: tableContext }));
        } else {
            socket.send(JSON.stringify({ action: 'query', sql })); 
        }
    }, [socket]);

    const runReactiveQuery = useCallback((sql: string, tableContext: string) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ action: 'subscribe_query', sql, table: tableContext }));
    }, [socket]);

    const subscribe = useCallback((table: string) => {
        subscribedTablesRef.current.add(table);
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ action: 'subscribe', table }));
    }, [socket]);

    const setCursor = useCallback((userId: string, position: any) => {
        // Store for re-connection
        lastCursorRef.current = { userId, position };
        
        // Send to server
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({
            action: 'setCursor',
            payload: { userId, position }
        }));
    }, [socket]);

    const setPresence = useCallback((userId: string, status: any) => {
         // Store for re-connection
        lastPresenceRef.current = { userId, status };
        
        // Send to server
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({
            action: 'setPresence',
            payload: { userId, status }
        }));
    }, [socket]);

    const getPsychicData = useCallback((key: string): any => {
        if (psychicCache.current.has(key)) {
            console.log('🔮 Psychic Hit!', key);
            return psychicCache.current.get(key);
        }
        return null;
    }, []);

    const streamIntent = useCallback((text: string) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({
            action: 'rpc',
            method: 'streamIntent',
            payload: { text }
        }));
    }, [socket]);

    /**
     * Generic RPC call - returns a Promise that resolves with the result
     */
    const rpc = useCallback((method: string, payload: any): Promise<any> => {
        return new Promise((resolve, reject) => {
            // Generate a unique request ID
            let requestId: string;
            if (crypto.randomUUID) {
                requestId = crypto.randomUUID();
            } else if (crypto.getRandomValues) {
                const buffer = new Uint8Array(16);
                crypto.getRandomValues(buffer);
                requestId = Array.from(buffer, byte => byte.toString(16).padStart(2, '0')).join('');
            } else {
                requestId = `rpc_${Date.now()}_${Math.random()}`;
            }

            pendingRequests.current.set(requestId, { resolve, reject });
            
            // Send the RPC request with requestId
            socket.send(JSON.stringify({
                action: 'rpc',
                method,
                payload,
                requestId
            }));
            
            // Timeout after a configurable delay (longer for batch operations)
            const timeout = (method === 'batchInsert' || method === 'createTable') ? 60000 : 10000; // 60s for batch, 10s for others
            setTimeout(() => {
                if (pendingRequests.current.has(requestId)) {
                    pendingRequests.current.delete(requestId);
                    reject(new Error(`RPC call to ${method} timed out`));
                }
            }, timeout);
        });
    }, [socket]);

    const performMutation = useCallback((method: string, payload: any) => {
            // PartySocket handles offline buffering, so we don't check readyState
            return rpc(method, payload);
        }, [rpc]);

    const refreshSchema = useCallback(async () => {
         try {
            // Optimistically try fetch first as it's faster than WS handshake for initial load
            const response = await fetch(`${HTTP_URL}/api/schema`);
            if (response.ok) {
                const schemaData = await response.json();
                setSchema(schemaData);
            }
         } catch (e) {
             console.error('Failed to fetch schema via HTTP:', e);
         }
    }, []);

    const refreshUsage = useCallback(() => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        socket.send(JSON.stringify({ 
            action: 'rpc', 
            method: 'getUsage'
        }));
    }, [socket]);

    const connect = useCallback((nextRoomId: string) => {
        if (!nextRoomId) return;
        if (currentRoomIdRef.current === nextRoomId && status === 'connected') return;
        currentRoomIdRef.current = nextRoomId;
        setStatus('connecting');
        setIsConnected(false);
        setRoomId(nextRoomId);
    }, [status]);

    // Psychic Auto-Sensor: Global input listener
    useEffect(() => {
        if (!psychic) return;

        const handleGlobalInput = (event: Event) => {
            const target = event.target as HTMLElement;
            
            // Filter for INPUT or TEXTAREA tags
            if (target.tagName !== 'INPUT' && target.tagName !== 'TEXTAREA') {
                return;
            }

            const inputElement = target as HTMLInputElement | HTMLTextAreaElement;
            const text = inputElement.value;

            // Clear previous debounce timer
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }

            // Debounce: trigger after 175ms of typing inactivity
            debounceTimerRef.current = setTimeout(() => {
                if (text.length > 2) {
                    console.log('🔮 Auto-sensing intent:', text);
                    streamIntent(text);
                }
            }, 175);
        };

        // Add global event listener with capture phase
        window.addEventListener('input', handleGlobalInput, { capture: true });

        return () => {
            window.removeEventListener('input', handleGlobalInput, { capture: true });
            if (debounceTimerRef.current) {
                clearTimeout(debounceTimerRef.current);
            }
        };
    }, [psychic, streamIntent]);

    // Cleanup on unmount
    // PartySocket manages its own lifecycle.

    return (
        <DatabaseContext.Provider value={{ status, isConnected, connect, runQuery, subscribe, lastResult, toasts, addToast, schema, refreshSchema, usageStats, refreshUsage, performOptimisticAction, performMutation, runReactiveQuery, rpc, socket, setCursor, setPresence, getPsychicData, manualReconnect, reconnectInfo, connectionQuality, wsDebug, setWsDebug }}>
            {children}
        </DatabaseContext.Provider>
    );
};

export const useDatabase = () => {
    const context = useContext(DatabaseContext);
    if (!context) throw new Error("useDatabase must be used within DatabaseProvider");
    return context;
};

export const useRealtimeQuery = (tableName: string, options: { limit?: number; } = {}) => {
    const { runQuery, subscribe, lastResult, isConnected, socket } = useDatabase();
    const [data, setData] = useState<any[]>([]);
    const [total, setTotal] = useState<number>(0);
    const [currentOffset, setCurrentOffset] = useState(0);
    const limit = options.limit || 500;

    // Helper function to detect primary key field
    const detectPrimaryKey = (sampleRow: any): string => {
        if (!sampleRow) return 'id';
        return Object.prototype.hasOwnProperty.call(sampleRow, 'id')
            ? 'id' 
            : Object.keys(sampleRow).find(k => k.toLowerCase().endsWith('id')) || 'id';
    };

    const loadMore = useCallback(() => {
        // Calculate next page offset
        const nextOffset = currentOffset + limit;
        // Don't fetch if we already have all data
        if (total > 0 && nextOffset >= total) return;
        setCurrentOffset(nextOffset);

        if (socket) {
            if (tableName === 'tasks') {
                socket.send(JSON.stringify({ 
                    action: 'rpc', 
                    method: 'listTasks',
                    payload: { limit, offset: nextOffset }
                }));
            } else {
                 socket.send(JSON.stringify({ 
                    action: 'rpc', 
                    method: 'executeSQL', 
                    payload: { 
                        sql: `SELECT * FROM ${tableName} LIMIT ${limit} OFFSET ${nextOffset}`, 
                        readonly: true 
                    }
                }));
            }
        }
    }, [socket, currentOffset, total, limit, tableName]);

    // Initial load and reset when table changes
    useEffect(() => {
        setData([]);
        setCurrentOffset(0);
        setTotal(0);
        
        if (socket && isConnected && tableName) {
             if (tableName === 'tasks') {
                socket.send(JSON.stringify({ 
                    action: 'rpc', 
                    method: 'listTasks',
                    payload: { limit, offset: 0 }
                }));
            } else {
                 subscribe(tableName); // Ensure we are subscribed for updates
                 socket.send(JSON.stringify({ 
                    action: 'rpc', 
                    method: 'executeSQL', 
                    payload: { 
                        sql: `SELECT * FROM ${tableName} LIMIT ${limit} OFFSET 0`, 
                        readonly: true 
                    }
                }));
                 socket.send(JSON.stringify({ 
                    action: 'rpc', 
                    method: 'executeSQL', 
                    payload: { 
                        sql: `SELECT COUNT(*) as count FROM ${tableName}`, 
                        readonly: true 
                    }
                }));
            }
        }
    }, [tableName, socket, isConnected, subscribe, limit]);

    // Handle updates and initial data
    useEffect(() => {
        const handleUpdate = (e: any) => {
            const { table, action, row, diff, fullData } = e.detail;
            if (table === tableName) {
                // Handle incremental updates (real-time)
                if (action === 'added' && row) {
                    setData(prev => [row, ...prev]);
                    setTotal(t => t + 1);
                } else if (action === 'deleted' && row) {
                    setData(prev => prev.filter(item => {
                        const pk = detectPrimaryKey(item);
                        return item[pk] !== row[pk];
                    }));
                    setTotal(t => Math.max(0, t - 1));
                } else if (action === 'modified' && row) {
                    setData(prev => prev.map(item => {
                        const pk = detectPrimaryKey(item);
                         // If we have the item, update it
                        if (item[pk] === row[pk]) {
                            return { ...item, ...row };
                        }
                        return item;
                    }));
                } else if (diff) {
                    // Legacy diff handling
                    setData(currentData => {
                        // ... (same diff logic as before) ...
                        const sampleRow = currentData.length > 0 ? currentData[0] : (
                            diff.added.length > 0 ? diff.added[0] : (
                                diff.modified.length > 0 ? diff.modified[0] : (
                                    diff.deleted.length > 0 ? diff.deleted[0] : null
                                )
                            )
                        );
                        
                        if (!sampleRow) return fullData || currentData;
                        const pkField = detectPrimaryKey(sampleRow);
                        
                         if (!Object.prototype.hasOwnProperty.call(sampleRow, pkField)) {
                            return fullData || currentData;
                        }
                        
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
                    setData(fullData);
                    setTotal(fullData.length);
                }
            }
        };

        window.addEventListener('db-update', handleUpdate);
        return () => window.removeEventListener('db-update', handleUpdate);
    }, [tableName]);

    useEffect(() => {
        if (lastResult && lastResult.originalSql) {
            // Check if this result is a count query
            if (lastResult.originalSql.includes('SELECT COUNT(*)')) {
                 const count = lastResult.data[0]?.count;
                 if (typeof count === 'number') {
                     setTotal(count);
                 }
                 return;
            }

            // Match both the table name query and the listTasks RPC method
            // We look for the LIMIT/OFFSET pattern we sent
            const isPaginatedQuery = lastResult.originalSql.includes(`FROM ${tableName}`) && 
                                   lastResult.originalSql.includes('LIMIT');
                                   
            const isTasksRpc = tableName === 'tasks' && lastResult.originalSql === 'listTasks';
            
            if ((isPaginatedQuery || isTasksRpc) && !lastResult.originalSql.toLowerCase().startsWith('insert')) {
                 
                 // If total came back with RPC result (listTasks)
                 if (lastResult.total !== undefined) {
                     setTotal(lastResult.total);
                 }

                 setData(prev => {
                     // If we just fetched offset 0, replace data
                     // We can infer this if prev length is 0, or by tracking request ID (more complex)
                     // For now, simpler heuristic:
                     
                     // BUT, wait - we have currentOffset state. 
                     // The issue is multiple inflight requests. 
                     // Simpler: Just append if IDs are new.
                     
                     // Optimization: If currentOffset was 0 when we *sent* (not now), we should replace.
                     // Since we don't track that easily, let's use a Set to identifying existing items.
                     
                     const existingIds = new Set(prev.map(r => r.id));
                     const newRows = lastResult.data.filter((r: any) => !existingIds.has(r.id));
                     
                     if (prev.length === 0) return lastResult.data;
                     
                     return [...prev, ...newRows];
                 });
            }
        }
    }, [lastResult, tableName]);

    return { data, total, loadMore };
};
