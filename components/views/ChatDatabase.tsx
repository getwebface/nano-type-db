import React, { useState, useRef, useEffect } from 'react';
import { useDatabase } from '../../hooks/useDatabase';
import { MessageSquare, Send, Bot, User, Loader2 } from 'lucide-react';

interface Message {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  timestamp: Date;
}

export const ChatDatabase: React.FC = () => {
  const { schema } = useDatabase();
  const [messages, setMessages] = useState<Message[]>([
    {
      id: '1',
      role: 'assistant',
      content: "Hello! I'm your database assistant. I can help you explore your tables, search semantic reflex data, and analyze vectorization. What would you like to know?",
      timestamp: new Date()
    }
  ]);
  const [input, setInput] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const handleSendMessage = async () => {
    if (!input.trim() || isLoading) return;

    const userMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: input,
      timestamp: new Date()
    };

    setMessages(prev => [...prev, userMessage]);
    setInput('');
    setIsLoading(true);

    try {
      // Simulate AI response - in a real implementation, this would call Workers AI
      // For now, we'll provide some intelligent responses based on the schema
      const tableNames = schema ? Object.keys(schema) : [];
      let response = '';

      if (input.toLowerCase().includes('table')) {
        response = `You have ${tableNames.length} table(s): ${tableNames.join(', ')}. Which one would you like to explore?`;
      } else if (input.toLowerCase().includes('schema')) {
        if (tableNames.length > 0) {
          const firstTable = tableNames[0];
          const columns = schema?.[firstTable] || [];
          response = `The schema for "${firstTable}" includes these columns: ${columns.map(c => `${c.name} (${c.type})`).join(', ')}`;
        } else {
          response = "No tables found in your database yet.";
        }
      } else if (input.toLowerCase().includes('semantic') || input.toLowerCase().includes('reflex')) {
        response = "Semantic Reflex allows you to subscribe to events based on meaning using AI embeddings. You can set up semantic topics to match data based on similarity scores rather than exact matches.";
      } else if (input.toLowerCase().includes('vector')) {
        response = "Vectorization is available for semantic search capabilities. Your data can be embedded as vectors to enable similarity-based queries and AI-powered search.";
      } else {
        response = `I understand you're asking about: "${input}". I can help with table information, schema details, semantic reflex features, and vectorization analytics. What specific aspect would you like to explore?`;
      }

      const assistantMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: response,
        timestamp: new Date()
      };

      setMessages(prev => [...prev, assistantMessage]);
    } catch (error) {
      console.error('Error sending message:', error);
      const errorMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'Sorry, I encountered an error processing your request. Please try again.',
        timestamp: new Date()
      };
      setMessages(prev => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  return (
    <div className="h-full flex flex-col bg-slate-900 overflow-hidden">
      {/* Header */}
      <header className="px-8 py-6 border-b border-slate-800 bg-slate-900">
        <h2 className="text-2xl font-bold text-white flex items-center gap-2">
          <MessageSquare size={24} />
          Chat with Database
        </h2>
        <p className="text-sm text-slate-400 mt-2">
          Ask questions about your tables, semantic reflex, vectorization, and R2 storage
        </p>
      </header>

      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-8 space-y-4">
        {messages.map(message => (
          <div
            key={message.id}
            className={`flex gap-3 ${message.role === 'user' ? 'justify-end' : 'justify-start'}`}
          >
            {message.role === 'assistant' && (
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-600 flex items-center justify-center">
                <Bot size={18} className="text-white" />
              </div>
            )}
            
            <div
              className={`max-w-2xl px-4 py-3 rounded-lg ${
                message.role === 'user'
                  ? 'bg-blue-600 text-white'
                  : 'bg-slate-800 text-slate-100'
              }`}
            >
              <p className="text-sm leading-relaxed">{message.content}</p>
              <p className="text-xs mt-2 opacity-70">
                {message.timestamp.toLocaleTimeString()}
              </p>
            </div>

            {message.role === 'user' && (
              <div className="flex-shrink-0 w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center">
                <User size={18} className="text-white" />
              </div>
            )}
          </div>
        ))}

        {isLoading && (
          <div className="flex gap-3 justify-start">
            <div className="flex-shrink-0 w-8 h-8 rounded-full bg-green-600 flex items-center justify-center">
              <Bot size={18} className="text-white" />
            </div>
            <div className="bg-slate-800 px-4 py-3 rounded-lg">
              <Loader2 size={18} className="animate-spin text-slate-400" />
            </div>
          </div>
        )}

        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-6 border-t border-slate-800 bg-slate-900">
        <div className="flex gap-3">
          <input
            type="text"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Ask me anything about your database..."
            disabled={isLoading}
            className="flex-1 px-4 py-3 bg-slate-800 border border-slate-700 rounded-lg text-white placeholder-slate-500 focus:outline-none focus:ring-2 focus:ring-green-600 disabled:opacity-50"
          />
          <button
            onClick={handleSendMessage}
            disabled={!input.trim() || isLoading}
            className="px-6 py-3 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors flex items-center gap-2 font-medium"
          >
            <Send size={18} />
            Send
          </button>
        </div>
      </div>
    </div>
  );
};
