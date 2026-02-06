import React from 'react';
import { X, Loader2, Upload } from 'lucide-react';

interface CsvImportModalProps {
    preview: {
        headers: string[];
        headerMapping: { original: string; sanitized: string }[];
        rows: Record<string, any>[];
        inferredTypes: Record<string, string>;
        fileName: string;
    } | null;
    isImporting: boolean;
    tableName: string;
    onClose: () => void;
    onConfirm: () => void;
}

export const CsvImportModal: React.FC<CsvImportModalProps> = ({ preview, isImporting, tableName, onClose, onConfirm }) => {
    if (!preview) return null;

    return (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
            <div className="bg-slate-900 border border-slate-700 rounded-lg max-w-3xl w-full max-h-[80vh] overflow-hidden flex flex-col">
                {/* Header */}
                <div className="p-6 border-b border-slate-800 flex items-center justify-between">
                    <div>
                        <h2 className="text-xl font-bold text-white">Import CSV Preview</h2>
                        <p className="text-sm text-slate-400 mt-1">
                            {preview.fileName} — {preview.rows.length} rows into "{tableName}"
                        </p>
                    </div>
                    <button onClick={onClose} className="p-1 hover:bg-slate-800 rounded transition-colors text-slate-400 hover:text-white">
                        <X size={18} />
                    </button>
                </div>
                
                {/* Content */}
                <div className="p-6 overflow-y-auto flex-1 space-y-4">
                    {/* Column mapping info */}
                    {preview.headerMapping.length > 0 && (
                        <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
                            <p className="text-sm font-medium text-yellow-400 mb-2">Column names will be sanitized:</p>
                            <div className="space-y-1">
                                {preview.headerMapping.map(({ original, sanitized }) => (
                                    <p key={original} className="text-xs text-slate-300 font-mono">
                                        "{original}" → "{sanitized}"
                                    </p>
                                ))}
                            </div>
                        </div>
                    )}

                    {/* Schema summary */}
                    <div>
                        <p className="text-sm font-medium text-slate-300 mb-2">Columns & Inferred Types</p>
                        <div className="flex flex-wrap gap-2">
                            {preview.headers.map(h => (
                                <span key={h} className="text-xs font-mono text-slate-400 bg-slate-800 px-2 py-1 rounded border border-slate-700">
                                    {h}: <span className="text-green-400">{preview.inferredTypes[h]}</span>
                                </span>
                            ))}
                        </div>
                    </div>

                    {/* Data preview table */}
                    <div>
                        <p className="text-sm font-medium text-slate-300 mb-2">Data Preview (first 5 rows)</p>
                        <div className="overflow-x-auto rounded border border-slate-700">
                            <table className="w-full text-left text-xs text-slate-400">
                                <thead className="bg-slate-800 text-slate-300 uppercase">
                                    <tr>
                                        {preview.headers.map(h => (
                                            <th key={h} className="px-3 py-2 border-b border-slate-700">{h}</th>
                                        ))}
                                    </tr>
                                </thead>
                                <tbody className="divide-y divide-slate-800 bg-slate-900">
                                    {preview.rows.slice(0, 5).map((row, idx) => (
                                        <tr key={idx}>
                                            {preview.headers.map(h => (
                                                <td key={h} className="px-3 py-2 max-w-[200px] truncate">{String(row[h] ?? '')}</td>
                                            ))}
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                        {preview.rows.length > 5 && (
                            <p className="text-xs text-slate-500 mt-1">...and {preview.rows.length - 5} more rows</p>
                        )}
                    </div>
                </div>

                {/* Footer */}
                <div className="p-6 border-t border-slate-800 flex justify-end gap-3">
                    <button
                        onClick={onClose}
                        disabled={isImporting}
                        className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-300 rounded-lg transition-colors disabled:opacity-50"
                    >
                        Cancel
                    </button>
                    <button
                        onClick={onConfirm}
                        disabled={isImporting}
                        className="px-4 py-2 bg-green-600 hover:bg-green-700 text-white rounded-lg transition-colors disabled:opacity-50 flex items-center gap-2"
                    >
                        {isImporting ? (
                            <><Loader2 size={16} className="animate-spin" /> Importing...</>
                        ) : (
                            <><Upload size={16} /> Import {preview.rows.length} Rows</>
                        )}
                    </button>
                </div>
            </div>
        </div>
    );
};
