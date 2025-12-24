# Figma to Tailwind Conversion Guide

Figma 디자인을 Tailwind CSS 코드로 변환하는 규칙.

## 변환 워크플로우

```
[1] Figma 노드 파싱 → [2] 레이아웃 분석 → [3] 스타일 매핑 → [4] 컴포넌트 생성 → [5] 후처리
```

---

## Phase 1: Figma 노드 타입 처리

### 노드 타입별 변환

| Figma Node Type | HTML Element | 비고 |
|-----------------|--------------|------|
| FRAME | `<div>` | Auto Layout 여부에 따라 flex 적용 |
| GROUP | `<div>` | 래퍼 역할만 |
| SECTION | `<section>` | 시맨틱 태그 |
| COMPONENT | `<div>` | 재사용 컴포넌트로 추출 |
| INSTANCE | `<div>` | 기존 컴포넌트 참조 |
| TEXT | `<p>`, `<span>`, `<h1-6>` | 컨텍스트에 따라 |
| RECTANGLE | `<div>` | 배경/테두리 박스 |
| ELLIPSE | `<div>` | `rounded-full` 적용 |
| LINE | `<hr>` 또는 `<div>` | border로 표현 |
| VECTOR | `<svg>` 또는 무시 | 복잡한 벡터는 SVG 추출 |
| IMAGE | `<img>` | placeholder 처리 |

### 노드 타입 판단 코드

```typescript
function getElementType(node: FigmaNode): string {
  // 텍스트 노드
  if (node.type === 'TEXT') {
    return getTextElement(node);
  }
  
  // 이미지 fill이 있는 경우
  if (hasImageFill(node)) {
    return 'img';
  }
  
  // 원형
  if (node.type === 'ELLIPSE') {
    return 'div'; // rounded-full 추가
  }
  
  // 시맨틱 섹션
  if (node.type === 'SECTION') {
    return 'section';
  }
  
  // 기본값
  return 'div';
}

function getTextElement(node: FigmaNode): string {
  const fontSize = node.style?.fontSize || 16;
  const fontWeight = node.style?.fontWeight || 400;
  
  // 큰 볼드 텍스트는 heading으로 추정
  if (fontSize >= 32 && fontWeight >= 700) return 'h1';
  if (fontSize >= 24 && fontWeight >= 600) return 'h2';
  if (fontSize >= 20 && fontWeight >= 600) return 'h3';
  if (fontSize >= 18 && fontWeight >= 500) return 'h4';
  
  // 짧은 텍스트는 span
  if (node.characters?.length < 50 && !node.characters?.includes('\n')) {
    return 'span';
  }
  
  return 'p';
}
```

---

## Phase 2: Auto Layout → Flexbox 변환

### 핵심 매핑 규칙

```typescript
interface AutoLayoutMapping {
  // Direction
  layoutMode: {
    'HORIZONTAL': 'flex-row',
    'VERTICAL': 'flex-col',
    'NONE': '' // absolute positioning
  };
  
  // Primary Axis (main axis)
  primaryAxisAlignItems: {
    'MIN': 'justify-start',
    'CENTER': 'justify-center',
    'MAX': 'justify-end',
    'SPACE_BETWEEN': 'justify-between',
  };
  
  // Counter Axis (cross axis)
  counterAxisAlignItems: {
    'MIN': 'items-start',
    'CENTER': 'items-center',
    'MAX': 'items-end',
    'BASELINE': 'items-baseline',
  };
  
  // Gap
  itemSpacing: (value: number) => `gap-${Math.round(value / 4)}`;
  
  // Padding
  paddingLeft/Right/Top/Bottom: (value: number) => 적절한 p-*, px-*, py-* 클래스;
}
```

### Auto Layout 변환 함수

```typescript
function convertAutoLayout(node: FigmaNode): string[] {
  const classes: string[] = [];
  
  // Auto Layout이 없으면 absolute
  if (node.layoutMode === 'NONE' || !node.layoutMode) {
    // 부모가 Auto Layout이 아니면 absolute
    if (!hasAutoLayoutParent(node)) {
      classes.push('absolute');
    }
    return classes;
  }
  
  // Flex 기본
  classes.push('flex');
  
  // Direction
  if (node.layoutMode === 'HORIZONTAL') {
    classes.push('flex-row');
  } else if (node.layoutMode === 'VERTICAL') {
    classes.push('flex-col');
  }
  
  // Primary Axis (justify)
  switch (node.primaryAxisAlignItems) {
    case 'MIN': classes.push('justify-start'); break;
    case 'CENTER': classes.push('justify-center'); break;
    case 'MAX': classes.push('justify-end'); break;
    case 'SPACE_BETWEEN': classes.push('justify-between'); break;
  }
  
  // Counter Axis (items)
  switch (node.counterAxisAlignItems) {
    case 'MIN': classes.push('items-start'); break;
    case 'CENTER': classes.push('items-center'); break;
    case 'MAX': classes.push('items-end'); break;
    case 'BASELINE': classes.push('items-baseline'); break;
  }
  
  // Gap
  if (node.itemSpacing && node.itemSpacing > 0) {
    classes.push(pxToTailwind(node.itemSpacing, 'gap'));
  }
  
  // Padding
  classes.push(...convertPadding(node));
  
  return classes;
}

function convertPadding(node: FigmaNode): string[] {
  const { paddingTop, paddingRight, paddingBottom, paddingLeft } = node;
  const classes: string[] = [];
  
  // 모두 같으면 p-*
  if (paddingTop === paddingRight && paddingRight === paddingBottom && paddingBottom === paddingLeft) {
    if (paddingTop > 0) {
      classes.push(pxToTailwind(paddingTop, 'p'));
    }
    return classes;
  }
  
  // 상하/좌우 같으면 px-*, py-*
  if (paddingTop === paddingBottom && paddingLeft === paddingRight) {
    if (paddingTop > 0) classes.push(pxToTailwind(paddingTop, 'py'));
    if (paddingLeft > 0) classes.push(pxToTailwind(paddingLeft, 'px'));
    return classes;
  }
  
  // 개별 적용
  if (paddingTop > 0) classes.push(pxToTailwind(paddingTop, 'pt'));
  if (paddingRight > 0) classes.push(pxToTailwind(paddingRight, 'pr'));
  if (paddingBottom > 0) classes.push(pxToTailwind(paddingBottom, 'pb'));
  if (paddingLeft > 0) classes.push(pxToTailwind(paddingLeft, 'pl'));
  
  return classes;
}
```

### ⚠️ 중요: Flex 적용 위치

**문제:** Text 노드에 직접 flex를 적용하면 동작하지 않음

**해결:** 부모 노드에 flex 적용, 자식 정렬

```typescript
// ❌ 잘못된 방식
<span class="flex justify-center">Text</span>

// ✅ 올바른 방식
<div class="flex justify-center">
  <span>Text</span>
</div>
```

---

## Phase 3: 스타일 변환

### 3.1 색상 매핑

```typescript
// Figma RGBA → Tailwind 토큰
const colorMap: Record<string, string> = {
  // Primary
  'rgba(59, 130, 246, 1)': 'primary-500',
  'rgba(37, 99, 235, 1)': 'primary-600',
  'rgba(29, 78, 216, 1)': 'primary-700',
  
  // Gray scale
  'rgba(249, 250, 251, 1)': 'gray-50',
  'rgba(243, 244, 246, 1)': 'gray-100',
  'rgba(229, 231, 235, 1)': 'gray-200',
  'rgba(209, 213, 219, 1)': 'gray-300',
  'rgba(156, 163, 175, 1)': 'gray-400',
  'rgba(107, 114, 128, 1)': 'gray-500',
  'rgba(75, 85, 99, 1)': 'gray-600',
  'rgba(55, 65, 81, 1)': 'gray-700',
  'rgba(31, 41, 55, 1)': 'gray-800',
  'rgba(17, 24, 39, 1)': 'gray-900',
  
  // Semantic
  'rgba(16, 185, 129, 1)': 'success',
  'rgba(239, 68, 68, 1)': 'error',
  'rgba(245, 158, 11, 1)': 'warning',
  
  // Common
  'rgba(255, 255, 255, 1)': 'white',
  'rgba(0, 0, 0, 1)': 'black',
};

function convertColor(rgba: RGBA, type: 'bg' | 'text' | 'border'): string {
  const key = `rgba(${rgba.r * 255}, ${rgba.g * 255}, ${rgba.b * 255}, ${rgba.a})`;
  
  // 정확히 매칭되는 토큰 찾기
  if (colorMap[key]) {
    return `${type}-${colorMap[key]}`;
  }
  
  // 가장 가까운 토큰 찾기
  const closest = findClosestColor(rgba);
  if (closest) {
    return `${type}-${closest}`;
  }
  
  // 매칭 안 되면 arbitrary value
  const hex = rgbaToHex(rgba);
  return `${type}-[${hex}]`;
}
```

### 3.2 타이포그래피 매핑

```typescript
const fontSizeMap: Record<number, string> = {
  10: 'text-[10px]',  // 없으면 arbitrary
  12: 'text-xs',
  14: 'text-sm',
  16: 'text-base',
  18: 'text-lg',
  20: 'text-xl',
  24: 'text-2xl',
  30: 'text-3xl',
  36: 'text-4xl',
  48: 'text-5xl',
  60: 'text-6xl',
};

const fontWeightMap: Record<number, string> = {
  100: 'font-thin',
  200: 'font-extralight',
  300: 'font-light',
  400: 'font-normal',
  500: 'font-medium',
  600: 'font-semibold',
  700: 'font-bold',
  800: 'font-extrabold',
  900: 'font-black',
};

const lineHeightMap: Record<string, string> = {
  'AUTO': '', // Tailwind 기본값 사용
  '1': 'leading-none',
  '1.25': 'leading-tight',
  '1.375': 'leading-snug',
  '1.5': 'leading-normal',
  '1.625': 'leading-relaxed',
  '2': 'leading-loose',
};

function convertTypography(style: TextStyle): string[] {
  const classes: string[] = [];
  
  // Font Size
  const fontSize = Math.round(style.fontSize);
  classes.push(fontSizeMap[fontSize] || `text-[${fontSize}px]`);
  
  // Font Weight
  const weight = style.fontWeight;
  classes.push(fontWeightMap[weight] || `font-[${weight}]`);
  
  // Line Height (fontSize 대비 비율로 판단)
  if (style.lineHeightPx && style.fontSize) {
    const ratio = style.lineHeightPx / style.fontSize;
    const ratioKey = ratio.toFixed(3);
    if (lineHeightMap[ratioKey]) {
      classes.push(lineHeightMap[ratioKey]);
    }
  }
  
  // Letter Spacing
  if (style.letterSpacing && style.letterSpacing !== 0) {
    const tracking = style.letterSpacing;
    if (tracking < 0) classes.push('tracking-tighter');
    else if (tracking > 0.1) classes.push('tracking-wider');
  }
  
  return classes;
}
```

### 3.3 그림자 매핑

```typescript
function convertShadow(effects: Effect[]): string[] {
  const classes: string[] = [];
  
  for (const effect of effects) {
    if (effect.type !== 'DROP_SHADOW' || !effect.visible) continue;
    
    const { offset, radius, color } = effect;
    const x = offset?.x || 0;
    const y = offset?.y || 0;
    const blur = radius || 0;
    
    // Tailwind 기본 shadow와 매칭 시도
    if (y === 1 && blur <= 3) {
      classes.push('shadow-sm');
    } else if (y <= 4 && blur <= 6) {
      classes.push('shadow');
    } else if (y <= 10 && blur <= 15) {
      classes.push('shadow-md');
    } else if (y <= 15 && blur <= 25) {
      classes.push('shadow-lg');
    } else if (y <= 25 && blur <= 50) {
      classes.push('shadow-xl');
    } else {
      classes.push('shadow-2xl');
    }
    
    break; // 첫 번째 shadow만 처리
  }
  
  return classes;
}
```

### 3.4 Border Radius 매핑

```typescript
const radiusMap: Record<number, string> = {
  0: 'rounded-none',
  2: 'rounded-sm',
  4: 'rounded',
  6: 'rounded-md',
  8: 'rounded-lg',
  12: 'rounded-xl',
  16: 'rounded-2xl',
  24: 'rounded-3xl',
  9999: 'rounded-full',
};

function convertBorderRadius(node: FigmaNode): string[] {
  const classes: string[] = [];
  
  // 모든 코너 같으면
  if (node.cornerRadius && typeof node.cornerRadius === 'number') {
    const radius = Math.round(node.cornerRadius);
    
    // 원형 판단 (너비/높이의 절반 이상이면 full)
    if (radius >= Math.min(node.width, node.height) / 2) {
      return ['rounded-full'];
    }
    
    return [radiusMap[radius] || `rounded-[${radius}px]`];
  }
  
  // 개별 코너
  const { topLeft, topRight, bottomRight, bottomLeft } = node.rectangleCornerRadii || {};
  
  if (topLeft) classes.push(`rounded-tl-[${topLeft}px]`);
  if (topRight) classes.push(`rounded-tr-[${topRight}px]`);
  if (bottomRight) classes.push(`rounded-br-[${bottomRight}px]`);
  if (bottomLeft) classes.push(`rounded-bl-[${bottomLeft}px]`);
  
  return classes;
}
```

### 3.5 크기 변환

```typescript
function convertSize(node: FigmaNode, parent: FigmaNode | null): string[] {
  const classes: string[] = [];
  
  // 부모 대비 100%이면 w-full
  if (parent && node.width === parent.width) {
    classes.push('w-full');
  } else if (node.layoutGrow === 1) {
    classes.push('flex-1');
  } else {
    classes.push(pxToTailwind(node.width, 'w'));
  }
  
  // 높이
  if (parent && node.height === parent.height) {
    classes.push('h-full');
  } else if (node.layoutGrow === 1) {
    // flex-1이면 h는 auto
  } else {
    classes.push(pxToTailwind(node.height, 'h'));
  }
  
  return classes;
}

// px → Tailwind spacing
function pxToTailwind(px: number, prefix: string): string {
  // Tailwind 기본 spacing (4px 단위)
  const spacingMap: Record<number, string> = {
    0: '0', 1: 'px', 2: '0.5', 4: '1', 6: '1.5', 8: '2',
    10: '2.5', 12: '3', 14: '3.5', 16: '4', 20: '5', 24: '6',
    28: '7', 32: '8', 36: '9', 40: '10', 44: '11', 48: '12',
    56: '14', 64: '16', 80: '20', 96: '24', 112: '28', 128: '32',
  };
  
  const rounded = Math.round(px);
  
  if (spacingMap[rounded] !== undefined) {
    return `${prefix}-${spacingMap[rounded]}`;
  }
  
  // 가장 가까운 값 찾기
  const closest = Object.keys(spacingMap)
    .map(Number)
    .reduce((prev, curr) => 
      Math.abs(curr - rounded) < Math.abs(prev - rounded) ? curr : prev
    );
  
  // 오차가 2px 이내면 가까운 값 사용
  if (Math.abs(closest - rounded) <= 2) {
    return `${prefix}-${spacingMap[closest]}`;
  }
  
  // 아니면 arbitrary value
  return `${prefix}-[${rounded}px]`;
}
```

---

## Phase 4: 컴포넌트 인식

### 기존 디자인 시스템 컴포넌트 매칭

```typescript
interface ComponentPattern {
  name: string;
  indicators: (node: FigmaNode) => boolean;
  convert: (node: FigmaNode) => string;
}

const componentPatterns: ComponentPattern[] = [
  {
    name: 'Button',
    indicators: (node) => {
      const name = node.name.toLowerCase();
      return (
        name.includes('button') || 
        name.includes('btn') || 
        name.includes('cta')
      ) && node.type === 'FRAME';
    },
    convert: (node) => {
      const variant = detectButtonVariant(node);
      const size = detectButtonSize(node);
      return `<Button variant="${variant}" size="${size}">${getTextContent(node)}</Button>`;
    },
  },
  {
    name: 'Input',
    indicators: (node) => {
      const name = node.name.toLowerCase();
      return (
        name.includes('input') || 
        name.includes('textfield') ||
        name.includes('field')
      );
    },
    convert: (node) => {
      const size = detectInputSize(node);
      return `<Input size="${size}" placeholder="${getTextContent(node)}" />`;
    },
  },
  {
    name: 'Card',
    indicators: (node) => {
      return (
        hasShadow(node) && 
        hasBorderRadius(node) && 
        hasPadding(node)
      );
    },
    convert: (node) => {
      return `<Card>{/* children */}</Card>`;
    },
  },
];

function detectButtonVariant(node: FigmaNode): string {
  const fills = node.fills || [];
  const stroke = node.strokes || [];
  
  // 배경이 primary 색상이면 primary
  if (fills.some(f => isPrimaryColor(f.color))) {
    return 'primary';
  }
  
  // 테두리만 있으면 outline
  if (fills.every(f => f.opacity === 0) && stroke.length > 0) {
    return 'outline';
  }
  
  // 배경이 투명이면 ghost
  if (fills.every(f => f.opacity === 0)) {
    return 'ghost';
  }
  
  return 'secondary';
}

function detectButtonSize(node: FigmaNode): string {
  const height = node.height;
  
  if (height <= 28) return 'xs';
  if (height <= 32) return 'sm';
  if (height <= 40) return 'md';
  if (height <= 48) return 'lg';
  return 'xl';
}
```

---

## Phase 5: 후처리

### 5.1 testId 자동 추가

```typescript
function generateTestId(node: FigmaNode, index?: number): string {
  let testId = node.name
    .toLowerCase()
    .replace(/\s+/g, '-')           // 공백 → 하이픈
    .replace(/[^a-z0-9-]/g, '')     // 특수문자 제거
    .replace(/-+/g, '-')            // 연속 하이픈 → 단일
    .replace(/^-|-$/g, '');         // 앞뒤 하이픈 제거
  
  // 중복 방지
  if (index !== undefined) {
    testId = `${testId}-${index}`;
  }
  
  return testId;
}

// 사용
<div data-testid={generateTestId(node)}>
```

### 5.2 반응형 처리

```typescript
function makeResponsive(classes: string[], node: FigmaNode): string[] {
  const result = [...classes];
  
  // 고정 너비 → 반응형 전환
  const widthClass = result.find(c => c.startsWith('w-[') || c.startsWith('w-'));
  
  if (widthClass) {
    // 모바일 프레임 크기 (375px 등)
    if (node.width >= 320 && node.width <= 430) {
      result.splice(result.indexOf(widthClass), 1, 'w-full');
    }
    
    // 데스크톱 컨테이너 (1200px+ )
    if (node.width >= 1200) {
      result.splice(result.indexOf(widthClass), 1, 'w-full', 'max-w-7xl', 'mx-auto');
    }
  }
  
  return result;
}
```

### 5.3 클래스 정리

```typescript
function cleanClasses(classes: string[]): string {
  // 중복 제거
  const unique = [...new Set(classes)];
  
  // 충돌 제거 (예: flex-row와 flex-col)
  const cleaned = removeConflicts(unique);
  
  // 정렬 (Tailwind 권장 순서)
  const sorted = sortTailwindClasses(cleaned);
  
  return sorted.join(' ');
}

function removeConflicts(classes: string[]): string[] {
  const conflicts: string[][] = [
    ['flex-row', 'flex-col'],
    ['justify-start', 'justify-center', 'justify-end', 'justify-between'],
    ['items-start', 'items-center', 'items-end', 'items-baseline'],
    ['static', 'relative', 'absolute', 'fixed'],
  ];
  
  let result = [...classes];
  
  for (const group of conflicts) {
    const found = result.filter(c => group.includes(c));
    if (found.length > 1) {
      // 마지막 것만 유지
      for (let i = 0; i < found.length - 1; i++) {
        result = result.filter(c => c !== found[i]);
      }
    }
  }
  
  return result;
}
```

---

## Known Limitations

### 지원하지 않는 기능

| 기능 | 처리 방식 |
|------|----------|
| **이미지** | `bg-gray-200` placeholder + 주석 |
| **커스텀 폰트** | system-ui 폴백 |
| **블러 효과** | 무시 |
| **블렌드 모드** | 무시 |
| **복잡한 벡터** | SVG 추출 또는 무시 |
| **마스크** | 무시 |
| **반응형** | 고정 너비 (수동 조정 필요) |
| **인터랙션** | 정적 렌더링만 |

### 수동 조정 필요한 케이스

```typescript
// 변환 시 주석으로 표시
/* 
  ⚠️ MANUAL_ADJUSTMENT_NEEDED
  - Image fill: Replace placeholder with actual image
  - Custom font: "Pretendard" not available, using fallback
  - Complex vector: Consider extracting as SVG
*/
```

---

## 통합: React 컴포넌트 생성

```typescript
function generateReactComponent(node: FigmaNode): string {
  const componentName = toPascalCase(node.name);
  const testId = generateTestId(node);
  
  return `
'use client';

import { motion } from 'framer-motion';

interface ${componentName}Props {
  className?: string;
}

export function ${componentName}({ className }: ${componentName}Props) {
  return (
    <div 
      className={\`${generateClasses(node)} \${className || ''}\`}
      data-testid="${testId}"
    >
      ${generateChildren(node)}
    </div>
  );
}
`;
}
```

---

## 변환 품질 체크리스트

```
□ Auto Layout이 올바르게 flex로 변환되었는가?
□ 색상이 디자인 토큰에 매핑되었는가?
□ 타이포그래피가 일관성 있게 변환되었는가?
□ 기존 컴포넌트와 매칭되었는가?
□ testId가 모든 인터랙티브 요소에 추가되었는가?
□ 불필요한 클래스가 정리되었는가?
□ 수동 조정 필요한 부분이 주석으로 표시되었는가?
```
