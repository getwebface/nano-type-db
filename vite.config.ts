import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    return {
      server: {
        port: 3000,
        host: '0.0.0.0',
        // Proxy WebSocket and API requests to worker to avoid cross-port cookie issues
        proxy: {
          '/api': {
            target: 'http://localhost:8787',
            changeOrigin: true,
          },
          // WebSocket proxy
          '/__ws': {
            target: 'ws://localhost:8787',
            ws: true,
            changeOrigin: true,
            rewrite: (path) => path.replace(/^\/__ws/, ''),
          }
        }
      },
      plugins: [react()],
      define: {
        'process.env.API_KEY': JSON.stringify(env.GEMINI_API_KEY),
        'process.env.GEMINI_API_KEY': JSON.stringify(env.GEMINI_API_KEY)
      },
      resolve: {
        alias: {
          '@': path.resolve(__dirname, '.'),
        }
      }
    };
});
