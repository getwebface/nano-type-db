import React, { useState } from 'react';
import { useDatabase } from '../hooks/useDatabase';

export const PsychicSearch: React.FC = () => {
    const { socket, getPsychicData } = useDatabase();
    const [searchText, setSearchText] = useState('');
    const [results, setResults] = useState<any[]>([]);
    const [loadTime, setLoadTime] = useState<number | null>(null);

    const handleSearch = () => {
        const startTime = performance.now();
        
        // First, try to get data from psychic cache
        const psychicResults: any[] = [];
        
        // For demo purposes, we'll try to match on common task IDs
        // In a real app, you'd have a proper search/query mechanism
        for (let id = 1; id <= 10; id++) {
            const cached = getPsychicData(String(id));
            if (cached && cached.title?.toLowerCase().includes(searchText.toLowerCase())) {
                psychicResults.push(cached);
            }
        }
        
        const endTime = performance.now();
        const duration = endTime - startTime;
        
        if (psychicResults.length > 0) {
            // Found in psychic cache!
            console.log(`⚡ Psychic Hit! ${duration.toFixed(2)}ms Load`);
            setResults(psychicResults);
            setLoadTime(duration);
        } else {
            // Fallback to network request
            if (socket && socket.readyState === WebSocket.OPEN) {
                socket.send(JSON.stringify({
                    action: 'rpc',
                    method: 'search',
                    payload: { query: searchText }
                }));
                
                // Listen for response
                const handleMessage = (event: MessageEvent) => {
                    const data = JSON.parse(event.data);
                    if (data.type === 'query_result' && data.originalSql === 'search') {
                        const networkEndTime = performance.now();
                        const networkDuration = networkEndTime - startTime;
                        console.log(`🌐 Network fetch: ${networkDuration.toFixed(2)}ms`);
                        setResults(data.data);
                        setLoadTime(networkDuration);
                        socket.removeEventListener('message', handleMessage);
                    }
                };
                
                socket.addEventListener('message', handleMessage);
            }
        }
    };

    return (
        <div style={{ 
            padding: '20px', 
            border: '2px solid #8b5cf6', 
            borderRadius: '8px',
            backgroundColor: '#f9fafb',
            maxWidth: '600px',
            margin: '20px auto'
        }}>
            <h2 style={{ color: '#8b5cf6', marginTop: 0 }}>🔮 Psychic Search Demo</h2>
            <p style={{ color: '#666', fontSize: '14px' }}>
                Type slowly (e.g., "urgent") to trigger auto-sensing. Then click Search to see the magic!
            </p>
            
            <div style={{ marginBottom: '20px' }}>
                <input
                    type="text"
                    value={searchText}
                    onChange={(e) => setSearchText(e.target.value)}
                    placeholder="Type your search query..."
                    style={{
                        width: '100%',
                        padding: '10px',
                        fontSize: '16px',
                        border: '2px solid #e5e7eb',
                        borderRadius: '4px',
                        outline: 'none',
                        transition: 'border-color 0.2s'
                    }}
                    onFocus={(e) => e.target.style.borderColor = '#8b5cf6'}
                    onBlur={(e) => e.target.style.borderColor = '#e5e7eb'}
                />
            </div>
            
            <button
                onClick={handleSearch}
                style={{
                    padding: '10px 20px',
                    fontSize: '16px',
                    backgroundColor: '#8b5cf6',
                    color: 'white',
                    border: 'none',
                    borderRadius: '4px',
                    cursor: 'pointer',
                    fontWeight: 'bold'
                }}
                onMouseOver={(e) => e.currentTarget.style.backgroundColor = '#7c3aed'}
                onMouseOut={(e) => e.currentTarget.style.backgroundColor = '#8b5cf6'}
            >
                Search
            </button>
            
            {loadTime !== null && (
                <div style={{ 
                    marginTop: '15px', 
                    padding: '10px', 
                    backgroundColor: loadTime < 1 ? '#dcfce7' : '#fef3c7',
                    borderRadius: '4px',
                    fontWeight: 'bold'
                }}>
                    Load time: {loadTime.toFixed(2)}ms {loadTime < 1 ? '⚡' : '🌐'}
                </div>
            )}
            
            {results.length > 0 && (
                <div style={{ marginTop: '20px' }}>
                    <h3 style={{ fontSize: '16px', marginBottom: '10px' }}>Results:</h3>
                    <ul style={{ listStyle: 'none', padding: 0 }}>
                        {results.map((task) => (
                            <li 
                                key={task.id} 
                                style={{
                                    padding: '10px',
                                    marginBottom: '8px',
                                    backgroundColor: 'white',
                                    border: '1px solid #e5e7eb',
                                    borderRadius: '4px'
                                }}
                            >
                                <strong>{task.title}</strong> - {task.status}
                            </li>
                        ))}
                    </ul>
                </div>
            )}
        </div>
    );
};
