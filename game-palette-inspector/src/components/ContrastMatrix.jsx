import { parseHex, contrastRatio } from '../color/color.js';

export const TARGETS = [
  { value: 3, label: 'UI parts & large text · 3:1 (AA)' },
  { value: 4.5, label: 'Body text · 4.5:1 (AA)' },
  { value: 7, label: 'Body text · 7:1 (AAA)' },
];

export default function ContrastMatrix({ colors, bgIndex, target, onTarget }) {
  const rgbs = colors.map((c) => parseHex(c.hex));

  return (
    <section className="section" aria-labelledby="matrix-h">
      <div className="section__head">
        <h2 id="matrix-h"><span className="tick">/</span>Contrast</h2>
        <label>
          <span className="bench-tools__label" style={{ marginRight: 8 }}>Target</span>
          <select className="field" value={target} onChange={(e) => onTarget(Number(e.target.value))}>
            {TARGETS.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
        </label>
      </div>
      <p className="section__sub">
        WCAG contrast ratio for every pair. Health bars, damage numbers, and HUD text need to clear
        the target against whatever they sit on, not just against the background.
      </p>

      {/* It scrolls sideways on a narrow screen, so the keyboard can reach it: a named region that takes focus. */}
      <div className="matrix-scroll" tabIndex={0} role="region" aria-label="Contrast matrix">
        <table className="matrix">
          <thead>
            <tr>
              <th aria-label="empty corner" />
              {colors.map((c, i) => (
                <th key={c.id} scope="col">
                  <span className="swatch-head">
                    <i style={{ background: c.hex }} aria-hidden="true" />
                    {c.hex.slice(1)}
                    {i === bgIndex ? ' · BG' : ''}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {colors.map((rowC, i) => (
              <tr key={rowC.id}>
                <th scope="row">
                  <span className="swatch-head">
                    <i style={{ background: rowC.hex }} aria-hidden="true" />
                    {rowC.hex.slice(1)}
                    {i === bgIndex ? ' · BG' : ''}
                  </span>
                </th>
                {colors.map((colC, j) => {
                  if (i === j) {
                    return <td key={colC.id} className="diag" aria-label="same color" />;
                  }
                  const ratio = contrastRatio(rgbs[i], rgbs[j]);
                  const pass = ratio >= target;
                  return (
                    <td
                      key={colC.id}
                      className={pass ? 'cell-pass' : 'cell-fail'}
                      title={`${rowC.hex} on ${colC.hex}: ${ratio.toFixed(2)}:1, ${pass ? 'meets' : 'below'} ${target}:1`}
                    >
                      {ratio.toFixed(2)}
                      <span className="mark" aria-label={pass ? 'pass' : 'fail'}>
                        {pass ? '✓' : '✕'}
                      </span>
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
