import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import path from 'node:path';

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, 'src') } },
  // Pre-bundle everything the lazily loaded pages import so Vite never re-optimizes mid-session
  // (which would load a second React copy and break hooks on already-open pages).
  optimizeDeps: {
    include: [
      'react', 'react-dom', 'react-dom/client', 'react-router', 'react-router/dom', '@tanstack/react-query', 'zustand',
      'react-hook-form', '@hookform/resolvers/zod', 'zod', 'sonner', 'lucide-react', 'date-fns', 'clsx', 'tailwind-merge',
      'class-variance-authority', 'react-markdown', 'remark-gfm', 'recharts', '@monaco-editor/react', 'monaco-editor',
      '@radix-ui/react-avatar', '@radix-ui/react-checkbox', '@radix-ui/react-dialog', '@radix-ui/react-dropdown-menu',
      '@radix-ui/react-label', '@radix-ui/react-popover', '@radix-ui/react-progress', '@radix-ui/react-scroll-area',
      '@radix-ui/react-select', '@radix-ui/react-separator', '@radix-ui/react-slot', '@radix-ui/react-switch',
      '@radix-ui/react-tabs', '@radix-ui/react-tooltip',
    ],
  },
  server: {
    port: 5173,
    proxy: { '/api': { target: process.env.VITE_API_PROXY ?? 'http://localhost:4000', changeOrigin: true } },
  },
  build: {
    sourcemap: false,
    chunkSizeWarningLimit: 4000,
  },
});
