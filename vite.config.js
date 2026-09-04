import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import mkcert from 'vite-plugin-mkcert'

export default defineConfig({
  server: {
    host: true, // Network IP ah enable panna
    https: true // HTTPS ah enable panna
  },
  plugins: [react(), mkcert()],
})