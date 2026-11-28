// The light and dark mode switch first: it defines <hw-theme-toggle> before the app draws the header.
import './lib/hw-theme.js';
import { App } from './ui/app';
import './ui/styles.css';

const root = document.getElementById('app');
if (root) new App(root);
