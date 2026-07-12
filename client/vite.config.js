import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import os from 'os'

const getBackendPort = () => {
  // 与服务端写入路径保持一致：优先读临时目录的 easyops-port.txt
  const candidates = [
    path.join(os.tmpdir(), 'easyops-port.txt'),
    path.join(__dirname, '../server/port.txt'),
  ]
  for (const portFile of candidates) {
    try {
      if (fs.existsSync(portFile)) {
        const port = parseInt(fs.readFileSync(portFile, 'utf8').trim())
        if (port && port > 0) {
          return port
        }
      }
    } catch (e) {
      // 忽略，尝试下一个
    }
  }
  console.log('Could not read port file, using default 3001')
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
