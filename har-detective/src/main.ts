// The light and dark mode switch (platform/src/theme), defined before the header is drawn.
import './lib/hw-theme.js';
import './ui/styles.css';
import { initApp } from './ui/app';

initApp(document.querySelector('#app') as HTMLElement);
