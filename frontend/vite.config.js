import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { visualizer } from 'rollup-plugin-visualizer' // Add this to analyze bundles

export default defineConfig({
  plugins: [
    react({
      // Enable Fast Refresh and better runtime
      fastRefresh: true,
      babel: {
        plugins: [
          ['@babel/plugin-transform-runtime', { useESModules: true }]
        ]
      }
    }),
    tailwindcss(),
    // Optional: use to analyze bundle size (remove in production)
    visualizer({ filename: 'dist/bundle-analysis.html', open: false })
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
    // Don't disable HMR completely - it hurts dev experience
    hmr: {
      overlay: true,
    },
    // Add warmup for faster page loads
    warmup: {
      clientFiles: ['./src/Dashboard.jsx', './src/index.css'],
    },
  },
  
  build: {
    outDir: 'dist',
    sourcemap: false, // Keep false for production
    
    // Target modern browsers for smaller bundles
    target: 'es2020',
    
    // Better chunk splitting
    rollupOptions: {
      output: {
        manualChunks: (id) => {
          // Vendor chunks
          if (id.includes('node_modules')) {
            // Core React
            if (id.includes('react') || id.includes('react-dom')) {
              return 'react-core';
            }
            // Map libraries (leaflet is huge)
            if (id.includes('leaflet') || id.includes('react-leaflet')) {
              return 'map-libs';
            }
            // 3D libraries - split into separate chunk
            if (id.includes('three') || id.includes('@react-three')) {
              return '3d-engine';
            }
            // Lucide icons - PERFECT for your case
            if (id.includes('lucide-react')) {
              // Further split icons by usage frequency
              if (id.includes('icons/')) {
                const iconName = id.split('/').pop().replace('.js', '');
                // Frequently used icons get their own chunk
                const frequentIcons = ['Bus', 'MapPin', 'Navigation', 'X', 'ChevronDown', 'ChevronUp'];
                if (frequentIcons.includes(iconName)) {
                  return `icon-${iconName}`;
                }
              }
              return 'icons';
            }
            // Socket.io
            if (id.includes('socket.io')) {
              return 'socket';
            }
            // Everything else
            return 'vendor';
          }
          
          // App code chunks by feature
          if (id.includes('/src/')) {
            if (id.includes('Dashboard') || id.includes('Walking3DView')) {
              return 'app-main';
            }
            if (id.includes('VoiceAccessibilityModal')) {
              return 'app-voice';
            }
          }
        },
        
        // Better file naming for caching
        chunkFileNames: 'assets/[name]-[hash].js',
        entryFileNames: 'assets/[name]-[hash].js',
        assetFileNames: 'assets/[name]-[hash].[ext]',
        
        // Optimize for initial load
        minifyInternalExports: true,
      },
    },
    
    chunkSizeWarningLimit: 500, // Lower threshold to catch issues earlier
    
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug'], // Remove more
        passes: 2, // Multiple passes for better compression
      },
      mangle: {
        properties: {
          regex: /^_/, // Mangle private properties
        },
      },
      format: {
        comments: false, // Remove comments
      },
    },
    
    // Enable CSS splitting
    cssCodeSplit: true,
    
    // Better tree shaking
    treeshake: {
      moduleSideEffects: 'no-external',
      propertyReadSideEffects: false,
      tryCatchDeoptimization: false,
      unknownGlobalSideEffects: false,
    },
    
    // Enable module preload
    modulePreload: {
      polyfill: true,
    },
    
    // Report compressed sizes
    reportCompressedSize: true,
  },
  
  optimizeDeps: {
    // Include these for pre-bundling
    include: [
      'react', 
      'react-dom', 
      'react/jsx-runtime',
      'leaflet', 
      'react-leaflet',
      'socket.io-client',
      'lucide-react',
      // Add commonly used dependencies
      '@react-three/fiber',
      '@react-three/drei',
    ],
    // Exclude these from pre-bundling (they'll be lazy loaded)
    exclude: [
      'three', // Three.js is huge - lazy load it
      // Don't exclude lucide-react completely - that hurts performance
    ],
    // Enable esbuild for faster optimization
    esbuildOptions: {
      treeShaking: true,
      target: 'es2020',
    },
  },
  
  // Add experimental features
  experimental: {
    renderBuiltUrl: (filename, { hostType }) => {
      // Optimize asset loading
      if (hostType === 'js') {
        return { runtime: `window.__ASSET_PREFIX__ + ${JSON.stringify(filename)}` };
      }
      return { relative: true };
    },
  },
  
  esbuild: {
    logOverride: { 'this-is-undefined-in-esm': 'silent' },
    // Drop console logs in production
    drop: process.env.NODE_ENV === 'production' ? ['console', 'debugger'] : [],
    // Target modern browsers
    target: 'es2020',
    // Minify identifiers
    minifyIdentifiers: true,
    minifySyntax: true,
    minifyWhitespace: true,
  },
  
  // Add cache directory for faster builds
  cacheDir: '.vite-cache',
})