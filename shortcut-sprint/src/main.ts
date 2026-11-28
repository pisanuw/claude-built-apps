// The light and dark mode switch first: it defines <hw-theme-toggle> before the app renders its header.
import './lib/hw-theme.js';
import './ui/styles.css';
import { App } from './ui/app';

const root = document.getElementById('app');
if (!root) throw new Error('missing #app root');
new App(root);
