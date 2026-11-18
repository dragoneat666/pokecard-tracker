// vite.config.js
//
// Vite is the build tool and dev server for the React app.
// This config does two things beyond the defaults:
//
// 1. The "proxy" setting forwards /api/* requests to the backend.
//    WHY PROXY: In development, the browser is on port 14000 (frontend)
//    and the backend is on port 14001. Without the proxy, you'd get CORS
//    errors when calling the API. The proxy makes it look like the API
//    is on the same port as the frontend — Vite intercepts /api/* and
//    forwards it to the backend transparently.
//
// 2. It serves OpenCV.js (the picture-processing library the Grading pages
//    use) at /grading/opencv-4.10.0.js, straight out of node_modules, and
//    copies it into the build for the Android app. It's ~10 MB, so it is not
//    kept in the repo; the version in the file name lets browsers cache it
//    for good.
//
// 3. /download (the Android app's download page and the app itself, which
//    the backend serves) is forwarded too, so the app can be fetched from
//    the website's own address, like Family Track's.

import fs from 'node:fs';
import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const OPENCV_FILE = 'grading/opencv-4.10.0.js';

function opencvFile() {
  const source = path.resolve('node_modules/@techstark/opencv-js/dist/opencv.js');
  return {
    name: 'opencv-file',
    configureServer(server) {
      server.middlewares.use(`/${OPENCV_FILE}`, (req, res) => {
        res.setHeader('Content-Type', 'text/javascript');
        res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
        fs.createReadStream(source).pipe(res);
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: OPENCV_FILE, source: fs.readFileSync(source) });
    },
  };
}

export default defineConfig({
  plugins: [react(), opencvFile()],
  server: {
    proxy: {
      '/api': {
        target: 'http://backend:3001',  // "backend" = Docker container name
        changeOrigin: true,
      },
      // Keeps the address the phone used (no changeOrigin), so the download
      // page can show the server's address to type into the app.
      '/download': {
        target: 'http://backend:3001',
      },
    },
  },
});
