import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // Treat .wasm files as URL assets so @phi-ag/argon2/fetch can load argon2.wasm at runtime
  assetsInclude: ['**/*.wasm'],
  optimizeDeps: {
    exclude: ['@phi-ag/argon2'],
  },
  server: {
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/collab': {
        target: 'ws://localhost:3002',
        ws: true,
        rewrite: (path) => path.replace(/^\/collab/, ''),
      },
    },
  },
});
