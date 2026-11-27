// The light and dark mode switch (platform/src/theme), defined before the header is drawn.
import './lib/hw-theme.js';
import './ui/styles.css';
import { mountApp } from './ui/app';

const root = document.getElementById('app');
if (root) {
  mountApp(root);
}
