# Component System Guide

## 기술 스택

| 라이브러리 | 용도 |
|-----------|------|
| Tailwind CSS | 유틸리티 기반 스타일링 |
| CVA (class-variance-authority) | 컴포넌트 Variant 관리 |
| Framer Motion | 애니메이션 & 트랜지션 |
| Lucide React | 아이콘 |

## Design Tokens (Tailwind Config)

```typescript
// tailwind.config.ts
const config = {
  theme: {
    extend: {
      // Colors (Semantic)
      colors: {
        primary: {
          50: '#eff6ff',
          100: '#dbeafe',
          500: '#3b82f6',  // Default
          600: '#2563eb',
          700: '#1d4ed8',
        },
        success: {
          light: '#d1fae5',
          DEFAULT: '#10b981',
          dark: '#059669',
        },
        warning: {
          light: '#fef3c7',
          DEFAULT: '#f59e0b',
          dark: '#d97706',
        },
        error: {
          light: '#fee2e2',
          DEFAULT: '#ef4444',
          dark: '#dc2626',
        },
        gray: {
          50: '#f9fafb',
          100: '#f3f4f6',
          200: '#e5e7eb',
          300: '#d1d5db',
          400: '#9ca3af',
          500: '#6b7280',
          600: '#4b5563',
          700: '#374151',
          800: '#1f2937',
          900: '#111827',
        },
      },
      // Typography
      fontSize: {
        xs: ['0.75rem', { lineHeight: '1rem' }],
        sm: ['0.875rem', { lineHeight: '1.25rem' }],
        base: ['1rem', { lineHeight: '1.5rem' }],
        lg: ['1.125rem', { lineHeight: '1.75rem' }],
        xl: ['1.25rem', { lineHeight: '1.75rem' }],
        '2xl': ['1.5rem', { lineHeight: '2rem' }],
        '3xl': ['1.875rem', { lineHeight: '2.25rem' }],
        '4xl': ['2.25rem', { lineHeight: '2.5rem' }],
      },
      // Border Radius
      borderRadius: {
        sm: '0.25rem',
        DEFAULT: '0.5rem',
        md: '0.5rem',
        lg: '0.75rem',
        xl: '1rem',
      },
      // Animation
      transitionDuration: {
        fast: '150ms',
        normal: '200ms',
        slow: '300ms',
      },
    },
  },
};
```

## Atomic Design 구조

```
shared/components/
├── atoms/              # 최소 단위
│   ├── Button/
│   ├── Text/
│   ├── Input/
│   ├── Icon/
│   ├── Badge/
│   ├── Avatar/
│   └── Spinner/
├── molecules/          # Atom 조합
│   ├── InputField/     # Label + Input + Error
│   ├── IconButton/
│   ├── SearchBar/
│   └── Toast/
├── organisms/          # Molecule 조합
│   ├── Header/
│   ├── Modal/
│   ├── Dropdown/
│   └── DataTable/
└── templates/          # 페이지 레이아웃
    ├── MainLayout/
    └── AuthLayout/
```

## Base Props Interface

```typescript
// shared/types/component.types.ts

// 모든 컴포넌트 공통
export interface BaseProps {
  className?: string;
  testId?: string;  // Playwright 테스트용
}

// 스타일 Props
export type Size = 'xs' | 'sm' | 'md' | 'lg' | 'xl';
export type Color = 'primary' | 'secondary' | 'success' | 'warning' | 'error' | 'gray';
export type Radius = 'none' | 'sm' | 'md' | 'lg' | 'xl' | 'full';

// 애니메이션 Props
export interface AnimationProps {
  animate?: boolean;
  animationDuration?: 'fast' | 'normal' | 'slow';
}
```

## Atom: Button

```typescript
// atoms/Button/Button.tsx
'use client';

import { forwardRef, ButtonHTMLAttributes } from 'react';
import { motion } from 'framer-motion';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/shared/lib/utils';
import { Spinner } from '../Spinner';

const buttonVariants = cva(
  'inline-flex items-center justify-center font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50',
  {
    variants: {
      variant: {
        primary: 'bg-primary-500 text-white hover:bg-primary-600 focus-visible:ring-primary-500',
        secondary: 'bg-gray-100 text-gray-900 hover:bg-gray-200',
        outline: 'border border-gray-300 bg-transparent hover:bg-gray-50',
        ghost: 'bg-transparent hover:bg-gray-100',
        danger: 'bg-error text-white hover:bg-error-dark',
        success: 'bg-success text-white hover:bg-success-dark',
      },
      size: {
        xs: 'h-7 px-2 text-xs rounded-sm',
        sm: 'h-8 px-3 text-sm rounded',
        md: 'h-10 px-4 text-sm rounded-md',
        lg: 'h-12 px-6 text-base rounded-lg',
        xl: 'h-14 px-8 text-lg rounded-xl',
      },
      fullWidth: {
        true: 'w-full',
        false: '',
      },
    },
    defaultVariants: {
      variant: 'primary',
      size: 'md',
      fullWidth: false,
    },
  }
);

export interface ButtonProps
  extends ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  loading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  animate?: boolean;
  testId?: string;
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, fullWidth, loading, disabled, leftIcon, rightIcon, animate = true, testId, children, ...props }, ref) => {
    const isDisabled = disabled || loading;
    const content = (
      <>
        {loading && <Spinner size="sm" className="mr-2" />}
        {!loading && leftIcon && <span className="mr-2">{leftIcon}</span>}
        {children}
        {!loading && rightIcon && <span className="ml-2">{rightIcon}</span>}
      </>
    );

    if (animate && !isDisabled) {
      return (
        <motion.button
          ref={ref}
          className={cn(buttonVariants({ variant, size, fullWidth }), className)}
          disabled={isDisabled}
          data-testid={testId}
          whileTap={{ scale: 0.98 }}
          whileHover={{ scale: 1.02 }}
          transition={{ duration: 0.15 }}
          {...props}
        >
          {content}
        </motion.button>
      );
    }

    return (
      <button
        ref={ref}
        className={cn(buttonVariants({ variant, size, fullWidth }), className)}
        disabled={isDisabled}
        data-testid={testId}
        {...props}
      >
        {content}
      </button>
    );
  }
);
```

## Atom: Text

```typescript
// atoms/Text/Text.tsx
import { forwardRef, HTMLAttributes, ElementType } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/shared/lib/utils';

const textVariants = cva('', {
  variants: {
    variant: {
      h1: 'text-4xl font-bold',
      h2: 'text-3xl font-bold',
      h3: 'text-2xl font-semibold',
      h4: 'text-xl font-semibold',
      h5: 'text-lg font-medium',
      body1: 'text-base',
      body2: 'text-sm',
      caption: 'text-xs',
    },
    color: {
      primary: 'text-primary-500',
      secondary: 'text-gray-600',
      success: 'text-success',
      warning: 'text-warning',
      error: 'text-error',
      muted: 'text-gray-400',
      inherit: 'text-inherit',
    },
    weight: {
      normal: 'font-normal',
      medium: 'font-medium',
      semibold: 'font-semibold',
      bold: 'font-bold',
    },
    align: {
      left: 'text-left',
      center: 'text-center',
      right: 'text-right',
    },
  },
  defaultVariants: {
    variant: 'body1',
    color: 'inherit',
    align: 'left',
  },
});

const variantElementMap: Record<string, ElementType> = {
  h1: 'h1', h2: 'h2', h3: 'h3', h4: 'h4', h5: 'h5',
  body1: 'p', body2: 'p', caption: 'span',
};

export interface TextProps
  extends Omit<HTMLAttributes<HTMLElement>, 'color'>,
    VariantProps<typeof textVariants> {
  as?: ElementType;
  maxLines?: number;
  testId?: string;
}

export const Text = forwardRef<HTMLElement, TextProps>(
  ({ className, variant = 'body1', color, weight, align, as, maxLines, testId, style, children, ...props }, ref) => {
    const Component = as || variantElementMap[variant] || 'span';
    const lineClampStyle = maxLines ? {
      display: '-webkit-box',
      WebkitLineClamp: maxLines,
      WebkitBoxOrient: 'vertical' as const,
      overflow: 'hidden',
    } : {};

    return (
      <Component
        ref={ref}
        className={cn(textVariants({ variant, color, weight, align }), className)}
        data-testid={testId}
        style={{ ...lineClampStyle, ...style }}
        {...props}
      >
        {children}
      </Component>
    );
  }
);
```

## Atom: Input

```typescript
// atoms/Input/Input.tsx
'use client';

import { forwardRef, InputHTMLAttributes } from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/shared/lib/utils';

const inputVariants = cva(
  'w-full border bg-white transition-colors placeholder:text-gray-400 focus:outline-none focus:ring-2 disabled:cursor-not-allowed disabled:opacity-50',
  {
    variants: {
      size: {
        sm: 'h-8 px-3 text-sm rounded',
        md: 'h-10 px-4 text-sm rounded-md',
        lg: 'h-12 px-4 text-base rounded-lg',
      },
      variant: {
        default: 'border-gray-300 focus:border-primary-500 focus:ring-primary-500/20',
        error: 'border-error focus:border-error focus:ring-error/20',
        success: 'border-success focus:border-success focus:ring-success/20',
      },
    },
    defaultVariants: {
      size: 'md',
      variant: 'default',
    },
  }
);

export interface InputProps
  extends Omit<InputHTMLAttributes<HTMLInputElement>, 'size'>,
    VariantProps<typeof inputVariants> {
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
  testId?: string;
}

export const Input = forwardRef<HTMLInputElement, InputProps>(
  ({ className, size, variant, leftIcon, rightIcon, testId, ...props }, ref) => {
    if (leftIcon || rightIcon) {
      return (
        <div className="relative">
          {leftIcon && <span className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400">{leftIcon}</span>}
          <input
            ref={ref}
            className={cn(inputVariants({ size, variant }), leftIcon && 'pl-10', rightIcon && 'pr-10', className)}
            data-testid={testId}
            {...props}
          />
          {rightIcon && <span className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400">{rightIcon}</span>}
        </div>
      );
    }
    return <input ref={ref} className={cn(inputVariants({ size, variant }), className)} data-testid={testId} {...props} />;
  }
);
```

## Molecule: InputField

```typescript
// molecules/InputField/InputField.tsx
'use client';

import { forwardRef, useId } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Input, InputProps } from '../../atoms/Input';
import { Text } from '../../atoms/Text';
import { cn } from '@/shared/lib/utils';

export interface InputFieldProps extends InputProps {
  label?: string;
  error?: string;
  hint?: string;
  required?: boolean;
}

export const InputField = forwardRef<HTMLInputElement, InputFieldProps>(
  ({ label, error, hint, required, className, id, ...props }, ref) => {
    const generatedId = useId();
    const inputId = id || generatedId;

    return (
      <div className={cn('flex flex-col gap-1.5', className)}>
        {label && (
          <label htmlFor={inputId} className="flex items-center gap-1">
            <Text variant="body2" weight="medium">{label}</Text>
            {required && <Text color="error">*</Text>}
          </label>
        )}
        <Input
          ref={ref}
          id={inputId}
          variant={error ? 'error' : 'default'}
          aria-invalid={!!error}
          {...props}
        />
        <AnimatePresence mode="wait">
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -4 }}
            >
              <Text variant="caption" color="error">{error}</Text>
            </motion.div>
          )}
          {!error && hint && (
            <Text variant="caption" color="muted">{hint}</Text>
          )}
        </AnimatePresence>
      </div>
    );
  }
);
```

## Organism: Modal

```typescript
// organisms/Modal/Modal.tsx
'use client';

import { Fragment, ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { cva, type VariantProps } from 'class-variance-authority';
import { X } from 'lucide-react';
import { Button } from '../../atoms/Button';
import { Text } from '../../atoms/Text';
import { cn } from '@/shared/lib/utils';

const modalVariants = cva('relative bg-white shadow-xl flex flex-col max-h-[90vh]', {
  variants: {
    size: {
      sm: 'w-full max-w-sm rounded-lg',
      md: 'w-full max-w-md rounded-xl',
      lg: 'w-full max-w-lg rounded-xl',
      xl: 'w-full max-w-2xl rounded-2xl',
    },
  },
  defaultVariants: { size: 'md' },
});

export interface ModalProps extends VariantProps<typeof modalVariants> {
  isOpen: boolean;
  onClose: () => void;
  title?: string;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
}

export function Modal({ isOpen, onClose, title, size, children, footer, testId }: ModalProps) {
  return (
    <AnimatePresence>
      {isOpen && (
        <Fragment>
          <motion.div
            className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
            <motion.div
              className={cn(modalVariants({ size }))}
              initial={{ opacity: 0, scale: 0.95, y: 20 }}
              animate={{ opacity: 1, scale: 1, y: 0 }}
              exit={{ opacity: 0, scale: 0.95, y: 20 }}
              data-testid={testId}
            >
              {title && (
                <div className="flex items-center justify-between p-6 pb-0">
                  <Text variant="h4">{title}</Text>
                  <Button variant="ghost" size="sm" onClick={onClose}>
                    <X className="h-4 w-4" />
                  </Button>
                </div>
              )}
              <div className="flex-1 overflow-y-auto p-6">{children}</div>
              {footer && <div className="flex justify-end gap-3 border-t p-6">{footer}</div>}
            </motion.div>
          </div>
        </Fragment>
      )}
    </AnimatePresence>
  );
}
```

## Utils: cn 함수

```typescript
// shared/lib/utils.ts
import { type ClassValue, clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}
```

## 사용 예시

```typescript
// 사용 예시
<Button variant="primary" size="lg" loading={isSubmitting}>
  제출하기
</Button>

<Text variant="h2" color="primary" weight="bold">
  제목입니다
</Text>

<InputField
  label="이메일"
  placeholder="email@example.com"
  error={errors.email?.message}
  required
/>

<Modal isOpen={isOpen} onClose={onClose} title="확인" size="md">
  <p>정말 삭제하시겠습니까?</p>
</Modal>
```
