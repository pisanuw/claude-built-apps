import { hexToHsv, hsToWheel, hsvToHex, hsvToRgb, wheelToHs, type Hsv } from '../core/color';
import { h } from './dom';

export interface ColorWheel {
  el: HTMLElement;
  /** Moves the wheel to show a colour chosen elsewhere (swatch, hex box). */
  set(hex: string): void;
}

const SIZE = 168;

/**
 * Hue/saturation disc plus a brightness slider and a hex box. Drag or click
 * the disc; arrow keys on the focused disc nudge hue (left/right) and
 * saturation (up/down).
 */
export function colorWheel(initial: string, onPick: (hex: string) => void): ColorWheel {
  let hsv: Hsv = hexToHsv(initial);
  let hex = initial;

  const canvas = h('canvas', { class: 'wheel-canvas', width: SIZE * 2, height: SIZE * 2 });
  const marker = h('span', { class: 'wheel-marker', 'aria-hidden': 'true' });
  const disc = h('div', { class: 'wheel', tabindex: 0, role: 'slider', 'aria-label': 'Colour wheel: arrow keys change hue and saturation' }, canvas, marker);
  const value = h('input', { type: 'range', min: 0, max: 100, step: 1, class: 'wheel-value', 'aria-label': 'Brightness' });
  const preview = h('span', { class: 'wheel-preview', 'aria-hidden': 'true' });
  const hexBox = h('input', { type: 'text', class: 'wheel-hex', maxlength: 7, spellcheck: 'false', 'aria-label': 'Colour as hex' });
  const el = h('div', { class: 'wheel-wrap' }, disc, h('div', { class: 'wheel-side' }, h('label', { class: 'wheel-label' }, 'Brightness', value), h('div', { class: 'row' }, preview, hexBox)));

  let paintedV = -1;
  function paintDisc(): void {
    if (paintedV === hsv.v) return;
    paintedV = hsv.v;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const n = canvas.width;
    const r = n / 2;
    const img = ctx.createImageData(n, n);
    for (let y = 0; y < n; y++) {
      for (let x = 0; x < n; x++) {
        const dx = (x + 0.5 - r) / r;
        const dy = (y + 0.5 - r) / r;
        const d = Math.hypot(dx, dy);
        if (d > 1 + 1 / r) continue;
        const { h: hh, s } = wheelToHs(dx, dy);
        const [cr, cg, cb] = hsvToRgb(hh, s, hsv.v);
        const i = (y * n + x) * 4;
        img.data[i] = cr;
        img.data[i + 1] = cg;
        img.data[i + 2] = cb;
        img.data[i + 3] = d > 1 ? Math.round(255 * (1 + 1 / r - d) * r) : 255;
      }
    }
    ctx.putImageData(img, 0, 0);
  }

  function render(): void {
    paintDisc();
    const [mx, my] = hsToWheel(hsv.h, hsv.s);
    marker.style.left = `${50 + 50 * mx}%`;
    marker.style.top = `${50 + 50 * my}%`;
    marker.style.background = hex;
    value.value = String(Math.round(hsv.v * 100));
    value.style.setProperty('--wheel-full', hsvToHex(hsv.h, hsv.s, 1));
    preview.style.background = hex;
    if (document.activeElement !== hexBox) hexBox.value = hex;
    disc.setAttribute('aria-valuetext', `${hex}, hue ${Math.round(hsv.h)}°, saturation ${Math.round(hsv.s * 100)}%`);
  }

  function pick(next: Hsv): void {
    hsv = next;
    hex = hsvToHex(hsv.h, hsv.s, hsv.v);
    render();
    onPick(hex);
  }

  function fromPointer(ev: PointerEvent): void {
    const rect = disc.getBoundingClientRect();
    const r = rect.width / 2;
    const { h: hh, s } = wheelToHs((ev.clientX - rect.left - r) / r, (ev.clientY - rect.top - r) / r);
    // Picking a hue on a black disc would show nothing; lift brightness.
    pick({ h: hh, s, v: hsv.v < 0.15 ? 1 : hsv.v });
  }

  disc.addEventListener('pointerdown', (ev) => {
    disc.setPointerCapture(ev.pointerId);
    fromPointer(ev);
  });
  disc.addEventListener('pointermove', (ev) => {
    if (disc.hasPointerCapture(ev.pointerId)) fromPointer(ev);
  });
  disc.addEventListener('keydown', (ev) => {
    const step = ev.shiftKey ? 10 : 2;
    let { h: hh, s } = hsv;
    if (ev.key === 'ArrowLeft') hh = (hh + 360 - step) % 360;
    else if (ev.key === 'ArrowRight') hh = (hh + step) % 360;
    else if (ev.key === 'ArrowUp') s = Math.min(1, s + step / 100);
    else if (ev.key === 'ArrowDown') s = Math.max(0, s - step / 100);
    else return;
    ev.preventDefault();
    pick({ h: hh, s, v: hsv.v });
  });
  value.addEventListener('input', () => pick({ ...hsv, v: Number(value.value) / 100 }));
  hexBox.addEventListener('input', () => {
    const t = hexBox.value.trim();
    const v = t.startsWith('#') ? t : `#${t}`;
    if (/^#[0-9a-f]{6}$/i.test(v)) {
      hsv = hexToHsv(v);
      hex = v.toLowerCase();
      render();
      onPick(hex);
    }
  });
  hexBox.addEventListener('blur', () => (hexBox.value = hex));

  render();
  return {
    el,
    set(next: string): void {
      if (next === hex) return;
      hex = next;
      hsv = hexToHsv(next);
      render();
    },
  };
}
