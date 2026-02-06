
// Sanitize headers to be valid SQL column names
export const sanitizeHeader = (header: string): string => {
    let sanitized = header.trim().toLowerCase();
    // Replace non-alphanumeric chars with underscore
    sanitized = sanitized.replace(/[^a-z0-9_]/g, '_');
    // Ensure it starts with a letter or underscore
    if (!/^[a-z_]/.test(sanitized)) {
        sanitized = `_${sanitized}`;
    }
    // Remove duplicate underscores
    sanitized = sanitized.replace(/_+/g, '_');
    return sanitized;
};

// Improved CSV parser that handles quoted values with commas
export const parseCSVLine = (line: string): string[] => {
    const result: string[] = [];
    let current = '';
    let inQuotes = false;
    
    for (let i = 0; i < line.length; i++) {
        const char = line[i];
        
        if (char === '"') {
            // Handle escaped quotes ("")
            if (inQuotes && line[i + 1] === '"') {
                current += '"';
                i++; // Skip next quote
            } else {
                inQuotes = !inQuotes;
            }
        } else if (char === ',' && !inQuotes) {
            result.push(current.trim());
            current = '';
        } else {
            current += char;
        }
    }
    
    result.push(current.trim());
    return result;
};

export const parseCSV = async (file: File): Promise<{
    headers: string[];
    rows: string[][];
}> => {
    const text = await file.text();
    const lines = text.split(/\r?\n/).filter(line => line.trim().length > 0);
    
    if (lines.length === 0) {
        throw new Error("CSV file is empty");
    }
    
    const headers = parseCSVLine(lines[0]);
    const rows = lines.slice(1).map(parseCSVLine);
    
    return { headers, rows };
};

export const generateCSV = (headers: string[], rows: any[]): string => {
    const csvContent = [
        headers.join(','),
        ...rows.map(row => headers.map(header => {
            const value = row[header];
            if (value === null || value === undefined) return '';
            const stringValue = String(value);
            // Escape quotes and wrap in quotes if contains comma or quote
            if (stringValue.includes(',') || stringValue.includes('"')) {
                return `"${stringValue.replace(/"/g, '""')}"`;
            }
            return stringValue;
        }).join(','))
    ].join('\n');
    return csvContent;
};
