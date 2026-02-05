import { useState, useCallback } from 'react';

const HTTP_URL = `${window.location.protocol}//${window.location.host}`;

interface GlobalQueryResult {
    total: number;
    rooms: number;
    data: any[];
    errors: any[];
}

export const useGlobalQuery = () => {
    const [isLoading, setIsLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [result, setResult] = useState<GlobalQueryResult | null>(null);

    const executeGlobalQuery = useCallback(async (sql: string, rooms: string[]) => {
        setIsLoading(true);
        setError(null);
        
        try {
            const response = await fetch(`${HTTP_URL}/global-query`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ sql, rooms }),
            });

            if (!response.ok) {
                throw new Error(`Global query failed: ${response.statusText}`);
            }

            const data = await response.json();
            setResult(data);
            return data;
        } catch (e: any) {
            setError(e.message);
            throw e;
        } finally {
            setIsLoading(false);
        }
    }, []);

    return {
        executeGlobalQuery,
        isLoading,
        error,
        result,
    };
};
