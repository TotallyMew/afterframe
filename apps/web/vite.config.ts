import { defineConfig, type ProxyOptions } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';

const backend = new URL(process.env.AFTERFRAME_API_URL || 'http://localhost:4173');

const apiProxy: ProxyOptions = {
  target: backend.origin,
  changeOrigin: true,
  configure(proxy) {
    proxy.on('proxyReq', (outgoing, incoming) => {
      // The API checks Origin against Host on writes.
      if (incoming.headers.origin === `http://${incoming.headers.host}`) {
        outgoing.setHeader('origin', backend.origin);
      }
    });
  },
};

const proxy = {
  '/api/': apiProxy,
  '/art/': apiProxy,
  '/stream/': apiProxy,
  '/comic-cover/': apiProxy,
  '/comic-page/': apiProxy,
  '/player/': apiProxy,
  '^/[a-z0-9][\\w.-]*\\.(?:css|js|vtt)$': apiProxy,
};

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: { host: 'localhost', port: 5174, strictPort: true, proxy },
  preview: { host: 'localhost', port: 4175, strictPort: true, proxy },
});
