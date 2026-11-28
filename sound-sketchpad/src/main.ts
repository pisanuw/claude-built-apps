// The light and dark mode switch first: it defines <hw-theme-toggle> before the app draws the header.
import './lib/hw-theme.js';
import { mountApp } from './ui/app.js';
import './ui/style.css';

mountApp(document.getElementById('app') as HTMLElement);
