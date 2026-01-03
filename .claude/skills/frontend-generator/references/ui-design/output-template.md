# UI Design Language Document Template

레퍼런스 분석 후 생성되는 디자인 시스템 문서 템플릿입니다.

---

## Template

```markdown
# UI Design Language: [프로젝트명]

> 레퍼런스: [URL 또는 Figma 링크]
> 생성일: [날짜]
> 버전: 1.0.0

---

## 1. Design Philosophy

### 컨셉
[프로젝트의 전반적인 디자인 철학 설명]

예시:
- Clean & Minimal: 불필요한 요소 최소화
- Professional: 신뢰감 있는 비즈니스 톤
- Modern: 최신 디자인 트렌드 반영

### 키워드
[디자인을 설명하는 3-5개의 키워드]

예시: Modern, Clean, Professional, Trustworthy, Friendly

---

## 2. Color System

### Primary Colors
| Name | Hex | Usage |
|------|-----|-------|
| primary-50 | #eff6ff | Backgrounds, Hover states |
| primary-100 | #dbeafe | Subtle backgrounds |
| primary-500 | #3b82f6 | Primary actions, Links |
| primary-600 | #2563eb | Hover state |
| primary-700 | #1d4ed8 | Active state |

### Neutral Colors
| Name | Hex | Usage |
|------|-----|-------|
| gray-50 | #f9fafb | Page background |
| gray-100 | #f3f4f6 | Card background |
| gray-200 | #e5e7eb | Borders |
| gray-400 | #9ca3af | Muted text |
| gray-600 | #4b5563 | Secondary text |
| gray-900 | #111827 | Primary text |

### Semantic Colors
| Name | Hex | Usage |
|------|-----|-------|
| success | #22c55e | Success messages |
| warning | #f59e0b | Warning messages |
| error | #ef4444 | Error messages |
| info | #3b82f6 | Information |

### Color CSS Variables
```css
:root {
  --color-primary-50: #eff6ff;
  --color-primary-500: #3b82f6;
  --color-primary-600: #2563eb;
  
  --color-background: #ffffff;
  --color-background-subtle: #f9fafb;
  
  --color-text-primary: #111827;
  --color-text-secondary: #4b5563;
  --color-text-muted: #9ca3af;
  
  --color-border: #e5e7eb;
}
```

---

## 3. Typography

### Font Family
```css
--font-sans: 'Inter', 'Pretendard', -apple-system, BlinkMacSystemFont, sans-serif;
--font-mono: 'JetBrains Mono', 'Fira Code', monospace;
```

### Type Scale
| Name | Size | Weight | Line Height | Usage |
|------|------|--------|-------------|-------|
| display | 48px | 700 | 1.1 | Hero headings |
| h1 | 36px | 700 | 1.2 | Page titles |
| h2 | 30px | 600 | 1.3 | Section titles |
| h3 | 24px | 600 | 1.4 | Subsections |
| h4 | 20px | 600 | 1.4 | Card titles |
| body-lg | 18px | 400 | 1.6 | Lead paragraphs |
| body | 16px | 400 | 1.5 | Body text |
| body-sm | 14px | 400 | 1.5 | Secondary text |
| caption | 12px | 500 | 1.4 | Labels, captions |

### Typography Classes
```css
.text-display { font-size: 3rem; font-weight: 700; line-height: 1.1; }
.text-h1 { font-size: 2.25rem; font-weight: 700; line-height: 1.2; }
.text-h2 { font-size: 1.875rem; font-weight: 600; line-height: 1.3; }
.text-h3 { font-size: 1.5rem; font-weight: 600; line-height: 1.4; }
.text-h4 { font-size: 1.25rem; font-weight: 600; line-height: 1.4; }
.text-body-lg { font-size: 1.125rem; line-height: 1.6; }
.text-body { font-size: 1rem; line-height: 1.5; }
.text-body-sm { font-size: 0.875rem; line-height: 1.5; }
.text-caption { font-size: 0.75rem; font-weight: 500; line-height: 1.4; }
```

---

## 4. Spacing System

### Base Unit
8px grid system

### Spacing Scale
| Token | Value | Tailwind |
|-------|-------|----------|
| space-1 | 4px | p-1, m-1 |
| space-2 | 8px | p-2, m-2 |
| space-3 | 12px | p-3, m-3 |
| space-4 | 16px | p-4, m-4 |
| space-5 | 20px | p-5, m-5 |
| space-6 | 24px | p-6, m-6 |
| space-8 | 32px | p-8, m-8 |
| space-10 | 40px | p-10, m-10 |
| space-12 | 48px | p-12, m-12 |
| space-16 | 64px | p-16, m-16 |

### Container Widths
| Name | Width | Usage |
|------|-------|-------|
| sm | 640px | Narrow content |
| md | 768px | Blog posts |
| lg | 1024px | Standard |
| xl | 1280px | Wide content |
| 2xl | 1536px | Full width |

---

## 5. Border & Radius

### Border Width
| Token | Value | Usage |
|-------|-------|-------|
| border | 1px | Default borders |
| border-2 | 2px | Emphasized borders |

### Border Radius
| Token | Value | Usage |
|-------|-------|-------|
| rounded-sm | 4px | Small elements |
| rounded | 6px | Default |
| rounded-md | 8px | Inputs, small cards |
| rounded-lg | 12px | Cards, buttons |
| rounded-xl | 16px | Large cards |
| rounded-2xl | 24px | Modals |
| rounded-full | 9999px | Circles, pills |

---

## 6. Shadows

### Shadow Scale
```css
--shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
--shadow: 0 1px 3px 0 rgb(0 0 0 / 0.1), 0 1px 2px -1px rgb(0 0 0 / 0.1);
--shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
--shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
--shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);
```

### Usage
| Shadow | Usage |
|--------|-------|
| shadow-sm | Subtle elevation |
| shadow | Default cards |
| shadow-md | Dropdowns, tooltips |
| shadow-lg | Modals, dialogs |
| shadow-xl | Popovers |

---

## 7. Animation & Transitions

### Duration
| Token | Value | Usage |
|-------|-------|-------|
| fast | 100ms | Micro interactions |
| normal | 200ms | Default transitions |
| slow | 300ms | Page transitions |

### Easing
```css
--ease-in: cubic-bezier(0.4, 0, 1, 1);
--ease-out: cubic-bezier(0, 0, 0.2, 1);
--ease-in-out: cubic-bezier(0.4, 0, 0.2, 1);
```

### Common Transitions
```css
.transition-default {
  transition-property: color, background-color, border-color, opacity, transform;
  transition-duration: 200ms;
  transition-timing-function: cubic-bezier(0.4, 0, 0.2, 1);
}
```

---

## 8. Breakpoints

| Name | Width | Usage |
|------|-------|-------|
| sm | 640px | Large phones |
| md | 768px | Tablets |
| lg | 1024px | Laptops |
| xl | 1280px | Desktops |
| 2xl | 1536px | Large screens |

### Mobile-first approach
```css
/* Base: Mobile */
.component { ... }

/* Tablet and up */
@media (min-width: 768px) { ... }

/* Desktop and up */
@media (min-width: 1024px) { ... }
```

---

## 9. Icon System

### Icon Sizes
| Size | Value | Usage |
|------|-------|-------|
| xs | 12px | Inline icons |
| sm | 16px | Small buttons |
| md | 20px | Default |
| lg | 24px | Large buttons |
| xl | 32px | Features |

### Icon Library
Primary: Lucide Icons (lucide-react)

---

## 10. Usage Examples

### Button
```tsx
<button className="
  inline-flex items-center justify-center
  h-10 px-4
  bg-primary-500 text-white
  rounded-lg font-medium
  hover:bg-primary-600
  focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2
  transition-colors
">
  Button Text
</button>
```

### Card
```tsx
<div className="
  rounded-xl bg-white
  border border-gray-200
  shadow-sm
  p-6
">
  <h3 className="text-lg font-semibold text-gray-900">
    Card Title
  </h3>
  <p className="mt-2 text-gray-600">
    Card content goes here.
  </p>
</div>
```

### Input
```tsx
<input
  type="text"
  className="
    w-full
    px-3 py-2
    border border-gray-300 rounded-lg
    text-sm
    placeholder:text-gray-400
    focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
  "
  placeholder="Enter text..."
/>
```

---

*Generated with UI Design Language Analyzer*
```

---

*v1.0 | 2025-01-02 | Output Template*
