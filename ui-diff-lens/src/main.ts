// The light and dark mode switch first: it defines <hw-theme-toggle> before the app draws the header.
import './lib/hw-theme.js';
import './ui/styles.css';
import { initApp } from './ui/app';

initApp(document.getElementById('app') as HTMLElement);
