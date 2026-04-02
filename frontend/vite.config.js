import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [
    react(),
    tailwindcss(),
  ],
  server: {
    host: '0.0.0.0',
    port: 3000,
    proxy: {
      '/api': {
        target: 'http://localhost:5000',
        changeOrigin: true,
        secure: false,
      },
      '/socket.io': {
        target: 'ws://localhost:5000',
        ws: true,
        changeOrigin: true,
      }
    },
    hmr: false,
  },
  build: {
    outDir: 'dist',
    sourcemap: false, // Change to false for production (smaller build)
    rollupOptions: {
      output: {
        manualChunks: {
          // Split large libraries into separate chunks
          'react-vendor': ['react', 'react-dom'],
          'leaflet-vendor': ['leaflet', 'react-leaflet'],
          '3d-vendor': ['three', '@react-three/fiber', '@react-three/drei'],
          // Don't put lucide-react in a separate chunk - it causes issues
        }
      }
    },
    chunkSizeWarningLimit: 1000, // Increased from 500
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true, // Remove console.logs in production
        drop_debugger: true,
      },
    },
  },
  optimizeDeps: {
    include: ['react', 'react-dom', 'leaflet', 'react-leaflet', 'socket.io-client'],
    exclude: ['lucide-react'], // Don't pre-bundle icons
  },
  esbuild: {
    // Faster builds
    logOverride: { 'this-is-undefined-in-esm': 'silent' },
  },
})