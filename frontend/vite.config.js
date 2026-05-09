import { defineConfig } from 'vite'

export default defineConfig({
  server: {
    port: 5173,
    proxy: {
      '/analyze': 'http://localhost:8000',
      '/remember-person': 'http://localhost:8000',
      '/people': 'http://localhost:8000',
      '/interactions': 'http://localhost:8000',
      '/health': 'http://localhost:8000',
    }
  }
})
