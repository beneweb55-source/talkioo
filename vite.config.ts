import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// https://vitejs.dev/config/
export default defineConfig({
  plugins: [react()],
  // Use relative path './' to support various hosting subpaths and prevent absolute path issues
  base: './', 
  server: {
    port: 5173,
    host: true
  }
});