import path from 'path';
import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, '.', '');
    const isProduction = mode === 'production';
    
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
      },
      // PRODUCTION: Build optimizations
      build: {
        // Minification for production
        minify: isProduction ? 'esbuild' : false,
        // Source maps for debugging (hidden in production)
        sourcemap: isProduction ? 'hidden' : true,
        // Optimize chunks
        rollupOptions: {
          output: {
            // Manual chunk splitting for better caching
            manualChunks: {
              'react-vendor': ['react', 'react-dom'],
              'ui-vendor': ['lucide-react'],
            },
          },
        },
        // Target modern browsers for smaller bundles
        target: 'es2020',
        // Improve tree-shaking
        modulePreload: {
          polyfill: true,
        },
        // Chunk size warnings
        chunkSizeWarningLimit: 1000,
      },
      // Optimize dependencies
      optimizeDeps: {
        include: ['react', 'react-dom', 'lucide-react'],
      },
    };
});
