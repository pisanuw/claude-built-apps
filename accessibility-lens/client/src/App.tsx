import { useState } from 'react';
import { scan, ApiError } from './lib/api.js';
import type { Report } from './lib/types.js';
import { ScanForm } from './components/ScanForm.js';
import { ScoreSummary } from './components/ScoreSummary.js';
import { ProfilePanel } from './components/ProfilePanel.js';
import { ColorVisionFilters } from './components/ColorVisionFilters.js';

type Status = 'idle' | 'loading' | 'done' | 'error';

export function App(): JSX.Element {
  const [status, setStatus] = useState<Status>('idle');
  const [report, setReport] = useState<Report | null>(null);
  const [error, setError] = useState<string>('');

  async function handleScan(url: string): Promise<void> {
    setStatus('loading');
    setError('');
    try {
      const result = await scan(url);
      setReport(result);
      setStatus('done');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'An unexpected error occurred.');
      setStatus('error');
    }
  }

  return (
    <>
      <ColorVisionFilters />
      <a href="#main" className="skip-link">
        Skip to results
      </a>

      <header className="border-b border-line bg-panel">
        <div className="mx-auto max-w-4xl px-6 py-10">
          <div className="mb-2 flex items-center justify-between gap-4">
            <p className="font-mono text-xs uppercase tracking-[0.3em] text-accent">
              Accessibility Lens
            </p>
            {/* The light and dark mode switch (platform/src/theme, src/lib/hw-theme.js). */}
            <hw-theme-toggle />
          </div>
          <h1 className="font-display text-4xl font-bold leading-tight text-ink sm:text-5xl">
            See your page through four kinds of eyes.
          </h1>
          <p className="mt-4 max-w-2xl text-lg text-muted">
            Paste a public URL. We crawl the markup and replay it the way users with low vision,
            color blindness, keyboard-only navigation, and screen readers experience it, with a
            concrete fix for every issue.
          </p>
        </div>
      </header>

      <main id="main" className="mx-auto max-w-4xl px-6 py-10">
        <ScanForm onScan={handleScan} loading={status === 'loading'} />

        <div aria-live="polite" className="mt-8">
          {status === 'loading' && (
            <p className="text-muted">Fetching and analyzing the page, one moment...</p>
          )}

          {status === 'error' && (
            <div
              role="alert"
              className="rounded-lg border-2 border-severity-critical bg-panel p-4 text-ink"
            >
              <p className="font-semibold text-severity-critical">Could not scan that page</p>
              <p className="mt-1">{error}</p>
            </div>
          )}

          {status === 'done' && report && (
            <div className="space-y-2">
              <ScoreSummary report={report} />
              <ProfilePanel report={report} />
            </div>
          )}
        </div>
      </main>

      <footer className="mt-16 border-t border-line bg-panel">
        <div className="mx-auto max-w-4xl px-6 py-8 text-sm text-muted">
          <p>
            Built as a teaching tool. Checks a deterministic subset of WCAG 2.1 on fetched HTML, so
            it complements but does not replace a manual audit or a screen reader walkthrough. See
            the project README and ASSUMPTIONS for scope and limitations.
          </p>
        </div>
      </footer>
    </>
  );
}
