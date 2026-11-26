    import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import path from 'path';
import { defineConfig } from 'vite';



    export default defineConfig({
      plugins: [react(), tailwindcss()],
      resolve: {
        alias: {
          '@': path.resolve(__dirname, './src'),
        },
      },
      server: {
        // Local dev (P0): the frontend origin must match backend APP_URL
        // (http://localhost:5174). strictPort makes Vite fail loudly instead
        // of silently moving to another port and breaking that match.
        port: 5174,
        strictPort: true,
        proxy: {
          // Backend dev server: PORT=3000 (backend/.env; default in
          // backend/config/env.ts). Used when VITE_API_URL is unset.
          // 127.0.0.1, not "localhost": Node resolves localhost to IPv6 (::1)
          // first, so another dev server on [::1]:3000 (e.g. a Next.js app)
          // would answer every /api call with its own 404 page.
          '/api': {
            target: 'http://127.0.0.1:3000',
            changeOrigin: true,
          },
          
        },
      },
    });
