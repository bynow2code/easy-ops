// Vitest 配置（兼容 Vite8 / Rolldown）
// 复用 @vitejs/plugin-react 处理 JSX，组件测试在 jsdom 环境运行
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    globals: true,
    setupFiles: ['./vitest.setup.js'],
    include: [
      'client/src/**/*.{test,spec}.{js,jsx}',
      'server/**/*.{test,spec}.js',
      'test/**/*.{test,spec}.js',
    ],
    css: false,
  },
});
