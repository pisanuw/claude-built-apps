// The light and dark mode switch (platform/src/theme), defined before the header is drawn.
import './lib/hw-theme.js';
import './site/styles.css';
import bookmarkletCode from 'virtual:bookmarklet';
import { mount } from './site/app';

mount(document.getElementById('app') as HTMLElement, { bookmarkletCode });
