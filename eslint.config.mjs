// ESLint 9 flat config（ESM，与 vite.config.mjs 同风格）
// 规则组合：js 推荐 + react 推荐 + react-hooks + prettier 关闭格式化冲突规则
import js from '@eslint/js';
import globals from 'globals';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';
import prettier from 'eslint-config-prettier';

export default [
  {
    ignores: [
      'dist',
      'release',
      'node_modules',
      'client/public',
      'coverage',
      '*.config.mjs',
      '*.config.js',
    ],
  },
  js.configs.recommended,
  react.configs.flat.recommended,
  {
    files: ['**/*.{js,jsx}'],
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
    },
  },
  {
    // 测试文件：开放 vitest 全局 API，避免 no-undef
    files: ['**/*.test.{js,jsx}', '**/vitest.setup.js', '**/tests/**'],
    languageOptions: {
      globals: {
        ...globals.node,
        test: 'readonly',
        expect: 'readonly',
        describe: 'readonly',
        it: 'readonly',
        beforeAll: 'readonly',
        afterAll: 'readonly',
        beforeEach: 'readonly',
        afterEach: 'readonly',
        vi: 'readonly',
      },
    },
  },
  {
    files: ['**/*.{js,jsx}'],
    plugins: { 'react-hooks': reactHooks },
    settings: { react: { version: 'detect' } },
    rules: {
      // 使用 @vitejs/plugin-react 的自动 JSX runtime，无需手动 import React
      'react/react-in-jsx-scope': 'off',
      // 本项目未使用 prop-types
      'react/prop-types': 'off',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'no-unused-vars': [
        'warn',
        {
          argsIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          caughtErrorsIgnorePattern: '^_',
        },
      ],
    },
  },
  // 必须放最后：关闭所有与 Prettier 冲突的格式化规则
  prettier,
];
