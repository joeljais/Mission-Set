import { defineConfig } from 'vite'

export default defineConfig({
  // Allow the dev server to serve files from the parent directory
  // so we can fetch ../verification_results.json (the Python script's output)
  server: {
    port: 5173,
    open: true,
    fs: {
      allow: ['..', '.']
    }
  }
})
