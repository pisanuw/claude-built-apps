/** Starts the page. The light and dark switch is defined first, before the header is drawn. */
import './lib/hw-theme.js';
import './ui/styles.css';
import { mount } from './ui/app';
import { getSupabase, hasSupabase } from './lib/supabase';

const root = document.getElementById('app');
if (!root) throw new Error('index.html needs <div id="app">');
mount(root, { client: hasSupabase() ? getSupabase() : null });
