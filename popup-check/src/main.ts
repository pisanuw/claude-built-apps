import './site/styles.css';
import bookmarkletCode from 'virtual:bookmarklet';
import { mount } from './site/app';

mount(document.getElementById('app') as HTMLElement, { bookmarkletCode });
