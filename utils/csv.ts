import Papa from 'papaparse';

// STRICT sanitization to match Backend logic exactly
export const sanitizeHeader = (header: string): string => {
    if (!header) return `col_${Math.random().toString(36).substring(7)}`;

    let sanitized = header.trim().toLowerCase();
    // Replace non-alphanumeric with underscores
    sanitized = sanitized.replace(/[^a-z0-9_]/g, '_');
    // Remove leading/trailing underscores
    sanitized = sanitized.replace(/^_+|_+$/g, '');
    // Collapse multiple underscores
    sanitized = sanitized.replace(/_+/g, '_');

    // Ensure starts with letter or underscore
    if (!/^[a-z_]/.test(sanitized)) {
        sanitized = `_${sanitized}`;
    }

    return sanitized || 'column';
};

export const parseCSV = (file: File): Promise<{
    headers: string[];
    rows: any[]; 
    inferredTypes: Record<string, string>;
}> => {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            skipEmptyLines: true,
            header: true,
            transformHeader: sanitizeHeader,
            dynamicTyping: true,
            complete: (results) => {
                if (!results.data || results.data.length === 0) {
                    reject(new Error("CSV file is empty"));
                    return;
                }

                const headers = results.meta.fields || [];
                const rows = results.data;

                const inferredTypes: Record<string, string> = {};

                headers.forEach(header => {
                    let detectedType = 'TEXT';
                    for (let i = 0; i < Math.min(rows.length, 10); i++) {
                        const val = (rows[i] as any)[header];
                        if (val === null || val === undefined || val === '') continue;

                        if (typeof val === 'number') {
                            detectedType = Number.isInteger(val) ? 'INTEGER' : 'REAL';
                        } else if (typeof val === 'boolean') {
                            detectedType = 'BOOLEAN';
                        } else {
                            detectedType = 'TEXT';
                            break;
                        }
                    }
                    inferredTypes[header] = detectedType;
                });

                resolve({ headers, rows, inferredTypes });
            },
            error: (error) => reject(error)
        });
    });
};

export const generateCSV = (headers: string[], rows: any[]): string => {
    // PapaParse can also unparse (JSON -> CSV)
    return Papa.unparse({
        fields: headers,
        data: rows
    });
};
