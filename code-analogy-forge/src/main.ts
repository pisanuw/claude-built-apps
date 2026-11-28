// The light and dark mode switch first: it defines <hw-theme-toggle> before the app renders its header.
import './lib/hw-theme.js';
import './ui/styles.css';
import { mountApp } from './ui/app';

const root = document.getElementById('app');
if (root) {
  mountApp(root);
  // A share link opened from within the page only changes the hash; re-mount
  // so the shared card (or the forge, when the hash clears) renders.
  window.addEventListener('hashchange', () => mountApp(root));
}
