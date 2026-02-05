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
}

export interface DatabaseContextType {
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
}

export interface ToastMessage {
    id: string;
    message: string;
    type: 'success' | 'info';
}

export interface UsageStat {
    date: string;
    reads: number;
    writes: number;
}
