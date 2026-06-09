import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'

const getBackendPort = () => {
  const portFile = path.join(__dirname, '../backend/port.txt')
  try {
    if (fs.existsSync(portFile)) {
      const port = parseInt(fs.readFileSync(portFile, 'utf8').trim())
      if (port && port > 0) {
        return port
      }
    }
  } catch (e) {
    console.log('Could not read port file, using default')
  }
  return 3001
}

export default defineConfig({
  base: './',
  plugins: [react()],
  server: {
    proxy: {
      '/api': {
        target: `http://localhost:${getBackendPort()}`,
        changeOrigin: true,
      },
    },
  },
})
