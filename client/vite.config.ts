import path from 'node:path';
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const configuredBasePath = process.env.VITE_BASE_PATH || '/';
const basePath = configuredBasePath.endsWith('/') ? configuredBasePath : `${configuredBasePath}/`;

export default defineConfig({
  plugins: [react()],
  base: basePath,
  resolve: {
    alias: {
      '@shared': path.resolve(__dirname, '../shared/src')
    }
  },
  server: {
    port: 5173,
    proxy: {
      '/api': 'http://127.0.0.1:3000'
    }
  }
});
