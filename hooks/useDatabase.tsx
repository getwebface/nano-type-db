import React, { createContext, useContext, useEffect, useRef, useState, useCallback } from 'react';
import { DatabaseContextType, QueryResult, UpdateEvent, ToastMessage, Schema, UsageStat, OptimisticUpdate } from '../types';
import { authClient } from '../src/lib/auth-client';

// Dynamic URL detection for production/dev
const PROTOCOL = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
const HOST = window.location.host; 
const WORKER_URL = `${PROTOCOL}//${HOST}`; 
const HTTP_URL = `${window.location.protocol}//${HOST}`;

// In development with Vite proxy, use proxied WebSocket path
const IS_DEV = import.meta.env.DEV;
const WS_PATH_PREFIX = IS_DEV ? '/__ws' : '';

// Configuration constants
const OPTIMISTIC_UPDATE_TIMEOUT = 10000; // 10 seconds
const WS_CONNECTION_TIMEOUT = 10000; // 10 seconds for WebSocket to connect
const WS_RECONNECT_INTERVAL = 3000; // 3 seconds between reconnection attempts
const MAX_RECONNECT_ATTEMPTS = 5; // Maximum reconnection attempts
const HEARTBEAT_INTERVAL = 30000; // 30 seconds - send ping to keep connection alive
const HEARTBEAT_TIMEOUT = 5000; // 5 seconds - expect pong response

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
    const reconnectAttemptsRef = useRef<number>(0);
    const reconnectTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const connectionTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const shouldReconnectRef = useRef<boolean>(true);
    const heartbeatIntervalRef = useRef<NodeJS.Timeout | null>(null);
    const heartbeatTimeoutRef = useRef<NodeJS.Timeout | null>(null);
    const lastPongRef = useRef<number>(Date.now());
    
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

    // Note: connect is async to fetch session token, but we don't add it to
    // the dependency array to avoid infinite loops. The socket dependency
    // ensures we recreate the callback when needed.
    const connect = useCallback(async (roomId: string) => {
        // Clear any pending reconnection attempts
        if (reconnectTimeoutRef.current) {
            clearTimeout(reconnectTimeoutRef.current);
            reconnectTimeoutRef.current = null;
        }
        
        if (connectionTimeoutRef.current) {
            clearTimeout(connectionTimeoutRef.current);
            connectionTimeoutRef.current = null;
        }
        
        if (heartbeatIntervalRef.current) {
            clearInterval(heartbeatIntervalRef.current);
            heartbeatIntervalRef.current = null;
        }
        
        if (heartbeatTimeoutRef.current) {
            clearTimeout(heartbeatTimeoutRef.current);
            heartbeatTimeoutRef.current = null;
        }

        // Close existing socket if any
        if (socket) {
            socket.onclose = null;
            socket.onerror = null;
            socket.close();
        }

        setStatus('connecting');
        currentRoomIdRef.current = roomId;
        shouldReconnectRef.current = true;
        
        // Get session token from Better Auth
        let sessionToken = '';
        try {
            const session = await authClient.getSession();
            if (session?.data?.session?.token) {
                sessionToken = session.data.session.token;
            }
        } catch (e) {
            console.warn('Failed to get session token, will try cookie-based auth', e);
        }
        
        // Construct WebSocket URL with explicit path and session token for auth
        let wsUrl = `${WORKER_URL}${WS_PATH_PREFIX}/?room_id=${encodeURIComponent(roomId)}`;
        if (sessionToken) {
            wsUrl += `&session_token=${encodeURIComponent(sessionToken)}`;
        }
        console.log('Connecting to WebSocket:', wsUrl);
        
        // Browser automatically sends Cookies (Better Auth Session) with WebSocket
        const ws = new WebSocket(wsUrl);

        // Set a connection timeout
        connectionTimeoutRef.current = setTimeout(() => {
            if (ws.readyState !== WebSocket.OPEN) {
                console.error('WebSocket connection timeout');
                ws.close();
                addToast('Connection timeout. Please try again.', 'error');
                setStatus('disconnected');
                
                // Attempt reconnection if not exceeded max attempts
                if (reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
                    reconnectAttemptsRef.current++;
                    console.log(`Reconnection attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS}`);
                    
                    reconnectTimeoutRef.current = setTimeout(() => {
                        connect(roomId);
                    }, WS_RECONNECT_INTERVAL);
                } else {
                    addToast('Maximum reconnection attempts reached. Please refresh the page.', 'error');
                    reconnectAttemptsRef.current = 0;
                }
            }
        }, WS_CONNECTION_TIMEOUT);

        ws.onopen = () => {
            console.log('Connected to DO');
            
            // Clear connection timeout
            if (connectionTimeoutRef.current) {
                clearTimeout(connectionTimeoutRef.current);
                connectionTimeoutRef.current = null;
            }
            
            // Reset reconnection counter on successful connection
            reconnectAttemptsRef.current = 0;
            lastPongRef.current = Date.now();
            
            setStatus('connected');
            setIsConnected(true);
            refreshSchema();
            
            // Initial usage fetch
            setTimeout(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    ws.send(JSON.stringify({ action: 'rpc', method: 'getUsage' }));
                }
            }, 500);
            
            // Start heartbeat to keep connection alive
            heartbeatIntervalRef.current = setInterval(() => {
                if (ws.readyState === WebSocket.OPEN) {
                    // Send ping
                    ws.send(JSON.stringify({ action: 'ping' }));
                    
                    // Set timeout to check for pong response
                    heartbeatTimeoutRef.current = setTimeout(() => {
                        const timeSinceLastPong = Date.now() - lastPongRef.current;
                        if (timeSinceLastPong > HEARTBEAT_INTERVAL + HEARTBEAT_TIMEOUT) {
                            console.warn('Heartbeat timeout - connection may be dead');
                            ws.close();
                        }
                    }, HEARTBEAT_TIMEOUT);
                }
            }, HEARTBEAT_INTERVAL);
        };

        ws.onerror = (error) => {
            console.error('WebSocket error:', error);
            
            // Clear connection timeout
            if (connectionTimeoutRef.current) {
                clearTimeout(connectionTimeoutRef.current);
                connectionTimeoutRef.current = null;
            }
            
            addToast('Connection error. Retrying...', 'error');
        };

        ws.onmessage = (event) => {
            const data = JSON.parse(event.data);

            // Handle pong response for heartbeat
            if (data.type === 'pong') {
                lastPongRef.current = Date.now();
                if (heartbeatTimeoutRef.current) {
                    clearTimeout(heartbeatTimeoutRef.current);
                    heartbeatTimeoutRef.current = null;
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
        };

        ws.onclose = (event) => {
            console.log('WebSocket closed:', event.code, event.reason);
            
            // Clear connection timeout
            if (connectionTimeoutRef.current) {
                clearTimeout(connectionTimeoutRef.current);
                connectionTimeoutRef.current = null;
            }
            
            // Clear heartbeat timers
            if (heartbeatIntervalRef.current) {
                clearInterval(heartbeatIntervalRef.current);
                heartbeatIntervalRef.current = null;
            }
            
            if (heartbeatTimeoutRef.current) {
                clearTimeout(heartbeatTimeoutRef.current);
                heartbeatTimeoutRef.current = null;
            }
            
            setIsConnected(false);
            setStatus('disconnected');
            setSocket(null);
            setSchema(null);
            
            // Attempt reconnection if it was not a clean close and we should reconnect
            if (shouldReconnectRef.current && event.code !== 1000 && reconnectAttemptsRef.current < MAX_RECONNECT_ATTEMPTS) {
                reconnectAttemptsRef.current++;
                console.log(`Connection lost. Reconnecting (attempt ${reconnectAttemptsRef.current}/${MAX_RECONNECT_ATTEMPTS})...`);
                addToast(`Connection lost. Reconnecting...`, 'info');
                
                reconnectTimeoutRef.current = setTimeout(() => {
                    connect(roomId);
                }, WS_RECONNECT_INTERVAL);
            } else if (reconnectAttemptsRef.current >= MAX_RECONNECT_ATTEMPTS) {
                addToast('Connection lost. Please refresh the page.', 'error');
                reconnectAttemptsRef.current = 0;
            }
        };

        setSocket(ws);
    }, [socket, refreshSchema]);

    const runQuery = useCallback((sql: string, tableContext?: string) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        
        // SECURITY: Instead of sending raw SQL, parse intent and use RPC methods
        const sqlUpper = sql.trim().toUpperCase();
        
        // Handle SELECT queries on tasks table
        if (sqlUpper.startsWith('SELECT') && sqlUpper.includes('FROM TASKS')) {
            socket.send(JSON.stringify({
                action: 'rpc',
                method: 'listTasks'
            }));
            return;
        }
        
        // Handle INSERT INTO tasks
        if (sqlUpper.startsWith('INSERT INTO TASKS')) {
            const match = sql.match(/VALUES\s*\(\s*'([^']*)'/i);
            const title = match ? match[1] : "New Task";
            
            socket.send(JSON.stringify({
                action: 'createTask',
                payload: { title }
            }));
            return;
        }
        
        // Handle UPDATE tasks
        if (sqlUpper.startsWith('UPDATE TASKS') && sqlUpper.includes("SET STATUS = 'COMPLETED'")) {
            const match = sql.match(/WHERE ID\s*=\s*(\d+)/i);
            if (match) {
                const id = parseInt(match[1], 10);
                socket.send(JSON.stringify({
                    action: 'completeTask',
                    payload: { id }
                }));
            }
            return;
        }
        
        // Handle DELETE from tasks
        if (sqlUpper.startsWith('DELETE FROM TASKS')) {
            const match = sql.match(/WHERE ID\s*=\s*(\d+)/i);
            if (match) {
                const id = parseInt(match[1], 10);
                socket.send(JSON.stringify({
                    action: 'deleteTask',
                    payload: { id }
                }));
            }
            return;
        }
        
        // Reject any other raw SQL for security
        console.error('Rejected raw SQL query for security');
        addToast('Raw SQL queries are disabled for security. Use RPC methods like listTasks, createTask, completeTask, or deleteTask instead.', 'error');

        // Refresh usage stats after queries (demo purpose)
        setTimeout(refreshUsage, 1000);

    }, [socket, refreshUsage, addToast]);

    const performOptimisticAction = useCallback((action: string, payload: any, optimisticUpdate: () => void, rollback: () => void) => {
        if (!socket || socket.readyState !== WebSocket.OPEN) return;
        
        // Generate unique ID for this update using crypto API
        const updateId = crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(36).substring(7)}`;
        
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

    // Cleanup on unmount
    useEffect(() => {
        return () => {
            shouldReconnectRef.current = false;
            
            if (reconnectTimeoutRef.current) {
                clearTimeout(reconnectTimeoutRef.current);
            }
            
            if (connectionTimeoutRef.current) {
                clearTimeout(connectionTimeoutRef.current);
            }
            
            if (heartbeatIntervalRef.current) {
                clearInterval(heartbeatIntervalRef.current);
            }
            
            if (heartbeatTimeoutRef.current) {
                clearTimeout(heartbeatTimeoutRef.current);
            }
            
            if (socket) {
                socket.onclose = null;
                socket.onerror = null;
                socket.close();
            }
        };
    }, []); // Empty dependency array ensures this only runs on unmount

    return (
        <DatabaseContext.Provider value={{ status, isConnected, connect, runQuery, subscribe, lastResult, toasts, schema, refreshSchema, usageStats, refreshUsage, performOptimisticAction, socket }}>
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
    const { runQuery, subscribe, lastResult, isConnected, socket } = useDatabase();
    const [data, setData] = useState<any[]>([]);

    // Helper function to detect primary key field
    const detectPrimaryKey = (sampleRow: any): string => {
        if (!sampleRow) return 'id';
        return Object.prototype.hasOwnProperty.call(sampleRow, 'id')
            ? 'id' 
            : Object.keys(sampleRow).find(k => k.toLowerCase().endsWith('id')) || 'id';
    };

    useEffect(() => {
        if (isConnected && tableName && socket && socket.readyState === WebSocket.OPEN) {
            subscribe(tableName);
            
            // Use RPC method instead of raw SQL
            if (tableName === 'tasks') {
                socket.send(JSON.stringify({ 
                    action: 'rpc', 
                    method: 'listTasks' 
                }));
            } else {
                // For other tables, use a generic query (if needed in the future)
                runQuery(`SELECT * FROM ${tableName}`, tableName);
            }
        }
    }, [isConnected, tableName, subscribe, socket]);

    useEffect(() => {
        const handleUpdate = (e: Event) => {
            const customEvent = e as CustomEvent;
            if (customEvent.detail.table === tableName) {
                const { action, row, diff, fullData } = customEvent.detail;
                
                // Handle efficient action-based updates (new format)
                if (action && row) {
                    setData(currentData => {
                        // Detect primary key field from data
                        const sampleRow = currentData[0] || row;
                        if (!sampleRow) return currentData;
                        
                        const pkField = detectPrimaryKey(sampleRow);
                        
                        if (!Object.prototype.hasOwnProperty.call(row, pkField)) {
                            // If no PK field, just refresh
                            return currentData;
                        }
                        
                        const pkValue = row[pkField];
                        
                        if (action === 'added') {
                            // Add new row if it doesn't exist
                            const exists = currentData.some(item => item[pkField] === pkValue);
                            return exists ? currentData : [...currentData, row];
                        } else if (action === 'modified') {
                            // Update existing row
                            return currentData.map(item => 
                                item[pkField] === pkValue ? row : item
                            );
                        } else if (action === 'deleted') {
                            // Remove deleted row
                            return currentData.filter(item => item[pkField] !== pkValue);
                        }
                        
                        return currentData;
                    });
                }
                // Legacy support: Handle diff-based updates (old format)
                else if (diff && (diff.added.length > 0 || diff.modified.length > 0 || diff.deleted.length > 0)) {
                    setData(currentData => {
                        // Detect primary key field from first row
                        const sampleRow = currentData[0] || diff.added[0] || diff.modified[0] || diff.deleted[0];
                        if (!sampleRow) return currentData;
                        
                        const pkField = detectPrimaryKey(sampleRow);
                        
                        // If rows don't have the detected PK field, fall back to full data
                        if (!Object.prototype.hasOwnProperty.call(sampleRow, pkField)) {
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
                    // Fallback to re-fetching if no action, diff or fullData
                    if (socket && socket.readyState === WebSocket.OPEN) {
                        if (tableName === 'tasks') {
                            socket.send(JSON.stringify({ 
                                action: 'rpc', 
                                method: 'listTasks' 
                            }));
                        }
                    }
                }
            }
        };

        window.addEventListener('db-update', handleUpdate);
        return () => window.removeEventListener('db-update', handleUpdate);
    }, [tableName, socket, runQuery]);

    useEffect(() => {
        if (lastResult && lastResult.originalSql) {
            // Match both the table name and the listTasks RPC method
            const matchesTable = lastResult.originalSql.includes(tableName) || 
                                (tableName === 'tasks' && lastResult.originalSql === 'listTasks');
            
            if (matchesTable && !lastResult.originalSql.toLowerCase().startsWith('insert')) {
                 setData(lastResult.data);
            }
        }
    }, [lastResult, tableName]);

    return data;
};