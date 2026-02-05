export interface ColumnDefinition {
    cid: number;
    name: string;
    type: string;
    notnull: number;
    dflt_value: any;
    pk: number;
}

export interface Schema {
    [tableName: string]: ColumnDefinition[];
}

export interface QueryResult {
    type: "query_result";
    data: any[];
    originalSql: string;
}

export interface UpdateEvent {
    event: "update";
    table: string;
    diff?: {
        added: any[];
        modified: any[];
        deleted: any[];
    };
    fullData?: any[]; // Fallback for initial load
}

export interface OptimisticUpdate {
    id: string;
    action: string;
    payload: any;
    rollback: () => void;
    timestamp: number;
}

export interface DatabaseContextType {
    status: 'disconnected' | 'connecting' | 'connected';
    isConnected: boolean;
    connect: (roomId: string) => void;
    runQuery: (sql: string, tableContext?: string) => void;
    subscribe: (table: string) => void;
    lastResult: QueryResult | null;
    toasts: ToastMessage[];
    schema: Schema | null;
    refreshSchema: () => void;
    usageStats: UsageStat[];
    refreshUsage: () => void;
    performOptimisticAction: (action: string, payload: any, optimisticUpdate: () => void, rollback: () => void) => void;
    socket: WebSocket | null;
    setCursor: (userId: string, position: any) => void;
    setPresence: (userId: string, status: any) => void;
}

export interface ToastMessage {
    id: string;
    message: string;
    type: 'success' | 'info' | 'error';
}

export interface UsageStat {
    date: string;
    reads: number;
    writes: number;
}
