/** Bookmark entry point: bundled into one javascript: link at build time. */
import { togglePanel, type Panel } from './panel';

declare const __SITE_URL__: string;

const w = window as unknown as { __popupCheckPanel?: Panel | null };
w.__popupCheckPanel = togglePanel({ siteUrl: __SITE_URL__ }, w.__popupCheckPanel);
