import React, { useState, useEffect } from 'react';
import { useRealtimeQuery, useDatabase } from '../../hooks/useDatabase';
import { DataGrid } from '../DataGrid';
import { Table2, Plus } from 'lucide-react';

export const TablesView: React.FC = () => {
  const { schema } = useDatabase();
  const [selectedTable, setSelectedTable] = useState<string>('');
  
  useEffect(() => {
    if (schema) {
      const tables = Object.keys(schema);
      if (tables.length > 0 && !tables.includes(selectedTable)) {
        setSelectedTable(tables[0]);
      }
    }
  }, [schema, selectedTable]);

  const data = useRealtimeQuery(selectedTable);
  const tableList = schema ? Object.keys(schema) : [];

  return (
    <div className="flex h-full overflow-hidden">
      {/* Tables Sidebar */}
      <aside className="w-64 bg-slate-900 border-r border-slate-800 flex flex-col overflow-hidden">
        <div className="p-4 border-b border-slate-800">
          <h3 className="text-sm font-semibold text-slate-400 uppercase tracking-wider">Tables</h3>
        </div>
        
        <nav className="flex-1 p-4 space-y-1 overflow-y-auto">
          {tableList.length === 0 ? (
            <div className="px-2 py-4 text-center">
              <p className="text-xs text-slate-600 mb-2">No tables found.</p>
            </div>
          ) : (
            tableList.map(table => (
              <button
                key={table}
                onClick={() => setSelectedTable(table)}
                className={`w-full flex items-center gap-3 px-3 py-2 text-sm font-medium rounded-md transition-all ${
                  selectedTable === table
                    ? 'bg-slate-800 text-green-400' 
                    : 'text-slate-400 hover:bg-slate-800/50 hover:text-slate-200'
                }`}
              >
                <Table2 size={18} />
                {table}
              </button>
            ))
          )}
        </nav>
      </aside>

      {/* Main Grid Area */}
      <main className="flex-1 flex flex-col min-w-0 overflow-hidden">
        <header className="px-8 py-6 border-b border-slate-800 bg-slate-900 flex justify-between items-center">
          <h2 className="text-2xl font-bold text-white capitalize flex items-center gap-2">
            {selectedTable}
            <span className="text-sm font-normal text-slate-500 ml-2 border border-slate-700 px-2 py-0.5 rounded-full">
              {data ? data.length : 0} records
            </span>
          </h2>
          
          {/* Schema Info Badge */}
          <div className="hidden md:flex gap-2">
            {schema && schema[selectedTable] && schema[selectedTable].map(col => (
              <span key={col.name} className="text-xs font-mono text-slate-500 bg-slate-800 px-2 py-1 rounded">
                {col.name}: {col.type}
              </span>
            ))}
          </div>
        </header>

        <div className="flex-1 overflow-auto p-8 bg-slate-900">
          <DataGrid 
            data={data} 
            tableName={selectedTable} 
            schema={schema?.[selectedTable]}
          />
        </div>
      </main>
    </div>
  );
};
