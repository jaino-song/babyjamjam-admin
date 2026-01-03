# Figma Design Conversion Guide v1.0

Figma 디자인을 React/Tailwind 코드로 변환하는 가이드입니다.

---

## 1. Figma MCP 사용

### 1.1 디자인 정보 가져오기

Figma MCP를 통해 디자인 정보를 가져올 수 있습니다:

```
Available Figma Tools:
- get_design_context: 선택된 노드의 UI 코드 생성 컨텍스트
- get_screenshot: 선택된 노드의 스크린샷
- get_metadata: 노드 메타데이터 (구조, 위치, 크기)
- get_variable_defs: 디자인 변수 (색상, 폰트 등)
- get_code_connect_map: 코드베이스 컴포넌트 매핑
```

### 1.2 워크플로우

```
1. Figma 링크 또는 노드 ID 확인
2. get_metadata로 구조 파악
3. get_variable_defs로 디자인 토큰 추출
4. get_screenshot으로 시각적 참조
5. get_design_context로 코드 생성 컨텍스트
6. React/Tailwind 코드 생성
```

---

## 2. 디자인 토큰 변환

### 2.1 Color System

**Figma Variables → Tailwind Config:**

```typescript
// Figma에서 추출된 색상 변수
const figmaColors = {
  'primary/500': '#3B82F6',
  'primary/600': '#2563EB',
  'gray/100': '#F3F4F6',
  'gray/900': '#111827',
};

// tailwind.config.ts 변환
const config: Config = {
  theme: {
    extend: {
      colors: {
        primary: {
          500: '#3B82F6',
          600: '#2563EB',
        },
        gray: {
          100: '#F3F4F6',
          900: '#111827',
        },
      },
    },
  },
};
```

### 2.2 Typography

**Figma Text Styles → Tailwind:**

```typescript
// Figma 텍스트 스타일
const figmaTypography = {
  'heading/h1': { fontSize: 48, fontWeight: 700, lineHeight: 1.2 },
  'heading/h2': { fontSize: 36, fontWeight: 700, lineHeight: 1.3 },
  'body/regular': { fontSize: 16, fontWeight: 400, lineHeight: 1.5 },
};

// tailwind.config.ts
const config: Config = {
  theme: {
    extend: {
      fontSize: {
        h1: ['48px', { lineHeight: '1.2', fontWeight: '700' }],
        h2: ['36px', { lineHeight: '1.3', fontWeight: '700' }],
      },
    },
  },
};
```

### 2.3 Spacing & Sizing

**Figma Auto Layout → Tailwind:**

| Figma Gap | Tailwind Class |
|-----------|----------------|
| 4px | gap-1 |
| 8px | gap-2 |
| 12px | gap-3 |
| 16px | gap-4 |
| 24px | gap-6 |
| 32px | gap-8 |

### 2.4 Border Radius

| Figma Radius | Tailwind Class |
|--------------|----------------|
| 4px | rounded |
| 8px | rounded-lg |
| 12px | rounded-xl |
| 16px | rounded-2xl |
| 9999px (Full) | rounded-full |

---

## 3. 레이아웃 변환

### 3.1 Auto Layout → Flexbox

**Figma Auto Layout:**
```
Direction: Horizontal
Gap: 16px
Padding: 24px
Align: Center
```

**Tailwind 변환:**
```tsx
<div className="flex items-center gap-4 p-6">
  {children}
</div>
```

### 3.2 Frame → Container

**Figma Frame:**
```
Width: 1200px
Max Width: 100%
Horizontal Padding: 24px
```

**Tailwind 변환:**
```tsx
<div className="container mx-auto max-w-[1200px] px-6">
  {children}
</div>
```

### 3.3 Constraints → Responsive

**Figma Constraints:**
```
Left and Right (Stretch)
Top (Fixed)
```

**Tailwind 변환:**
```tsx
<div className="absolute inset-x-0 top-0">
  {children}
</div>
```

---

## 4. 컴포넌트 변환

### 4.1 Button Component

**Figma Component:**
```
Name: Button
Variants:
  - Size: sm, md, lg
  - Variant: primary, secondary, outline
  - State: default, hover, disabled
```

**React 변환:**
```tsx
// components/ui/Button/Button.tsx
import { cva, type VariantProps } from 'class-variance-authority';

const buttonVariants = cva(
  'inline-flex items-center justify-center font-medium transition-colors',
  {
    variants: {
      variant: {
        primary: 'bg-primary-500 text-white hover:bg-primary-600',
        secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
        outline: 'border border-gray-300 hover:bg-gray-50',
      },
      size: {
        sm: 'h-8 px-3 text-sm rounded-md',
        md: 'h-10 px-4 text-sm rounded-lg',
        lg: 'h-12 px-6 text-base rounded-lg',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
    },
  }
);
```

### 4.2 Card Component

**Figma Component:**
```
Name: Card
Children:
  - CardImage (optional)
  - CardHeader
    - Title
    - Subtitle (optional)
  - CardContent
  - CardFooter (optional)
Properties:
  - Shadow: sm, md, lg
  - Border: true/false
```

**React 변환:**
```tsx
// components/ui/Card/Card.tsx
interface CardProps {
  shadow?: 'sm' | 'md' | 'lg';
  bordered?: boolean;
  children: React.ReactNode;
}

export function Card({ shadow = 'sm', bordered = true, children }: CardProps) {
  return (
    <div
      className={cn(
        'rounded-xl bg-white overflow-hidden',
        bordered && 'border border-gray-200',
        {
          'shadow-sm': shadow === 'sm',
          'shadow-md': shadow === 'md',
          'shadow-lg': shadow === 'lg',
        }
      )}
    >
      {children}
    </div>
  );
}
```

### 4.3 Input Component

**Figma Component:**
```
Name: Input
Variants:
  - State: default, focus, error, disabled
Properties:
  - Label (optional)
  - Placeholder
  - Helper Text (optional)
  - Error Message (optional)
```

**React 변환:**
```tsx
// components/ui/Input/Input.tsx
interface InputProps extends React.InputHTMLAttributes<HTMLInputElement> {
  label?: string;
  error?: string;
  helperText?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ label, error, helperText, className, ...props }, ref) => {
    return (
      <div className="space-y-1.5">
        {label && (
          <label className="text-sm font-medium text-gray-700">
            {label}
          </label>
        )}
        <input
          ref={ref}
          className={cn(
            'w-full rounded-lg border px-3 py-2 text-sm',
            'focus:outline-none focus:ring-2 focus:ring-primary-500',
            error ? 'border-red-500' : 'border-gray-300',
            className
          )}
          {...props}
        />
        {error && <p className="text-sm text-red-500">{error}</p>}
        {helperText && !error && (
          <p className="text-sm text-gray-500">{helperText}</p>
        )}
      </div>
    );
  }
);
```

---

## 5. 아이콘 변환

### 5.1 Lucide Icons 매핑

Figma 아이콘을 Lucide Icons로 매핑:

| Figma Icon | Lucide Icon |
|------------|-------------|
| ic_home | Home |
| ic_search | Search |
| ic_user | User |
| ic_settings | Settings |
| ic_menu | Menu |
| ic_close | X |
| ic_arrow_right | ArrowRight |
| ic_check | Check |

```tsx
import { Home, Search, User, Settings } from 'lucide-react';

<Home className="h-5 w-5" />
```

### 5.2 Custom SVG Icons

Figma에서 SVG 복사 시:

```tsx
// components/icons/CustomIcon.tsx
export function CustomIcon({ className }: { className?: string }) {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      {/* SVG paths from Figma */}
    </svg>
  );
}
```

---

## 6. 반응형 변환

### 6.1 Breakpoints 매핑

| Figma Frame | Tailwind Breakpoint |
|-------------|---------------------|
| Mobile (375px) | 기본 (mobile-first) |
| Tablet (768px) | md: |
| Desktop (1024px) | lg: |
| Large Desktop (1440px) | xl: |

### 6.2 Responsive Layout

**Figma:**
- Mobile: 1 column
- Tablet: 2 columns
- Desktop: 4 columns

**Tailwind:**
```tsx
<div className="grid grid-cols-1 gap-4 md:grid-cols-2 lg:grid-cols-4">
  {items.map(item => <Card key={item.id} {...item} />)}
</div>
```

### 6.3 Hidden/Show

**Figma:**
- Mobile: Show hamburger menu
- Desktop: Show full navigation

**Tailwind:**
```tsx
{/* Mobile only */}
<button className="md:hidden">
  <Menu />
</button>

{/* Desktop only */}
<nav className="hidden md:flex">
  {links}
</nav>
```

---

## 7. 애니메이션 변환

### 7.1 Figma Interactions → Motion

**Figma Smart Animate:**
```
Trigger: On Click
Animation: Smart Animate
Duration: 200ms
Easing: Ease Out
```

**Motion 변환:**
```tsx
import { motion } from 'motion/react';

<motion.div
  initial={{ opacity: 0, y: 20 }}
  animate={{ opacity: 1, y: 0 }}
  transition={{ duration: 0.2, ease: 'easeOut' }}
>
  {content}
</motion.div>
```

### 7.2 Hover Effects

**Figma:**
```
On Hover:
  - Scale: 105%
  - Shadow: lg
```

**Tailwind + Motion:**
```tsx
<motion.div
  whileHover={{ scale: 1.05 }}
  className="transition-shadow hover:shadow-lg"
>
  {content}
</motion.div>
```

---

## 8. 이미지 처리

### 8.1 Aspect Ratio 유지

**Figma Frame:**
```
Width: Fill
Height: Fixed ratio (16:9)
Object Fit: Cover
```

**Next.js Image:**
```tsx
<div className="relative aspect-video">
  <Image
    src={imageUrl}
    alt={alt}
    fill
    className="object-cover"
  />
</div>
```

### 8.2 Placeholder

```tsx
<div className="relative aspect-square bg-gray-100">
  <Image
    src={imageUrl}
    alt={alt}
    fill
    placeholder="blur"
    blurDataURL={blurHash}
  />
</div>
```

---

## 9. 품질 체크리스트

### 디자인 일치도

- [ ] 색상이 디자인과 일치하는가?
- [ ] 폰트 크기/굵기가 일치하는가?
- [ ] 간격(padding/margin)이 일치하는가?
- [ ] 모서리 둥글기가 일치하는가?
- [ ] 그림자가 일치하는가?

### 반응형

- [ ] 모바일 레이아웃이 올바른가?
- [ ] 태블릿 레이아웃이 올바른가?
- [ ] 데스크톱 레이아웃이 올바른가?

### 인터랙션

- [ ] Hover 상태가 구현되었는가?
- [ ] Focus 상태가 구현되었는가?
- [ ] Active 상태가 구현되었는가?
- [ ] Disabled 상태가 구현되었는가?

### 접근성

- [ ] 색상 대비가 충분한가? (WCAG 2.1)
- [ ] 포커스 인디케이터가 보이는가?
- [ ] 스크린 리더 지원이 되는가?

---

*v1.0 | 2025-01-02 | Figma to React/Tailwind*
