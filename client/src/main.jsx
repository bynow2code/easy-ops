import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.jsx';
import './styles.css';
import { applyStoredTheme } from './hooks/useTheme.js';

// React 启动前同步应用一次主题，避免页面闪一下再变暗
applyStoredTheme();

createRoot(document.getElementById('root')).render(<App />);
