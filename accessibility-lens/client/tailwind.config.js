/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    extend: {
      // Each colour is a CSS variable (src/index.css) holding "R G B", so the
      // dark theme only changes the variables and opacity modifiers such as
      // bg-accent/5 keep working.
      colors: {
        paper: 'rgb(var(--al-paper) / <alpha-value>)',
        panel: 'rgb(var(--al-panel) / <alpha-value>)',
        ink: 'rgb(var(--al-ink) / <alpha-value>)',
        muted: 'rgb(var(--al-muted) / <alpha-value>)',
        line: 'rgb(var(--al-line) / <alpha-value>)',
        accent: 'rgb(var(--al-accent) / <alpha-value>)',
        'accent-soft': 'rgb(var(--al-accent-soft) / <alpha-value>)',
        severity: {
          critical: 'rgb(var(--al-critical) / <alpha-value>)',
          serious: 'rgb(var(--al-serious) / <alpha-value>)',
          moderate: 'rgb(var(--al-moderate) / <alpha-value>)',
          minor: 'rgb(var(--al-minor) / <alpha-value>)',
        },
      },
      fontFamily: {
        display: ['Fraunces', 'Georgia', 'serif'],
        body: ['"Public Sans"', 'system-ui', 'sans-serif'],
        mono: ['"IBM Plex Mono"', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        card: '0 1px 0 rgb(var(--al-line)), 0 2px 8px rgb(var(--al-shadow) / 0.04)',
        lift: '0 4px 24px rgb(var(--al-shadow) / 0.10)',
      },
    },
  },
  plugins: [],
};
