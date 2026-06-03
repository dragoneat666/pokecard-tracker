// vite.config.js
//
// Vite is the build tool and dev server for the React app.
// This config does one important thing beyond the defaults:
// the "proxy" setting forwards /api/* requests to the backend.
//
// WHY PROXY: In development, the browser is on port 14000 (frontend)
// and the backend is on port 14001. Without the proxy, you'd get CORS
// errors when calling the API. The proxy makes it look like the API
// is on the same port as the frontend — Vite intercepts /api/* and
// forwards it to the backend transparently.

import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: 'http://backend:3001',  // "backend" = Docker container name
        changeOrigin: true,
      },
    },
  },
});
