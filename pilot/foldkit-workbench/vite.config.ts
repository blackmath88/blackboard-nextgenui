import { defineConfig } from 'vite'
import { unibas } from './unibas.js'

export default defineConfig({
  plugins: [unibas()],
  server: {
    host: '127.0.0.1',
    port: 4320,
    strictPort: true,
  },
  build: {
    rollupOptions: {
      input: { main: 'index.html', studio: 'studio.html' },
    },
  },
  preview: {
    host: '127.0.0.1',
    port: 4321,
    strictPort: true,
  },
})
