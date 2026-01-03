# UI Design Language Analyzer v1.0

레퍼런스 웹사이트를 분석하여 UI Design Language 문서를 생성하는 가이드입니다.

---

## 1. 개요

### 목적

레퍼런스 웹사이트의 디자인 요소를 분석하여:
- Color System
- Typography
- Spacing System
- Component Patterns
- Tailwind CSS 설정

을 추출하고 문서화합니다.

### 트리거

- "이 사이트 디자인으로 만들어줘" + URL
- "디자인 분석해줘" + URL
- "UI 레퍼런스 분석" + URL
- "디자인 언어 추출" + URL
- "이 느낌으로 만들어줘" + URL

---

## 2. 분석 프로세스

### Step 1: 사이트 접근

```
1. web_fetch로 URL 접근
2. HTML/CSS 구조 파악
3. 주요 페이지 스크린샷 (가능한 경우)
```

### Step 2: 디자인 토큰 추출

**추출 항목:**
- Primary/Secondary/Accent 색상
- Background/Surface 색상
- Text 색상 (Primary/Secondary/Muted)
- Border 색상
- 폰트 패밀리
- 폰트 크기 스케일
- 폰트 굵기
- 라인 높이
- Spacing 단위
- Border radius
- Shadow 스타일

### Step 3: 컴포넌트 패턴 식별

**분석 대상:**
- Button 스타일
- Input/Form 스타일
- Card 스타일
- Navigation 스타일
- Modal/Dialog 스타일

### Step 4: 문서 생성

Output 파일들:
1. `ui-design-language.md` - 디자인 시스템 문서
2. `tailwind.config.ts` - Tailwind 설정
3. `globals.css` - CSS 변수

---

## 3. Color System 분석

### 3.1 색상 추출 방법

**CSS에서 추출:**
```css
/* 주로 사용되는 색상 패턴 */
--color-primary: #...;
--color-background: #...;
--text-primary: #...;
```

**시각적 분석:**
- 헤더/푸터 배경색
- 버튼 색상 (Primary CTA)
- 링크 색상
- 텍스트 색상
- 배경색

### 3.2 Output 형식

```typescript
// Design Language Document
const colors = {
  primary: {
    50: '#eff6ff',
    100: '#dbeafe',
    500: '#3b82f6',  // Main
    600: '#2563eb',  // Hover
    700: '#1d4ed8',  // Active
  },
  background: {
    default: '#ffffff',
    subtle: '#f9fafb',
    muted: '#f3f4f6',
  },
  text: {
    primary: '#111827',
    secondary: '#6b7280',
    muted: '#9ca3af',
  },
  border: {
    default: '#e5e7eb',
    focus: '#3b82f6',
  },
};
```

---

## 4. Typography 분석

### 4.1 폰트 추출

```typescript
const typography = {
  fontFamily: {
    sans: ['Inter', 'Pretendard', 'sans-serif'],
    mono: ['JetBrains Mono', 'monospace'],
  },
  fontSize: {
    xs: '0.75rem',    // 12px
    sm: '0.875rem',   // 14px
    base: '1rem',     // 16px
    lg: '1.125rem',   // 18px
    xl: '1.25rem',    // 20px
    '2xl': '1.5rem',  // 24px
    '3xl': '1.875rem', // 30px
    '4xl': '2.25rem', // 36px
  },
  fontWeight: {
    normal: '400',
    medium: '500',
    semibold: '600',
    bold: '700',
  },
  lineHeight: {
    tight: '1.25',
    normal: '1.5',
    relaxed: '1.75',
  },
};
```

### 4.2 Heading Scale

```typescript
const headings = {
  h1: { fontSize: '2.25rem', fontWeight: '700', lineHeight: '1.25' },
  h2: { fontSize: '1.875rem', fontWeight: '700', lineHeight: '1.3' },
  h3: { fontSize: '1.5rem', fontWeight: '600', lineHeight: '1.4' },
  h4: { fontSize: '1.25rem', fontWeight: '600', lineHeight: '1.4' },
  h5: { fontSize: '1.125rem', fontWeight: '600', lineHeight: '1.5' },
  h6: { fontSize: '1rem', fontWeight: '600', lineHeight: '1.5' },
};
```

---

## 5. Spacing System 분석

### 5.1 Spacing Scale

```typescript
const spacing = {
  px: '1px',
  0.5: '0.125rem', // 2px
  1: '0.25rem',    // 4px
  2: '0.5rem',     // 8px
  3: '0.75rem',    // 12px
  4: '1rem',       // 16px
  5: '1.25rem',    // 20px
  6: '1.5rem',     // 24px
  8: '2rem',       // 32px
  10: '2.5rem',    // 40px
  12: '3rem',      // 48px
  16: '4rem',      // 64px
};
```

### 5.2 Container Width

```typescript
const container = {
  sm: '640px',
  md: '768px',
  lg: '1024px',
  xl: '1280px',
  '2xl': '1536px',
};
```

---

## 6. Component Patterns

### 6.1 Button Patterns

```typescript
const buttonPatterns = {
  primary: {
    base: 'bg-primary-500 text-white',
    hover: 'hover:bg-primary-600',
    focus: 'focus:ring-2 focus:ring-primary-500 focus:ring-offset-2',
    disabled: 'disabled:opacity-50 disabled:cursor-not-allowed',
  },
  secondary: {
    base: 'bg-gray-100 text-gray-900',
    hover: 'hover:bg-gray-200',
    focus: 'focus:ring-2 focus:ring-gray-500 focus:ring-offset-2',
  },
  outline: {
    base: 'border border-gray-300 bg-transparent',
    hover: 'hover:bg-gray-50',
    focus: 'focus:ring-2 focus:ring-primary-500',
  },
  sizes: {
    sm: 'h-8 px-3 text-sm rounded-md',
    md: 'h-10 px-4 text-sm rounded-lg',
    lg: 'h-12 px-6 text-base rounded-lg',
  },
};
```

### 6.2 Input Patterns

```typescript
const inputPatterns = {
  base: 'w-full border rounded-lg px-3 py-2 text-sm',
  default: 'border-gray-300 focus:border-primary-500 focus:ring-1 focus:ring-primary-500',
  error: 'border-red-500 focus:border-red-500 focus:ring-1 focus:ring-red-500',
  disabled: 'bg-gray-50 text-gray-500 cursor-not-allowed',
};
```

### 6.3 Card Patterns

```typescript
const cardPatterns = {
  base: 'rounded-xl bg-white overflow-hidden',
  bordered: 'border border-gray-200',
  shadow: {
    sm: 'shadow-sm',
    md: 'shadow-md',
    lg: 'shadow-lg',
  },
  padding: {
    sm: 'p-4',
    md: 'p-6',
    lg: 'p-8',
  },
};
```

---

## 7. Output Templates

### 7.1 Tailwind Config 생성

→ 참조: `ui-design/tailwind-template.md`

### 7.2 Design Language Document

→ 참조: `ui-design/output-template.md`

### 7.3 Component Code Snippets

→ 참조: `ui-design/component-patterns.md`

---

## 8. 분석 예시

### 입력

```
사용자: "https://stripe.com 디자인으로 만들어줘"
```

### 분석 과정

```markdown
## Stripe.com 디자인 분석

### Color System
- Primary: #635bff (Stripe Purple)
- Background: #f6f9fc (Light gray-blue)
- Text Primary: #0a2540 (Dark navy)
- Text Secondary: #425466

### Typography
- Font: Inter, -apple-system, system-ui
- Heading: Bold, tight line-height
- Body: Regular, 16px base

### Characteristics
- Clean, minimal design
- Generous whitespace
- Subtle gradients
- Smooth animations
- Professional, trustworthy feel
```

### Output

```typescript
// tailwind.config.ts (Stripe-inspired)
const config: Config = {
  theme: {
    extend: {
      colors: {
        primary: {
          500: '#635bff',
          600: '#5851db',
        },
        background: {
          DEFAULT: '#f6f9fc',
          dark: '#0a2540',
        },
        text: {
          primary: '#0a2540',
          secondary: '#425466',
        },
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'system-ui', 'sans-serif'],
      },
    },
  },
};
```

---

## 9. 주의사항

### 저작권

- 색상 조합과 레이아웃 패턴만 참고
- 로고, 아이콘, 이미지는 사용 금지
- 정확한 픽셀 복제는 피할 것

### 접근성

- 추출된 색상의 대비 비율 확인
- WCAG 2.1 AA 기준 충족 여부 검증
- 필요시 색상 조정

### 라이선스

- 웹폰트 라이선스 확인
- 오픈소스 대안 폰트 제안

---

*v1.0 | 2025-01-02 | UI Design Language Analyzer*
