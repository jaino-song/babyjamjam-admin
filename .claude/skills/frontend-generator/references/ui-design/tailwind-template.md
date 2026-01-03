# Tailwind Config Template

> UI Design Language → Tailwind CSS 설정 변환 템플릿

---

## 1. tailwind.config.ts 템플릿

```typescript
import type { Config } from 'tailwindcss';

const config: Config = {
  darkMode: 'class',
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    extend: {
      // === Colors ===
      colors: {
        // Primary - 브랜드 컬러
        primary: {
          50: 'var(--color-primary-50)',
          100: 'var(--color-primary-100)',
          200: 'var(--color-primary-200)',
          300: 'var(--color-primary-300)',
          400: 'var(--color-primary-400)',
          500: 'var(--color-primary-500)',
          600: 'var(--color-primary-600)',
          700: 'var(--color-primary-700)',
          800: 'var(--color-primary-800)',
          900: 'var(--color-primary-900)',
          950: 'var(--color-primary-950)',
          DEFAULT: 'var(--color-primary-500)',
        },
        // Secondary - 보조 컬러
        secondary: {
          50: 'var(--color-secondary-50)',
          100: 'var(--color-secondary-100)',
          200: 'var(--color-secondary-200)',
          300: 'var(--color-secondary-300)',
          400: 'var(--color-secondary-400)',
          500: 'var(--color-secondary-500)',
          600: 'var(--color-secondary-600)',
          700: 'var(--color-secondary-700)',
          800: 'var(--color-secondary-800)',
          900: 'var(--color-secondary-900)',
          950: 'var(--color-secondary-950)',
          DEFAULT: 'var(--color-secondary-500)',
        },
        // Neutral - 그레이스케일
        neutral: {
          50: 'var(--color-neutral-50)',
          100: 'var(--color-neutral-100)',
          200: 'var(--color-neutral-200)',
          300: 'var(--color-neutral-300)',
          400: 'var(--color-neutral-400)',
          500: 'var(--color-neutral-500)',
          600: 'var(--color-neutral-600)',
          700: 'var(--color-neutral-700)',
          800: 'var(--color-neutral-800)',
          900: 'var(--color-neutral-900)',
          950: 'var(--color-neutral-950)',
        },
        // Semantic Colors
        success: {
          50: 'var(--color-success-50)',
          500: 'var(--color-success-500)',
          700: 'var(--color-success-700)',
          DEFAULT: 'var(--color-success-500)',
        },
        warning: {
          50: 'var(--color-warning-50)',
          500: 'var(--color-warning-500)',
          700: 'var(--color-warning-700)',
          DEFAULT: 'var(--color-warning-500)',
        },
        error: {
          50: 'var(--color-error-50)',
          500: 'var(--color-error-500)',
          700: 'var(--color-error-700)',
          DEFAULT: 'var(--color-error-500)',
        },
        info: {
          50: 'var(--color-info-50)',
          500: 'var(--color-info-500)',
          700: 'var(--color-info-700)',
          DEFAULT: 'var(--color-info-500)',
        },
        // Background & Surface
        background: 'var(--color-background)',
        surface: 'var(--color-surface)',
        'surface-elevated': 'var(--color-surface-elevated)',
        border: 'var(--color-border)',
      },

      // === Typography ===
      fontFamily: {
        sans: ['var(--font-sans)', 'system-ui', 'sans-serif'],
        mono: ['var(--font-mono)', 'monospace'],
        heading: ['var(--font-heading)', 'var(--font-sans)', 'system-ui'],
      },
      fontSize: {
        // Type scale (Major Third - 1.25 ratio)
        xs: ['0.64rem', { lineHeight: '1rem' }],      // 10.24px
        sm: ['0.8rem', { lineHeight: '1.25rem' }],    // 12.8px
        base: ['1rem', { lineHeight: '1.5rem' }],     // 16px
        lg: ['1.25rem', { lineHeight: '1.75rem' }],   // 20px
        xl: ['1.563rem', { lineHeight: '2rem' }],     // 25px
        '2xl': ['1.953rem', { lineHeight: '2.25rem' }], // 31.25px
        '3xl': ['2.441rem', { lineHeight: '2.5rem' }],  // 39px
        '4xl': ['3.052rem', { lineHeight: '3rem' }],    // 48.8px
        '5xl': ['3.815rem', { lineHeight: '1' }],       // 61px
      },
      fontWeight: {
        light: '300',
        normal: '400',
        medium: '500',
        semibold: '600',
        bold: '700',
      },
      letterSpacing: {
        tighter: '-0.04em',
        tight: '-0.02em',
        normal: '0',
        wide: '0.02em',
        wider: '0.04em',
      },

      // === Spacing (8px grid) ===
      spacing: {
        px: '1px',
        0: '0',
        0.5: '0.125rem',  // 2px
        1: '0.25rem',     // 4px
        1.5: '0.375rem',  // 6px
        2: '0.5rem',      // 8px
        2.5: '0.625rem',  // 10px
        3: '0.75rem',     // 12px
        3.5: '0.875rem',  // 14px
        4: '1rem',        // 16px
        5: '1.25rem',     // 20px
        6: '1.5rem',      // 24px
        7: '1.75rem',     // 28px
        8: '2rem',        // 32px
        9: '2.25rem',     // 36px
        10: '2.5rem',     // 40px
        11: '2.75rem',    // 44px
        12: '3rem',       // 48px
        14: '3.5rem',     // 56px
        16: '4rem',       // 64px
        20: '5rem',       // 80px
        24: '6rem',       // 96px
        28: '7rem',       // 112px
        32: '8rem',       // 128px
        36: '9rem',       // 144px
        40: '10rem',      // 160px
        44: '11rem',      // 176px
        48: '12rem',      // 192px
        52: '13rem',      // 208px
        56: '14rem',      // 224px
        60: '15rem',      // 240px
        64: '16rem',      // 256px
        72: '18rem',      // 288px
        80: '20rem',      // 320px
        96: '24rem',      // 384px
      },

      // === Border Radius ===
      borderRadius: {
        none: '0',
        sm: 'var(--radius-sm)',
        DEFAULT: 'var(--radius-md)',
        md: 'var(--radius-md)',
        lg: 'var(--radius-lg)',
        xl: 'var(--radius-xl)',
        '2xl': 'var(--radius-2xl)',
        '3xl': 'var(--radius-3xl)',
        full: '9999px',
      },

      // === Shadows ===
      boxShadow: {
        xs: 'var(--shadow-xs)',
        sm: 'var(--shadow-sm)',
        DEFAULT: 'var(--shadow-md)',
        md: 'var(--shadow-md)',
        lg: 'var(--shadow-lg)',
        xl: 'var(--shadow-xl)',
        '2xl': 'var(--shadow-2xl)',
        inner: 'inset 0 2px 4px 0 rgb(0 0 0 / 0.05)',
        none: 'none',
      },

      // === Animation ===
      transitionDuration: {
        fast: '150ms',
        DEFAULT: '200ms',
        slow: '300ms',
        slower: '500ms',
      },
      transitionTimingFunction: {
        DEFAULT: 'cubic-bezier(0.4, 0, 0.2, 1)',
        in: 'cubic-bezier(0.4, 0, 1, 1)',
        out: 'cubic-bezier(0, 0, 0.2, 1)',
        'in-out': 'cubic-bezier(0.4, 0, 0.2, 1)',
        bounce: 'cubic-bezier(0.175, 0.885, 0.32, 1.275)',
      },
      keyframes: {
        'fade-in': {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        'fade-out': {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        'slide-in-up': {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'slide-in-down': {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        'scale-in': {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        'spin': {
          '0%': { transform: 'rotate(0deg)' },
          '100%': { transform: 'rotate(360deg)' },
        },
        'pulse': {
          '0%, 100%': { opacity: '1' },
          '50%': { opacity: '0.5' },
        },
        'shimmer': {
          '0%': { backgroundPosition: '-200% 0' },
          '100%': { backgroundPosition: '200% 0' },
        },
      },
      animation: {
        'fade-in': 'fade-in 0.2s ease-out',
        'fade-out': 'fade-out 0.2s ease-in',
        'slide-in-up': 'slide-in-up 0.3s ease-out',
        'slide-in-down': 'slide-in-down 0.3s ease-out',
        'scale-in': 'scale-in 0.2s ease-out',
        'spin': 'spin 1s linear infinite',
        'pulse': 'pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'shimmer': 'shimmer 2s linear infinite',
      },

      // === Container ===
      container: {
        center: true,
        padding: {
          DEFAULT: '1rem',
          sm: '1.5rem',
          lg: '2rem',
          xl: '2.5rem',
          '2xl': '3rem',
        },
        screens: {
          sm: '640px',
          md: '768px',
          lg: '1024px',
          xl: '1280px',
          '2xl': '1400px',
        },
      },

      // === Screen Breakpoints ===
      screens: {
        xs: '375px',
        sm: '640px',
        md: '768px',
        lg: '1024px',
        xl: '1280px',
        '2xl': '1536px',
      },
    },
  },
  plugins: [
    // @tailwindcss/forms
    // @tailwindcss/typography
    // @tailwindcss/aspect-ratio
  ],
};

export default config;
```

---

## 2. globals.css 템플릿

```css
@tailwind base;
@tailwind components;
@tailwind utilities;

/* === CSS Variables === */
:root {
  /* Primary Colors - Blue example */
  --color-primary-50: #eff6ff;
  --color-primary-100: #dbeafe;
  --color-primary-200: #bfdbfe;
  --color-primary-300: #93c5fd;
  --color-primary-400: #60a5fa;
  --color-primary-500: #3b82f6;
  --color-primary-600: #2563eb;
  --color-primary-700: #1d4ed8;
  --color-primary-800: #1e40af;
  --color-primary-900: #1e3a8a;
  --color-primary-950: #172554;

  /* Secondary Colors - Purple example */
  --color-secondary-50: #faf5ff;
  --color-secondary-100: #f3e8ff;
  --color-secondary-200: #e9d5ff;
  --color-secondary-300: #d8b4fe;
  --color-secondary-400: #c084fc;
  --color-secondary-500: #a855f7;
  --color-secondary-600: #9333ea;
  --color-secondary-700: #7e22ce;
  --color-secondary-800: #6b21a8;
  --color-secondary-900: #581c87;
  --color-secondary-950: #3b0764;

  /* Neutral Colors */
  --color-neutral-50: #fafafa;
  --color-neutral-100: #f5f5f5;
  --color-neutral-200: #e5e5e5;
  --color-neutral-300: #d4d4d4;
  --color-neutral-400: #a3a3a3;
  --color-neutral-500: #737373;
  --color-neutral-600: #525252;
  --color-neutral-700: #404040;
  --color-neutral-800: #262626;
  --color-neutral-900: #171717;
  --color-neutral-950: #0a0a0a;

  /* Semantic Colors */
  --color-success-50: #f0fdf4;
  --color-success-500: #22c55e;
  --color-success-700: #15803d;

  --color-warning-50: #fffbeb;
  --color-warning-500: #f59e0b;
  --color-warning-700: #b45309;

  --color-error-50: #fef2f2;
  --color-error-500: #ef4444;
  --color-error-700: #b91c1c;

  --color-info-50: #eff6ff;
  --color-info-500: #3b82f6;
  --color-info-700: #1d4ed8;

  /* Background & Surface */
  --color-background: #ffffff;
  --color-surface: #ffffff;
  --color-surface-elevated: #ffffff;
  --color-border: var(--color-neutral-200);

  /* Border Radius */
  --radius-sm: 0.25rem;    /* 4px */
  --radius-md: 0.375rem;   /* 6px */
  --radius-lg: 0.5rem;     /* 8px */
  --radius-xl: 0.75rem;    /* 12px */
  --radius-2xl: 1rem;      /* 16px */
  --radius-3xl: 1.5rem;    /* 24px */

  /* Shadows */
  --shadow-xs: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-sm: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
  --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
  --shadow-2xl: 0 25px 50px -12px rgb(0 0 0 / 0.25);

  /* Fonts */
  --font-sans: 'Inter', system-ui, -apple-system, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', monospace;
  --font-heading: 'Inter', system-ui, sans-serif;
}

/* === Dark Mode === */
.dark {
  --color-primary-50: #172554;
  --color-primary-100: #1e3a8a;
  --color-primary-200: #1e40af;
  --color-primary-300: #1d4ed8;
  --color-primary-400: #2563eb;
  --color-primary-500: #3b82f6;
  --color-primary-600: #60a5fa;
  --color-primary-700: #93c5fd;
  --color-primary-800: #bfdbfe;
  --color-primary-900: #dbeafe;
  --color-primary-950: #eff6ff;

  --color-neutral-50: #0a0a0a;
  --color-neutral-100: #171717;
  --color-neutral-200: #262626;
  --color-neutral-300: #404040;
  --color-neutral-400: #525252;
  --color-neutral-500: #737373;
  --color-neutral-600: #a3a3a3;
  --color-neutral-700: #d4d4d4;
  --color-neutral-800: #e5e5e5;
  --color-neutral-900: #f5f5f5;
  --color-neutral-950: #fafafa;

  --color-background: #0a0a0a;
  --color-surface: #171717;
  --color-surface-elevated: #262626;
  --color-border: var(--color-neutral-800);
}

/* === Base Styles === */
@layer base {
  * {
    @apply border-border;
  }
  
  html {
    @apply scroll-smooth;
  }

  body {
    @apply bg-background text-neutral-900 dark:text-neutral-100;
    @apply antialiased;
    font-feature-settings: 'rlig' 1, 'calt' 1;
  }

  /* Focus styles */
  :focus-visible {
    @apply outline-none ring-2 ring-primary-500 ring-offset-2 ring-offset-background;
  }

  /* Selection */
  ::selection {
    @apply bg-primary-500/20 text-primary-900 dark:text-primary-100;
  }
}

/* === Component Classes === */
@layer components {
  /* Container */
  .container-narrow {
    @apply mx-auto max-w-3xl px-4 sm:px-6 lg:px-8;
  }

  .container-wide {
    @apply mx-auto max-w-7xl px-4 sm:px-6 lg:px-8;
  }

  /* Card */
  .card {
    @apply rounded-lg border border-border bg-surface p-6 shadow-sm;
  }

  .card-elevated {
    @apply rounded-lg bg-surface-elevated p-6 shadow-md;
  }

  /* Input */
  .input-base {
    @apply w-full rounded-md border border-border bg-background px-3 py-2;
    @apply text-neutral-900 dark:text-neutral-100;
    @apply placeholder:text-neutral-400 dark:placeholder:text-neutral-500;
    @apply focus:border-primary-500 focus:outline-none focus:ring-2 focus:ring-primary-500/20;
    @apply disabled:cursor-not-allowed disabled:opacity-50;
  }

  /* Button base */
  .btn {
    @apply inline-flex items-center justify-center gap-2 rounded-md font-medium;
    @apply transition-colors duration-fast;
    @apply focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary-500 focus-visible:ring-offset-2;
    @apply disabled:pointer-events-none disabled:opacity-50;
  }

  .btn-sm {
    @apply h-8 px-3 text-sm;
  }

  .btn-md {
    @apply h-10 px-4 text-sm;
  }

  .btn-lg {
    @apply h-12 px-6 text-base;
  }

  .btn-primary {
    @apply bg-primary-500 text-white hover:bg-primary-600;
  }

  .btn-secondary {
    @apply bg-secondary-500 text-white hover:bg-secondary-600;
  }

  .btn-outline {
    @apply border border-border bg-transparent hover:bg-neutral-100 dark:hover:bg-neutral-800;
  }

  .btn-ghost {
    @apply bg-transparent hover:bg-neutral-100 dark:hover:bg-neutral-800;
  }

  /* Text */
  .text-heading {
    @apply font-heading font-semibold tracking-tight text-neutral-900 dark:text-neutral-100;
  }

  .text-body {
    @apply text-neutral-700 dark:text-neutral-300;
  }

  .text-muted {
    @apply text-neutral-500 dark:text-neutral-400;
  }

  /* Link */
  .link {
    @apply text-primary-600 hover:text-primary-700 dark:text-primary-400 dark:hover:text-primary-300;
    @apply underline-offset-4 hover:underline;
  }

  /* Badge */
  .badge {
    @apply inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium;
  }

  .badge-primary {
    @apply bg-primary-100 text-primary-700 dark:bg-primary-900/30 dark:text-primary-400;
  }

  .badge-success {
    @apply bg-success-50 text-success-700 dark:bg-success-900/30 dark:text-success-400;
  }

  .badge-warning {
    @apply bg-warning-50 text-warning-700 dark:bg-warning-900/30 dark:text-warning-400;
  }

  .badge-error {
    @apply bg-error-50 text-error-700 dark:bg-error-900/30 dark:text-error-400;
  }
}

/* === Utility Classes === */
@layer utilities {
  /* Text balance */
  .text-balance {
    text-wrap: balance;
  }

  /* Hide scrollbar */
  .scrollbar-hide {
    -ms-overflow-style: none;
    scrollbar-width: none;
  }
  .scrollbar-hide::-webkit-scrollbar {
    display: none;
  }

  /* Gradient text */
  .gradient-text {
    @apply bg-gradient-to-r from-primary-500 to-secondary-500 bg-clip-text text-transparent;
  }

  /* Glass effect */
  .glass {
    @apply bg-white/80 backdrop-blur-md dark:bg-neutral-900/80;
  }

  /* Skeleton loading */
  .skeleton {
    @apply animate-pulse rounded bg-neutral-200 dark:bg-neutral-700;
  }
}
```

---

## 3. 색상 추출 → CSS 변수 변환 예시

### 입력 (추출된 색상)
```typescript
const extractedColors = {
  primary: '#6366f1',     // Indigo
  secondary: '#ec4899',   // Pink
  background: '#ffffff',
  text: '#18181b',
  muted: '#71717a',
};
```

### 출력 (CSS 변수)
```css
:root {
  /* Primary - Indigo */
  --color-primary-50: #eef2ff;
  --color-primary-100: #e0e7ff;
  --color-primary-200: #c7d2fe;
  --color-primary-300: #a5b4fc;
  --color-primary-400: #818cf8;
  --color-primary-500: #6366f1;  /* Base */
  --color-primary-600: #4f46e5;
  --color-primary-700: #4338ca;
  --color-primary-800: #3730a3;
  --color-primary-900: #312e81;
  --color-primary-950: #1e1b4b;
  
  /* 나머지 색상... */
}
```

---

## 4. Font 설정 예시

### Next.js Font 설정
```typescript
// app/layout.tsx
import { Inter, JetBrains_Mono } from 'next/font/google';

const inter = Inter({
  subsets: ['latin'],
  variable: '--font-sans',
  display: 'swap',
});

const jetbrainsMono = JetBrains_Mono({
  subsets: ['latin'],
  variable: '--font-mono',
  display: 'swap',
});

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ko" className={`${inter.variable} ${jetbrainsMono.variable}`}>
      <body className="font-sans">{children}</body>
    </html>
  );
}
```

---

## 5. Dark Mode 구현

### Theme Provider
```typescript
// components/providers/theme-provider.tsx
'use client';

import { ThemeProvider as NextThemesProvider } from 'next-themes';
import { type ThemeProviderProps } from 'next-themes/dist/types';

export function ThemeProvider({ children, ...props }: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute="class"
      defaultTheme="system"
      enableSystem
      disableTransitionOnChange
      {...props}
    >
      {children}
    </NextThemesProvider>
  );
}
```

### Theme Toggle
```typescript
// components/ui/theme-toggle.tsx
'use client';

import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';

export function ThemeToggle() {
  const { theme, setTheme } = useTheme();

  return (
    <button
      onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
      className="btn btn-ghost btn-sm"
      aria-label="Toggle theme"
    >
      <Sun className="h-5 w-5 rotate-0 scale-100 transition-transform dark:-rotate-90 dark:scale-0" />
      <Moon className="absolute h-5 w-5 rotate-90 scale-0 transition-transform dark:rotate-0 dark:scale-100" />
    </button>
  );
}
```

---

## 6. 사용 예시

디자인 분석 후 생성되는 파일:

```
apps/web/
├── tailwind.config.ts    # 이 템플릿 기반
├── src/
│   ├── app/
│   │   ├── globals.css   # 이 템플릿 기반
│   │   └── layout.tsx    # Font 설정 포함
│   └── components/
│       └── providers/
│           └── theme-provider.tsx
```
