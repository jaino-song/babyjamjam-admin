# Design System: imirae-incheon.com

**Date:** 2026-03-07
**Design Direction:** Warm & Trustworthy
**Status:** Draft - Awaiting Approval

---

## 1. Design Tokens

### 1.1 Colors

```css
:root {
  /* Primary - Warm Rose/Pink */
  --color-primary-50: #FFF5F5;
  --color-primary-100: #FFE0E6;
  --color-primary-200: #FFC2CC;
  --color-primary-300: #FFA3B3;
  --color-primary-400: #FF8599;
  --color-primary-500: #E8637A;
  --color-primary-600: #D14D64;
  --color-primary-700: #B3384E;
  --color-primary-800: #8C2339;
  --color-primary-900: #661024;

  /* Secondary - Soft Sage Green */
  --color-secondary-50: #F2F8F4;
  --color-secondary-100: #E0F0E5;
  --color-secondary-200: #C1E1CB;
  --color-secondary-300: #A3D2B1;
  --color-secondary-400: #84C397;
  --color-secondary-500: #6BAD80;
  --color-secondary-600: #559468;
  --color-secondary-700: #3F7A50;
  --color-secondary-800: #2A6138;
  --color-secondary-900: #144720;

  /* Accent - Warm Amber/Gold */
  --color-accent-50: #FFFBF0;
  --color-accent-100: #FFF3D6;
  --color-accent-200: #FFE7AD;
  --color-accent-300: #FFDB85;
  --color-accent-400: #FFCF5C;
  --color-accent-500: #F0B840;
  --color-accent-600: #D9A020;
  --color-accent-700: #B38318;
  --color-accent-800: #8C6610;
  --color-accent-900: #664A08;

  /* Neutrals - Warm Gray */
  --color-neutral-0: #FFFFFF;
  --color-neutral-50: #FDFCFB;
  --color-neutral-100: #F7F5F3;
  --color-neutral-200: #EDE9E5;
  --color-neutral-300: #DDD7D1;
  --color-neutral-400: #B8AFA7;
  --color-neutral-500: #93897E;
  --color-neutral-600: #6E6559;
  --color-neutral-700: #4A4238;
  --color-neutral-800: #332C24;
  --color-neutral-900: #1C1814;

  /* Semantic */
  --color-success: #4CAF50;
  --color-warning: #FF9800;
  --color-error: #F44336;
  --color-info: #2196F3;

  /* Background */
  --color-bg-primary: #FDFCFB;
  --color-bg-secondary: #FFF5F5;
  --color-bg-cream: #FFF9F0;
  --color-bg-card: #FFFFFF;
  --color-bg-overlay: rgba(28, 24, 20, 0.5);
}
```

### 1.2 Typography

```css
:root {
  /* Font Family */
  --font-heading: 'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif;
  --font-body: 'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif;

  /* Font Sizes */
  --text-xs: 0.75rem;     /* 12px */
  --text-sm: 0.875rem;    /* 14px */
  --text-base: 1rem;      /* 16px */
  --text-lg: 1.125rem;    /* 18px */
  --text-xl: 1.25rem;     /* 20px */
  --text-2xl: 1.5rem;     /* 24px */
  --text-3xl: 1.875rem;   /* 30px */
  --text-4xl: 2.25rem;    /* 36px */
  --text-5xl: 3rem;       /* 48px */

  /* Font Weights */
  --font-regular: 400;
  --font-medium: 500;
  --font-semibold: 600;
  --font-bold: 700;

  /* Line Heights */
  --leading-tight: 1.25;
  --leading-snug: 1.375;
  --leading-normal: 1.5;
  --leading-relaxed: 1.625;
  --leading-loose: 2;

  /* Letter Spacing */
  --tracking-tight: -0.025em;
  --tracking-normal: 0;
  --tracking-wide: 0.025em;
}
```

### 1.3 Spacing

Base unit: 4px

```css
:root {
  --space-0: 0;
  --space-1: 0.25rem;   /* 4px */
  --space-2: 0.5rem;    /* 8px */
  --space-3: 0.75rem;   /* 12px */
  --space-4: 1rem;      /* 16px */
  --space-5: 1.25rem;   /* 20px */
  --space-6: 1.5rem;    /* 24px */
  --space-8: 2rem;      /* 32px */
  --space-10: 2.5rem;   /* 40px */
  --space-12: 3rem;     /* 48px */
  --space-16: 4rem;     /* 64px */
  --space-20: 5rem;     /* 80px */
  --space-24: 6rem;     /* 96px */
}
```

### 1.4 Border Radius

Unified rounded value across all components: `12px`

```css
:root {
  --radius-sm: 8px;
  --radius-md: 12px;    /* DEFAULT - used by all components */
  --radius-lg: 16px;
  --radius-xl: 24px;
  --radius-full: 9999px;
}
```

### 1.5 Shadows

```css
:root {
  --shadow-sm: 0 1px 2px rgba(28, 24, 20, 0.05);
  --shadow-md: 0 4px 12px rgba(28, 24, 20, 0.08);
  --shadow-lg: 0 8px 24px rgba(28, 24, 20, 0.12);
  --shadow-xl: 0 16px 48px rgba(28, 24, 20, 0.16);
}
```

### 1.6 Breakpoints

```css
:root {
  --bp-mobile: 480px;
  --bp-tablet: 768px;
  --bp-desktop: 1024px;
  --bp-wide: 1280px;
}
```

### 1.7 Animation

All animations are CSS-only (no Tailwind animations). Defined at component level.

```css
:root {
  /* Timing */
  --ease-default: cubic-bezier(0.4, 0, 0.2, 1);
  --ease-in: cubic-bezier(0.4, 0, 1, 1);
  --ease-out: cubic-bezier(0, 0, 0.2, 1);
  --ease-bounce: cubic-bezier(0.34, 1.56, 0.64, 1);

  /* Durations */
  --duration-fast: 150ms;
  --duration-normal: 300ms;
  --duration-slow: 500ms;
}

/* Mount animations */
@keyframes fadeIn {
  from { opacity: 0; }
  to { opacity: 1; }
}

@keyframes fadeInUp {
  from { opacity: 0; transform: translateY(16px); }
  to { opacity: 1; transform: translateY(0); }
}

@keyframes fadeInScale {
  from { opacity: 0; transform: scale(0.95); }
  to { opacity: 1; transform: scale(1); }
}

@keyframes slideInRight {
  from { opacity: 0; transform: translateX(16px); }
  to { opacity: 1; transform: translateX(0); }
}

@keyframes skeletonPulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.5; }
}
```

---

## 2. Atoms

### Button

**Category:** Atom
**data-component:** `{parent}-button`

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| variant | `'primary'` \| `'secondary'` \| `'outline'` \| `'ghost'` | `'primary'` | Visual variant |
| size | `'sm'` \| `'md'` \| `'lg'` | `'md'` | Button size |
| fullWidth | `boolean` | `false` | Stretch to full container width |
| disabled | `boolean` | `false` | Disable interaction |
| loading | `boolean` | `false` | Show loading spinner |

**Styles:**

| Variant | Background | Text | Border | Hover |
|---------|-----------|------|--------|-------|
| primary | `--color-primary-500` | `#FFFFFF` | none | `--color-primary-600` |
| secondary | `--color-secondary-500` | `#FFFFFF` | none | `--color-secondary-600` |
| outline | transparent | `--color-primary-500` | `--color-primary-500` | `--color-primary-50` bg |
| ghost | transparent | `--color-neutral-700` | none | `--color-neutral-100` bg |

| Size | Padding | Font Size | Height |
|------|---------|-----------|--------|
| sm | `8px 16px` | `--text-sm` | 36px |
| md | `12px 24px` | `--text-base` | 44px |
| lg | `16px 32px` | `--text-lg` | 52px |

**Skeleton:** Rounded rectangle matching button dimensions, pulse animation
**Mount Animation:** `fadeIn` 300ms ease-out
**Accessibility:** `role="button"`, `aria-disabled`, `aria-busy` for loading state, keyboard focusable

---

### Input

**Category:** Atom
**data-component:** `{parent}-input`

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| type | `'text'` \| `'email'` \| `'tel'` \| `'number'` \| `'password'` | `'text'` | Input type |
| size | `'sm'` \| `'md'` \| `'lg'` | `'md'` | Input size |
| error | `boolean` | `false` | Error state |
| disabled | `boolean` | `false` | Disabled state |
| placeholder | `string` | `''` | Placeholder text |

**Styles:**
- Background: `--color-neutral-0`
- Border: `1px solid --color-neutral-300`
- Border (focus): `--color-primary-400`
- Border (error): `--color-error`
- Border-radius: `--radius-md`
- Padding: `12px 16px` (md)

**Skeleton:** Rounded rectangle matching input dimensions, pulse animation
**Mount Animation:** `fadeIn` 300ms ease-out
**Accessibility:** `aria-invalid` for error, `aria-describedby` for error message, associated `<label>`

---

### Textarea

**Category:** Atom
**data-component:** `{parent}-textarea`

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| rows | `number` | `4` | Number of visible rows |
| error | `boolean` | `false` | Error state |
| disabled | `boolean` | `false` | Disabled state |
| placeholder | `string` | `''` | Placeholder text |

**Styles:** Same as Input, with `resize: vertical`
**Skeleton:** Rounded rectangle, pulse animation
**Mount Animation:** `fadeIn` 300ms ease-out

---

### Label

**Category:** Atom
**data-component:** `{parent}-label`

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| required | `boolean` | `false` | Show required indicator |
| htmlFor | `string` | - | Associated input ID |

**Styles:**
- Font: `--text-sm`, `--font-medium`
- Color: `--color-neutral-700`
- Required indicator: `--color-primary-500` asterisk

---

### Badge

**Category:** Atom
**data-component:** `{parent}-badge`

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| variant | `'primary'` \| `'secondary'` \| `'accent'` \| `'neutral'` | `'primary'` | Color variant |
| size | `'sm'` \| `'md'` | `'sm'` | Badge size |

**Styles:**
- Padding: `4px 12px` (sm), `6px 16px` (md)
- Border-radius: `--radius-full`
- Font: `--text-xs` (sm), `--text-sm` (md), `--font-medium`
- Primary: bg `--color-primary-100`, text `--color-primary-700`
- Secondary: bg `--color-secondary-100`, text `--color-secondary-700`
- Accent: bg `--color-accent-100`, text `--color-accent-700`
- Neutral: bg `--color-neutral-200`, text `--color-neutral-700`

---

### Avatar

**Category:** Atom
**data-component:** `{parent}-avatar`

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| src | `string` | - | Image source URL |
| alt | `string` | - | Alt text |
| size | `'sm'` \| `'md'` \| `'lg'` | `'md'` | Avatar size |
| fallback | `string` | - | Initials fallback |

**Styles:**
- Sizes: 32px (sm), 44px (md), 64px (lg)
- Border-radius: `--radius-full`
- Fallback: bg `--color-primary-100`, text `--color-primary-600`

**Skeleton:** Circle matching avatar size, pulse animation

---

### Skeleton

**Category:** Atom
**data-component:** `{parent}-skeleton`

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| variant | `'text'` \| `'circular'` \| `'rectangular'` | `'text'` | Shape variant |
| width | `string` | `'100%'` | Width |
| height | `string` | `'1em'` | Height |

**Styles:**
- Background: `--color-neutral-200`
- Border-radius: `--radius-md` (rectangular/text), `--radius-full` (circular)
- Animation: `skeletonPulse 1.5s ease-in-out infinite`

---

### Typography

**Category:** Atom
**data-component:** `{parent}-heading` / `{parent}-text` / `{parent}-caption`

#### Heading

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| level | `1` \| `2` \| `3` \| `4` \| `5` | `2` | Heading level (h1-h5) |
| align | `'left'` \| `'center'` \| `'right'` | `'left'` | Text alignment |

Heading sizes:
- h1: `--text-5xl`, `--font-bold`, `--leading-tight`
- h2: `--text-4xl`, `--font-bold`, `--leading-tight`
- h3: `--text-3xl`, `--font-semibold`, `--leading-snug`
- h4: `--text-2xl`, `--font-semibold`, `--leading-snug`
- h5: `--text-xl`, `--font-semibold`, `--leading-snug`

#### Text

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| size | `'sm'` \| `'base'` \| `'lg'` | `'base'` | Text size |
| color | `'default'` \| `'muted'` \| `'primary'` | `'default'` | Text color |

#### Caption

- Font: `--text-xs`, `--font-regular`
- Color: `--color-neutral-500`

---

### Icon

**Category:** Atom
**data-component:** `{parent}-icon`

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| name | `string` | - | Icon identifier |
| size | `'sm'` \| `'md'` \| `'lg'` | `'md'` | Icon size |
| color | `string` | `'currentColor'` | Icon color |

Sizes: 16px (sm), 20px (md), 24px (lg)

---

## 3. Molecules

### FormField

**Category:** Molecule
**data-component:** `{parent}-field`

**Composition:** Label + Input/Textarea + Error message

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| label | `string` | - | Field label |
| error | `string` | - | Error message |
| required | `boolean` | `false` | Required field |
| helperText | `string` | - | Helper text below input |

**Structure:**
```html
<div data-component="{parent}-field">
  <label data-component="{parent}-field-label">...</label>
  <input data-component="{parent}-field-input" />
  <span data-component="{parent}-field-error">...</span>
</div>
```

**Skeleton:** Label skeleton + Input skeleton, stacked
**Mount Animation:** `fadeInUp` 300ms ease-out (staggered per field)

---

### Card

**Category:** Molecule
**data-component:** `{parent}-card`

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| variant | `'elevated'` \| `'outlined'` \| `'filled'` | `'elevated'` | Card style |
| padding | `'sm'` \| `'md'` \| `'lg'` | `'md'` | Internal padding |
| hoverable | `boolean` | `false` | Show hover effect |

**Styles:**
- Background: `--color-bg-card`
- Border-radius: `--radius-md`
- Elevated: `--shadow-md`, hover: `--shadow-lg`
- Outlined: `1px solid --color-neutral-200`
- Filled: bg `--color-neutral-50`
- Padding: 16px (sm), 24px (md), 32px (lg)

**Skeleton:** Full card outline with content skeleton blocks
**Mount Animation:** `fadeInUp` 300ms ease-out

---

### MenuItem

**Category:** Molecule
**data-component:** `{parent}-menu-item`

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| icon | `string` | - | Leading icon |
| label | `string` | - | Item text |
| active | `boolean` | `false` | Active state |
| badge | `string` | - | Trailing badge text |

**Styles:**
- Padding: `12px 16px`
- Active: bg `--color-primary-50`, text `--color-primary-600`
- Hover: bg `--color-neutral-100`
- Border-radius: `--radius-md`

---

### StatDisplay

**Category:** Molecule
**data-component:** `{parent}-stat`

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| label | `string` | - | Stat label |
| value | `string` | - | Stat value |
| suffix | `string` | - | Value suffix (e.g., "+", "%") |
| description | `string` | - | Optional description |

**Styles:**
- Value: `--text-4xl`, `--font-bold`, `--color-primary-500`
- Label: `--text-sm`, `--color-neutral-600`
- Description: `--text-xs`, `--color-neutral-500`

**Skeleton:** Number skeleton + label skeleton
**Mount Animation:** `fadeInUp` 300ms ease-out with counter animation on value

---

### TestimonialCard

**Category:** Molecule
**data-component:** `{parent}-testimonial`

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| quote | `string` | - | Testimonial text |
| author | `string` | - | Author name |
| rating | `number` | `5` | Star rating (1-5) |
| date | `string` | - | Review date |

**Structure:**
```html
<div data-component="{parent}-testimonial">
  <div data-component="{parent}-testimonial-stars">...</div>
  <p data-component="{parent}-testimonial-quote">...</p>
  <div data-component="{parent}-testimonial-author">...</div>
</div>
```

**Skeleton:** Stars skeleton + text block skeleton + author skeleton
**Mount Animation:** `fadeInUp` 300ms ease-out

---

## 4. Organisms

### NavigationBar

**Category:** Organism
**data-component:** `nav`

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| transparent | `boolean` | `false` | Transparent background (hero overlay) |

**Structure:**
```html
<nav data-component="nav">
  <div data-component="nav-container">
    <a data-component="nav-logo">...</a>
    <ul data-component="nav-links">
      <li data-component="nav-links-item">...</li>
    </ul>
    <button data-component="nav-cta">상담 신청</button>
    <button data-component="nav-mobile-toggle">...</button>
  </div>
</nav>
```

**Desktop:** Logo left, links center, CTA button right
**Mobile:** Logo left, hamburger right, slide-down menu on toggle

**Styles:**
- Background: `--color-neutral-0` (or transparent)
- Height: 72px (desktop), 60px (mobile)
- Shadow: `--shadow-sm` (when scrolled)
- Links: `--text-base`, `--font-medium`, `--color-neutral-700`
- Active link: `--color-primary-500`, underline indicator

**Mount Animation:** `fadeIn` 300ms ease-out
**Scroll behavior:** Sticky top, adds shadow on scroll

---

### Footer

**Category:** Organism
**data-component:** `footer`

**Structure:**
```html
<footer data-component="footer">
  <div data-component="footer-container">
    <div data-component="footer-brand">
      <span data-component="footer-brand-logo">...</span>
      <p data-component="footer-brand-description">...</p>
    </div>
    <div data-component="footer-links">...</div>
    <div data-component="footer-contact">...</div>
    <div data-component="footer-social">...</div>
  </div>
  <div data-component="footer-bottom">
    <p data-component="footer-bottom-copyright">...</p>
  </div>
</footer>
```

**Styles:**
- Background: `--color-neutral-800`
- Text: `--color-neutral-300`
- Link hover: `--color-primary-300`
- Padding: `64px 0` (main), `24px 0` (bottom)
- Grid: 4 columns (desktop), stacked (mobile)

---

### Modal / Dialog

**Category:** Organism
**data-component:** `modal`

**Props:**

| Prop | Type | Default | Description |
|------|------|---------|-------------|
| size | `'sm'` \| `'md'` \| `'lg'` | `'md'` | Modal width |
| open | `boolean` | `false` | Visibility state |

**Sizes:** sm: 400px, md: 520px, lg: 640px

**Structure:**
```html
<div data-component="modal-overlay">
  <div data-component="modal">
    <div data-component="modal-header">
      <h3 data-component="modal-header-title">...</h3>
      <button data-component="modal-header-close">...</button>
    </div>
    <div data-component="modal-body">...</div>
    <div data-component="modal-footer">...</div>
  </div>
</div>
```

**Styles:**
- Overlay: `--color-bg-overlay`
- Background: `--color-neutral-0`
- Border-radius: `--radius-lg`
- Shadow: `--shadow-xl`
- Padding: `24px`

**Mount Animation:** Overlay `fadeIn` 200ms, Dialog `fadeInScale` 300ms ease-out
**Accessibility:** `role="dialog"`, `aria-modal="true"`, focus trap, ESC to close

---

### HeroSection

**Category:** Organism
**data-component:** `hero`

**Structure:**
```html
<section data-component="hero">
  <div data-component="hero-content">
    <span data-component="hero-content-badge">...</span>
    <h1 data-component="hero-content-title">...</h1>
    <p data-component="hero-content-description">...</p>
    <div data-component="hero-content-actions">
      <button data-component="hero-content-actions-primary">...</button>
      <button data-component="hero-content-actions-secondary">...</button>
    </div>
  </div>
  <div data-component="hero-visual">...</div>
</section>
```

**Styles:**
- Background: Gradient from `--color-bg-secondary` to `--color-bg-cream`
- Min-height: 600px (desktop), 500px (mobile)
- Title: `--text-5xl` (desktop), `--text-3xl` (mobile)
- Layout: Two columns (desktop), stacked (mobile)

**Mount Animation:** Content `fadeInUp` staggered, Visual `fadeIn` 500ms

---

### PricingTable

**Category:** Organism
**data-component:** `pricing`

**Structure:**
```html
<section data-component="pricing">
  <div data-component="pricing-header">...</div>
  <div data-component="pricing-grid">
    <div data-component="pricing-grid-card">
      <div data-component="pricing-grid-card-header">...</div>
      <div data-component="pricing-grid-card-price">...</div>
      <ul data-component="pricing-grid-card-features">...</ul>
      <button data-component="pricing-grid-card-cta">...</button>
    </div>
  </div>
</section>
```

**Styles:**
- Grid: 3 columns (desktop), stacked (mobile)
- Featured card: `--shadow-lg`, `2px solid --color-primary-400`, scale(1.02)
- Card padding: `32px`

**Mount Animation:** `fadeInUp` staggered per card (100ms delay between each)

---

### TestimonialGrid

**Category:** Organism
**data-component:** `testimonials`

**Structure:**
```html
<section data-component="testimonials">
  <div data-component="testimonials-header">...</div>
  <div data-component="testimonials-grid">
    <div data-component="testimonials-grid-item">
      <!-- Molecule: TestimonialCard -->
    </div>
  </div>
</section>
```

**Styles:**
- Grid: 3 columns (desktop), 2 columns (tablet), 1 column (mobile)
- Gap: `24px`

**Mount Animation:** `fadeInUp` staggered per card

---

### ContactForm

**Category:** Organism
**data-component:** `contact-form`

**Structure:**
```html
<form data-component="contact-form">
  <div data-component="contact-form-grid">
    <!-- Molecule: FormField (name) -->
    <!-- Molecule: FormField (phone) -->
    <!-- Molecule: FormField (email) -->
    <!-- Molecule: FormField (message - textarea) -->
  </div>
  <div data-component="contact-form-actions">
    <!-- Atom: Button (submit) -->
  </div>
</form>
```

**Skeleton:** Stacked form field skeletons + button skeleton
**Mount Animation:** `fadeInUp` staggered per field

---

## 5. Page Layout Convention

### Container

- Max-width: 1200px
- Padding: `0 24px` (desktop), `0 16px` (mobile)
- Margin: `0 auto`

### Section Spacing

- Section padding: `80px 0` (desktop), `48px 0` (mobile)
- Heading to content: `48px` (desktop), `32px` (mobile)

### Grid System

Based on CSS Grid with responsive breakpoints:
- Mobile (< 768px): 1 column
- Tablet (768px - 1023px): 2 columns
- Desktop (>= 1024px): 3-4 columns
- Gap: `24px`

---

## 6. Responsive Strategy

| Breakpoint | Name | Layout | Nav | Typography Scale |
|------------|------|--------|-----|-----------------|
| < 480px | Mobile (sm) | Single column | Hamburger | 0.85x |
| 480-767px | Mobile (md) | Single column | Hamburger | 0.9x |
| 768-1023px | Tablet | 2 columns | Hamburger | 0.95x |
| >= 1024px | Desktop | Multi-column | Full nav | 1x |
| >= 1280px | Wide | Multi-column | Full nav | 1x |

---

## 7. Accessibility Requirements (WCAG 2.1 AA)

1. **Color contrast:** All text meets 4.5:1 ratio (normal) / 3:1 (large text)
2. **Focus indicators:** Visible 2px outline in `--color-primary-400`
3. **Keyboard navigation:** All interactive elements reachable via Tab
4. **ARIA labels:** All icons and interactive elements have labels
5. **Skip navigation:** Skip-to-content link for keyboard users
6. **Semantic HTML:** Proper heading hierarchy, landmark regions
7. **Reduced motion:** `@media (prefers-reduced-motion: reduce)` disables animations
