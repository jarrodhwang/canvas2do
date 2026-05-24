import path from 'path';
import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:6272';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  server: {
    host: '0.0.0.0',
    port: 6173,
    strictPort: true,
    allowedHosts: true,
    //Need To Change in production environment to allow only the specific host to access the API and secure the API from unauthorized access
    //   //allowedHosts: ['zbook-studio.tail2a5be9.ts.net']
    proxy: {
      '/api': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
      '/signin-google': {
        target: apiProxyTarget,
        changeOrigin: true,
      },
    },
  },
});
