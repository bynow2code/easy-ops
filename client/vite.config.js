import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import fs from 'fs'
import path from 'path'
import os from 'os'

// 后端端口由「操作系统随机分配」（server/index.js 用 app.listen(0)），
// 并写入系统临时目录的 easyops-port.txt（见 server/index.js 的 PORT_FILE）。
// dev 代理只认这一个唯一真源；后端未启动时该文件不存在，代理回退到占位端口。
const getBackendPort = () => {
  const portFile = path.join(os.tmpdir(), 'easyops-port.txt')
  try {
    if (fs.existsSync(portFile)) {
      const port = parseInt(fs.readFileSync(portFile, 'utf8').trim(), 10)
      if (port && port > 0) return port
    }
  } catch {
    // 忽略，走下方回退
  }
  console.warn('[vite] 未读到后端端口文件，代理回退到占位端口 3001（后端是否已启动？）')
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
