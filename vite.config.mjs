import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// 客户端 UI 构建配置
// - 入口放在 client/ 下，与 Electron 主进程分离
// - build 产物输出到根 dist/，与 electron/main.js 的 loadFile 路径对齐
export default defineConfig({
  root: 'client',
  plugins: [react()],
  server: {
    port: 5173,
    host: '127.0.0.1',
    strictPort: true,
    // 纯 Vite 开发（无 Electron）时，把 /api 代理到内嵌后端，使前端能连上后端
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:4521',
        changeOrigin: true,
      },
    },
  },
  build: {
    outDir: '../dist',
    emptyOutDir: true,
  },
});
