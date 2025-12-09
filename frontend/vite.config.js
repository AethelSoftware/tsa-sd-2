import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'


// https://vite.dev/config/
export default defineConfig({
  _plugins: [
    react(),
    tailwindcss(),
  ],
  get plugins() {
    return this._plugins
  },
  set plugins(value) {
    this._plugins = value
  },
  server: {
    host: '0.0.0.0',
    port: 3000
  }
})
