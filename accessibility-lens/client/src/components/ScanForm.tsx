import { useState, type FormEvent } from 'react';

interface ScanFormProps {
  onScan: (url: string) => void;
  loading: boolean;
}

const EXAMPLES = ['https://example.com', 'https://www.washington.edu'];

export function ScanForm({ onScan, loading }: ScanFormProps): JSX.Element {
  const [value, setValue] = useState('');

  function handleSubmit(e: FormEvent): void {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed) onScan(trimmed);
  }

  return (
    <form onSubmit={handleSubmit} className="w-full" noValidate>
      <label htmlFor="url" className="mb-2 block font-medium text-ink">
        Page URL to scan
      </label>
      <div className="flex flex-col gap-3 sm:flex-row">
        <input
          id="url"
          name="url"
          type="url"
          inputMode="url"
          autoComplete="url"
          placeholder="https://your-project.example.com"
          value={value}
          onChange={(e) => setValue(e.target.value)}
          disabled={loading}
          className="min-w-0 flex-1 rounded-lg border border-field bg-panel px-4 py-3 font-mono text-sm text-ink shadow-card placeholder:text-muted disabled:opacity-60"
        />
        <button
          type="submit"
          disabled={loading || !value.trim()}
          className="rounded-lg bg-accent px-6 py-3 font-semibold text-panel shadow-card transition hover:bg-accent-soft disabled:cursor-not-allowed disabled:opacity-50"
        >
          {loading ? 'Scanning...' : 'Scan page'}
        </button>
      </div>
      <p className="mt-3 text-sm text-muted">
        Try{' '}
        {EXAMPLES.map((ex, i) => (
          <span key={ex}>
            <button
              type="button"
              onClick={() => {
                setValue(ex);
                onScan(ex);
              }}
              disabled={loading}
              className="font-mono text-accent underline underline-offset-2 hover:text-accent-soft disabled:opacity-50"
            >
              {ex}
            </button>
            {i < EXAMPLES.length - 1 ? ', ' : ''}
          </span>
        ))}
      </p>
    </form>
  );
}
