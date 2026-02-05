import React, { useState, useEffect } from 'react';
import { Activity, TrendingUp, Cpu, Zap, Loader2 } from 'lucide-react';

interface DailyUsage {
    date: string;
    reads: number;
    writes: number;
    ai_ops: number;
}

interface AnalyticsData {
    daily: DailyUsage[];
    totals: {
        reads: number;
        writes: number;
        ai_ops: number;
    };
}

export const Analytics: React.FC = () => {
    const [data, setData] = useState<AnalyticsData | null>(null);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);

    // Get current room ID from URL params
    const getRoomId = () => {
        const params = new URLSearchParams(window.location.search);
        return params.get('room_id') || 'demo-room';
    };

    useEffect(() => {
        fetchAnalytics();
    }, []);

    const fetchAnalytics = async () => {
        setLoading(true);
        setError(null);
        try {
            const roomId = getRoomId();
            const response = await fetch(`/analytics?room_id=${roomId}`);
            
            if (!response.ok) {
                throw new Error('Failed to fetch analytics');
            }
            
            const analyticsData = await response.json();
            setData(analyticsData);
        } catch (err: any) {
            setError(err.message);
            console.error('Failed to fetch analytics:', err);
        } finally {
            setLoading(false);
        }
    };

    const formatNumber = (num: number) => {
        if (num >= 1000000) return (num / 1000000).toFixed(1) + 'M';
        if (num >= 1000) return (num / 1000).toFixed(1) + 'K';
        return num.toString();
    };

    const getMaxValue = () => {
        if (!data?.daily) return 100;
        const maxReads = Math.max(...data.daily.map(d => d.reads));
        const maxWrites = Math.max(...data.daily.map(d => d.writes));
        const maxAiOps = Math.max(...data.daily.map(d => d.ai_ops));
        return Math.max(maxReads, maxWrites, maxAiOps, 1);
    };

    if (loading) {
        return (
            <div className="flex items-center justify-center py-12">
                <Loader2 className="animate-spin text-slate-400" size={32} />
            </div>
        );
    }

    if (error) {
        return (
            <div className="bg-red-900/20 border border-red-500 text-red-200 px-4 py-3 rounded-lg">
                <p className="text-sm">{error}</p>
            </div>
        );
    }

    if (!data) {
        return (
            <div className="text-center py-12 text-slate-400">
                No analytics data available
            </div>
        );
    }

    const maxValue = getMaxValue();

    return (
        <div className="space-y-6">
            <div>
                <h3 className="text-xl font-bold text-white flex items-center gap-2">
                    <Activity size={24} />
                    Usage Analytics
                </h3>
                <p className="text-sm text-slate-400 mt-1">
                    Read/Write units and AI operations per day (last 30 days)
                </p>
            </div>

            {/* Summary Cards */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Total Reads</p>
                            <p className="text-2xl font-bold text-blue-400">{formatNumber(data.totals.reads)}</p>
                        </div>
                        <div className="bg-blue-500/20 p-3 rounded-lg">
                            <TrendingUp className="text-blue-400" size={24} />
                        </div>
                    </div>
                </div>

                <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">Total Writes</p>
                            <p className="text-2xl font-bold text-orange-400">{formatNumber(data.totals.writes)}</p>
                        </div>
                        <div className="bg-orange-500/20 p-3 rounded-lg">
                            <Zap className="text-orange-400" size={24} />
                        </div>
                    </div>
                </div>

                <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
                    <div className="flex items-center justify-between">
                        <div>
                            <p className="text-slate-400 text-xs uppercase tracking-wider mb-1">AI Operations</p>
                            <p className="text-2xl font-bold text-purple-400">{formatNumber(data.totals.ai_ops)}</p>
                        </div>
                        <div className="bg-purple-500/20 p-3 rounded-lg">
                            <Cpu className="text-purple-400" size={24} />
                        </div>
                    </div>
                </div>
            </div>

            {/* Chart */}
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
                <h4 className="text-white font-semibold mb-4">Daily Usage Breakdown</h4>
                <div className="space-y-4">
                    {data.daily.slice(-14).map((day, index) => (
                        <div key={day.date} className="space-y-2">
                            <div className="flex items-center justify-between text-xs">
                                <span className="text-slate-400 font-mono">{day.date}</span>
                                <div className="flex gap-4 text-slate-400">
                                    <span>R: {day.reads}</span>
                                    <span>W: {day.writes}</span>
                                    <span>AI: {day.ai_ops}</span>
                                </div>
                            </div>
                            <div className="flex gap-1 h-8">
                                {/* Reads */}
                                <div 
                                    className="bg-blue-500 rounded transition-all hover:bg-blue-400"
                                    style={{ width: `${(day.reads / maxValue) * 100}%`, minWidth: day.reads > 0 ? '2px' : '0' }}
                                    title={`Reads: ${day.reads}`}
                                />
                                {/* Writes */}
                                <div 
                                    className="bg-orange-500 rounded transition-all hover:bg-orange-400"
                                    style={{ width: `${(day.writes / maxValue) * 100}%`, minWidth: day.writes > 0 ? '2px' : '0' }}
                                    title={`Writes: ${day.writes}`}
                                />
                                {/* AI Ops */}
                                <div 
                                    className="bg-purple-500 rounded transition-all hover:bg-purple-400"
                                    style={{ width: `${(day.ai_ops / maxValue) * 100}%`, minWidth: day.ai_ops > 0 ? '2px' : '0' }}
                                    title={`AI Operations: ${day.ai_ops}`}
                                />
                            </div>
                        </div>
                    ))}
                </div>

                {/* Legend */}
                <div className="flex gap-6 mt-6 pt-4 border-t border-slate-700">
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-blue-500 rounded"></div>
                        <span className="text-sm text-slate-400">Reads</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-orange-500 rounded"></div>
                        <span className="text-sm text-slate-400">Writes</span>
                    </div>
                    <div className="flex items-center gap-2">
                        <div className="w-4 h-4 bg-purple-500 rounded"></div>
                        <span className="text-sm text-slate-400">AI Operations</span>
                    </div>
                </div>
            </div>

            {/* Billing Estimate */}
            <div className="bg-slate-800 border border-slate-700 rounded-lg p-6">
                <h4 className="text-white font-semibold mb-3">Cost Breakdown</h4>
                <div className="space-y-2 text-sm">
                    <div className="flex justify-between text-slate-300">
                        <span>Read Units ({formatNumber(data.totals.reads)} × $0.00001)</span>
                        <span className="font-mono">${(data.totals.reads * 0.00001).toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                        <span>Write Units ({formatNumber(data.totals.writes)} × $0.0001)</span>
                        <span className="font-mono">${(data.totals.writes * 0.0001).toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between text-slate-300">
                        <span>AI Operations ({formatNumber(data.totals.ai_ops)} × $0.001)</span>
                        <span className="font-mono">${(data.totals.ai_ops * 0.001).toFixed(4)}</span>
                    </div>
                    <div className="flex justify-between text-white font-semibold pt-2 border-t border-slate-700">
                        <span>Estimated Total</span>
                        <span className="font-mono">
                            ${((data.totals.reads * 0.00001) + (data.totals.writes * 0.0001) + (data.totals.ai_ops * 0.001)).toFixed(4)}
                        </span>
                    </div>
                </div>
                <p className="text-xs text-slate-500 mt-3">
                    * Estimated costs based on Cloudflare pricing. Actual costs may vary.
                </p>
            </div>
        </div>
    );
};
