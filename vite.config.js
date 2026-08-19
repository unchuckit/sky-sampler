import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  build: {
    // No source maps in production: they would republish readable source and
    // make the CSP's job harder for no user benefit.
    sourcemap: false,
  },
})
