// The light and dark mode switch (platform/src/theme), defined before the header is drawn.
import './lib/hw-theme.js';
import './ui/styles.css';
import { mountApp } from './ui/app';

mountApp(document.getElementById('app')!);
