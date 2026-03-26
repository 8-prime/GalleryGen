import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig(({ command }) => ({
  plugins: [react(), tailwindcss()],
  // In production (docker/nginx), the SPA is served under /app/
  // In dev, keep / so `pnpm dev` works at localhost:5173 as normal
  base: command === 'build' ? '/app/' : '/',
  server: {
    proxy: {
      '/api': 'http://localhost:8080',
    },
  },
  build: {
    outDir: 'dist',
  },
}))
