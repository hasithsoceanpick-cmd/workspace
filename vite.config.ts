import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // the Notes editor is loaded separately when someone opens Notes; its size is expected
  build: { chunkSizeWarningLimit: 700 },
});
