// The light and dark mode switch (platform/src/theme), defined before the header is drawn.
import './lib/hw-theme.js';
import './ui/styles.css';
import { App } from './ui/app';

const root = document.getElementById('app');
if (root) new App(root);
