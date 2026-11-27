// The light and dark mode switch first, so <hw-theme-toggle> is defined before
// the header renders (platform/src/theme/README.md).
import './lib/hw-theme.js';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App.js';
import './index.css';

const root = document.getElementById('root');
if (!root) throw new Error('Root element #root not found');

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
