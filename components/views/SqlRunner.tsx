import React, { useState } from 'react';
import { SqlConsole } from '../SqlConsole';
import { Terminal } from 'lucide-react';

export const SqlRunner: React.FC = () => {
  const [currentTable, setCurrentTable] = useState<string>('tasks');

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <header className="px-8 py-6 border-b border-slate-800 bg-slate-900">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <Terminal size={24} />
          SQL Runner
        </h2>
        <p className="text-sm text-slate-400 mt-2">
          Execute SQL queries and view results in real-time
        </p>
      </header>

      <div className="flex-1 overflow-hidden">
        <SqlConsole currentTable={currentTable} />
      </div>
    </div>
  );
};
