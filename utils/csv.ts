import Papa from 'papaparse';

// Keep your existing sanitizer, it's useful for SQL safety
export const sanitizeHeader = (header: string): string => {
    let sanitized = header.trim().toLowerCase();
    sanitized = sanitized.replace(/[^a-z0-9_]/g, '_');
    if (!/^[a-z_]/.test(sanitized)) {
        sanitized = `_${sanitized}`;
    }
    return sanitized.replace(/_+/g, '_');
};

export const parseCSV = (file: File): Promise<{
    headers: string[];
    rows: any[]; // PapaParse returns array of arrays or objects
}> => {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            skipEmptyLines: true,
            complete: (results) => {
                // Validate data
                if (!results.data || results.data.length === 0) {
                    reject(new Error("CSV file is empty"));
                    return;
                }

                // Extract headers and rows
                // PapaParse results.data is an array of rows. 
                // Row 0 is usually headers if header: false (default)
                const rawHeaders = results.data[0] as string[];
                const rows = results.data.slice(1) as any[];

                resolve({ headers: rawHeaders, rows });
            },
            error: (error) => {
                reject(error);
            }
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
