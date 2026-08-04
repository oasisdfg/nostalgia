import type { Config } from 'tailwindcss';

const rgb = (token: string): string => `rgb(var(${token}) / <alpha-value>)`;

export default {
  content: ['./src/renderer/index.html', './src/renderer/**/*.{ts,tsx}'],
  theme: {
    extend: {
      colors: {
        bg: rgb('--n-bg'),
        surface: rgb('--n-surface'),
        'surface-2': rgb('--n-surface-2'),
        overlay: rgb('--n-overlay'),
        border: rgb('--n-border'),
        'border-strong': rgb('--n-border-strong'),
        fg: rgb('--n-fg'),
        'fg-muted': rgb('--n-fg-muted'),
        'fg-faint': rgb('--n-fg-faint'),
        accent: rgb('--n-accent'),
        'accent-hover': rgb('--n-accent-hover'),
        'accent-fg': rgb('--n-accent-fg'),
        danger: rgb('--n-danger'),
        warning: rgb('--n-warning'),
        positive: rgb('--n-positive'),
      },
      borderRadius: { sm: '6px', DEFAULT: '9px', md: '9px', lg: '12px', xl: '16px', '2xl': '20px' },
      fontSize: {
        '2xs': ['11px', '15px'],
      },
      letterSpacing: { tightish: '-0.01em' },
      boxShadow: {
        e1: '0 1px 2px 0 rgb(0 0 0 / 0.40)',
        e2: '0 6px 20px -6px rgb(0 0 0 / 0.55)',
        e3: '0 18px 44px -14px rgb(0 0 0 / 0.7)',
        // Recessed well — the borderless replacement for inputs/inset surfaces.
        'inset-1': 'inset 0 1px 3px 0 rgb(0 0 0 / 0.45)',
        // Upward soft edge for bottom-anchored bars (replaces border-t hairlines).
        up: '0 -6px 16px -8px rgb(0 0 0 / 0.55)',
      },
      ringColor: { DEFAULT: 'rgb(var(--n-accent))' },
      ringOffsetColor: { bg: 'rgb(var(--n-bg))', surface: 'rgb(var(--n-surface))' },
      keyframes: {
        'fade-in': { from: { opacity: '0' }, to: { opacity: '1' } },
        'pop-in': { from: { opacity: '0', transform: 'translateY(4px)' }, to: { opacity: '1', transform: 'none' } },
      },
      animation: {
        'fade-in': 'fade-in 160ms ease-out',
        'pop-in': 'pop-in 180ms ease-out',
      },
    },
  },
  plugins: [],
} satisfies Config;
