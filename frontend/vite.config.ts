import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

const apiProxyTarget = process.env.VITE_API_PROXY_TARGET ?? 'http://localhost:6272';
const configuredBasePath = process.env.VITE_BASE_PATH?.trim() || '/';
const base = configuredBasePath === '/'
  ? '/'
  : `/${configuredBasePath.replace(/^\/+|\/+$/g, '')}/`;

export default defineConfig({
  plugins: [react(), tailwindcss()],
  base,
  build: {
    target: 'es2022',
    rolldownOptions: {
      output: {
        // Framework and accessible UI primitives change less often than app code.
        // Stable vendor chunks improve repeat-visit caching through Cloudflare and
        // keep feature chunks small enough to parse comfortably on mobile devices.
        codeSplitting: {
          groups: [
            {
              name: 'react-vendor',
              test: /node_modules[\\/](?:react|react-dom|scheduler)[\\/]/,
              priority: 3,
            },
            {
              name: 'radix-vendor',
              test: /node_modules[\\/](?:@radix-ui|radix-ui)[\\/]/,
              priority: 2,
            },
          ],
        },
      },
    },
  },
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
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
    },
  },
});
