import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '');
  const backendUrl = env.VITE_BACKEND_URL || 'http://127.0.0.1:4000';

  return {
    plugins: [react()],
    server: {
      port: 5173,
      // Allows importing ../shared/contactRules.mjs (validation rules shared with the backend)
      fs: { allow: ['..'] },
      // While developing, calls to /api/... are forwarded to the Node.js backend
      proxy: {
        '/api': { target: backendUrl, changeOrigin: true },
      },
    },
  };
});
