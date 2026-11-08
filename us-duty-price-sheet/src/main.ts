import './ui/styles.css';
import { mount } from './ui/app';
import { HtsIndex, type HtsData, type RateChange } from './core/hts';
import { browserStore } from './core/storage';
import history from './data/rate-history.json';

const root = document.getElementById('app') as HTMLElement;
root.textContent = 'Loading the US tariff data…';

// The tariff data is about 140 KB compressed, so it loads as its own file.
import('./data/hts.json')
  .then((mod) => {
    mount(root, { index: new HtsIndex(mod.default as unknown as HtsData), history: history as RateChange[], store: browserStore() });
  })
  .catch(() => {
    root.textContent = 'The US tariff data could not be loaded. Check your connection and reload the page.';
  });
