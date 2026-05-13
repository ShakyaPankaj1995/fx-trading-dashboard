import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import eventsHandler from './api/events.js';

// https://vite.dev/config/
export default defineConfig({
  plugins: [
    react(),
    {
      name: 'api-events-mock',
      configureServer(server) {
        server.middlewares.use((req, res, next) => {
          if (req.url.startsWith('/api/events')) {
            const url = new URL(req.url, 'http://localhost');
            req.query = Object.fromEntries(url.searchParams);
            
            // Mock Vercel res.status().json()
            res.status = (code) => {
              res.statusCode = code;
              return res;
            };
            res.json = (data) => {
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify(data));
            };
            
            eventsHandler(req, res);
            return;
          }
          next();
        });
      }
    }
  ],
  server: {
    proxy: {
      '/api/finance': {
        target: 'https://query1.finance.yahoo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/finance/, ''),
        headers: {
          'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
          'Accept': 'application/json'
        }
      }
    }
  }
})
