import { useEffect, useRef } from 'react';

// The narrated readout. Lines are pre-computed once per trace; the panel shows
// a sliding window ending at the playhead and pins itself to the newest line.

const WINDOW = 140;

export default function LogPanel({ title, lines, cursor, compact = false }) {
  const bodyRef = useRef(null);
  const shown = lines.slice(Math.max(0, cursor - WINDOW), cursor);
  const hidden = Math.max(0, cursor - WINDOW);

  useEffect(() => {
    const el = bodyRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [cursor, lines]);

  return (
    <section className={`log${compact ? ' log--compact' : ''}`}>
      <header className="log__head">
        <span className="log__title">{title}</span>
        <span className="log__count">{cursor}/{lines.length} steps</span>
      </header>
      {/* It scrolls, so it takes focus: a keyboard user can scroll it with the arrow keys. */}
      <div className="log__body" ref={bodyRef} tabIndex={0} role="region" aria-label={`${title} narration`}>
        {cursor === 0 && (
          <p className="log__empty">Press Run and the narration of every expansion appears here, derived directly from the algorithm state. No model calls, no cost, works offline.</p>
        )}
        {hidden > 0 && <p className="log__folded">… {hidden} earlier steps folded …</p>}
        <ol className="log__list" style={{ counterReset: `step ${hidden}` }}>
          {shown.map((line, i) => (
            <li
              key={hidden + i}
              className={hidden + i === cursor - 1 ? 'log__line log__line--now' : 'log__line'}
            >
              {line}
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
