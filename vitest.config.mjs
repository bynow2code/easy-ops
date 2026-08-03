// Vitest 配置（兼容 Vite8 / Rolldown）
// 复用 @vitejs/plugin-react 处理 JSX，组件测试在 jsdom 环境运行
import { defineConfig } from 'vitest/config';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  // 强制 react / react-dom 单一实例：项目里 react 装在 client/node_modules、
  // react-dom 装在根 node_modules，Vitest 默认会各解析一份 → 经典
  // "Invalid hook call / React is null" 误报。dedupe + 内联依赖合并为同一份。
  resolve: {
    dedupe: ['react', 'react-dom'],
  },
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
    server: {
      deps: {
        inline: ['react', 'react-dom', 'react-dom/client'],
      },
    },
  },
});
