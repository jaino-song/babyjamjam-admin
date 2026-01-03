# Component Patterns Library

디자인 시스템 기반 컴포넌트 코드 스니펫입니다.

---

## 1. Button Patterns

### Primary Button

```tsx
// Tailwind Classes
const primaryButton = `
  inline-flex items-center justify-center
  h-10 px-4
  bg-primary-500 text-white
  rounded-lg font-medium text-sm
  hover:bg-primary-600
  focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2
  disabled:opacity-50 disabled:cursor-not-allowed
  transition-colors
`;

// Component
<button className={primaryButton}>
  Primary Action
</button>
```

### Secondary Button

```tsx
const secondaryButton = `
  inline-flex items-center justify-center
  h-10 px-4
  bg-gray-100 text-gray-900
  rounded-lg font-medium text-sm
  hover:bg-gray-200
  focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2
  disabled:opacity-50 disabled:cursor-not-allowed
  transition-colors
`;
```

### Outline Button

```tsx
const outlineButton = `
  inline-flex items-center justify-center
  h-10 px-4
  border border-gray-300 bg-transparent text-gray-700
  rounded-lg font-medium text-sm
  hover:bg-gray-50
  focus:outline-none focus:ring-2 focus:ring-primary-500 focus:ring-offset-2
  disabled:opacity-50 disabled:cursor-not-allowed
  transition-colors
`;
```

### Ghost Button

```tsx
const ghostButton = `
  inline-flex items-center justify-center
  h-10 px-4
  text-gray-700
  rounded-lg font-medium text-sm
  hover:bg-gray-100
  focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2
  transition-colors
`;
```

### Icon Button

```tsx
const iconButton = `
  inline-flex items-center justify-center
  h-10 w-10
  rounded-lg
  text-gray-500
  hover:bg-gray-100 hover:text-gray-700
  focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2
  transition-colors
`;

// Usage
<button className={iconButton}>
  <XIcon className="h-5 w-5" />
</button>
```

### Button Sizes

```tsx
const sizes = {
  sm: 'h-8 px-3 text-sm',
  md: 'h-10 px-4 text-sm',
  lg: 'h-12 px-6 text-base',
};
```

---

## 2. Input Patterns

### Text Input

```tsx
const textInput = `
  w-full
  h-10 px-3
  border border-gray-300 rounded-lg
  text-sm text-gray-900
  placeholder:text-gray-400
  focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
  disabled:bg-gray-50 disabled:text-gray-500 disabled:cursor-not-allowed
  transition-colors
`;

// With Label
<div className="space-y-1.5">
  <label className="block text-sm font-medium text-gray-700">
    Label
  </label>
  <input type="text" className={textInput} placeholder="Placeholder" />
</div>
```

### Input with Error

```tsx
const inputError = `
  w-full
  h-10 px-3
  border border-red-500 rounded-lg
  text-sm text-gray-900
  focus:outline-none focus:ring-2 focus:ring-red-500 focus:border-transparent
`;

// With Error Message
<div className="space-y-1.5">
  <label className="block text-sm font-medium text-gray-700">Email</label>
  <input type="email" className={inputError} />
  <p className="text-sm text-red-600">Please enter a valid email</p>
</div>
```

### Input with Icon

```tsx
<div className="relative">
  <div className="absolute inset-y-0 left-0 pl-3 flex items-center pointer-events-none">
    <SearchIcon className="h-5 w-5 text-gray-400" />
  </div>
  <input
    type="text"
    className="w-full h-10 pl-10 pr-3 border border-gray-300 rounded-lg text-sm"
    placeholder="Search..."
  />
</div>
```

### Textarea

```tsx
const textarea = `
  w-full
  px-3 py-2
  border border-gray-300 rounded-lg
  text-sm text-gray-900
  placeholder:text-gray-400
  focus:outline-none focus:ring-2 focus:ring-primary-500 focus:border-transparent
  resize-none
`;

<textarea
  className={textarea}
  rows={4}
  placeholder="Enter your message..."
/>
```

---

## 3. Card Patterns

### Basic Card

```tsx
const card = `
  rounded-xl bg-white
  border border-gray-200
  shadow-sm
`;

<div className={card}>
  <div className="p-6">
    <h3 className="text-lg font-semibold text-gray-900">Card Title</h3>
    <p className="mt-2 text-gray-600">Card description goes here.</p>
  </div>
</div>
```

### Card with Header

```tsx
<div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
  <div className="px-6 py-4 border-b border-gray-200 bg-gray-50">
    <h3 className="text-lg font-semibold text-gray-900">Card Header</h3>
  </div>
  <div className="p-6">
    <p className="text-gray-600">Card content</p>
  </div>
</div>
```

### Card with Image

```tsx
<div className="rounded-xl bg-white border border-gray-200 shadow-sm overflow-hidden">
  <div className="aspect-video relative">
    <img src="..." alt="..." className="object-cover w-full h-full" />
  </div>
  <div className="p-4">
    <p className="text-xs text-gray-500">Category</p>
    <h3 className="mt-1 font-medium text-gray-900">Title</h3>
    <p className="mt-2 text-lg font-bold text-primary-600">$99.00</p>
  </div>
</div>
```

### Interactive Card

```tsx
<div className="
  rounded-xl bg-white
  border border-gray-200
  shadow-sm
  p-6
  cursor-pointer
  hover:border-primary-500 hover:shadow-md
  transition-all
">
  Content
</div>
```

---

## 4. Modal / Dialog

### Modal Container

```tsx
// Backdrop
<div className="fixed inset-0 z-50 bg-black/50 backdrop-blur-sm" />

// Modal
<div className="fixed inset-0 z-50 flex items-center justify-center p-4">
  <div className="w-full max-w-md rounded-2xl bg-white shadow-xl">
    {/* Header */}
    <div className="flex items-center justify-between px-6 py-4 border-b">
      <h2 className="text-lg font-semibold">Modal Title</h2>
      <button className="p-1 rounded-lg hover:bg-gray-100">
        <XIcon className="h-5 w-5" />
      </button>
    </div>
    
    {/* Content */}
    <div className="px-6 py-4">
      <p className="text-gray-600">Modal content goes here.</p>
    </div>
    
    {/* Footer */}
    <div className="flex justify-end gap-3 px-6 py-4 border-t bg-gray-50 rounded-b-2xl">
      <button className={secondaryButton}>Cancel</button>
      <button className={primaryButton}>Confirm</button>
    </div>
  </div>
</div>
```

---

## 5. Navigation Patterns

### Navbar

```tsx
<header className="sticky top-0 z-40 border-b bg-white">
  <nav className="container mx-auto h-16 flex items-center justify-between px-4">
    {/* Logo */}
    <a href="/" className="text-xl font-bold text-primary-600">
      Logo
    </a>
    
    {/* Desktop Nav */}
    <div className="hidden md:flex items-center gap-8">
      <a href="#" className="text-sm font-medium text-gray-600 hover:text-gray-900">
        Home
      </a>
      <a href="#" className="text-sm font-medium text-gray-600 hover:text-gray-900">
        Products
      </a>
      <a href="#" className="text-sm font-medium text-gray-600 hover:text-gray-900">
        About
      </a>
    </div>
    
    {/* Actions */}
    <div className="flex items-center gap-4">
      <button className={ghostButton}>Login</button>
      <button className={primaryButton}>Sign Up</button>
    </div>
  </nav>
</header>
```

### Sidebar

```tsx
<aside className="w-64 border-r bg-white h-screen">
  <div className="h-16 flex items-center px-6 border-b">
    <span className="text-lg font-bold">Dashboard</span>
  </div>
  
  <nav className="p-4 space-y-1">
    {/* Active Item */}
    <a href="#" className="
      flex items-center gap-3 px-3 py-2 rounded-lg
      bg-primary-50 text-primary-600 font-medium text-sm
    ">
      <HomeIcon className="h-5 w-5" />
      Home
    </a>
    
    {/* Inactive Item */}
    <a href="#" className="
      flex items-center gap-3 px-3 py-2 rounded-lg
      text-gray-600 hover:bg-gray-100 font-medium text-sm
    ">
      <UsersIcon className="h-5 w-5" />
      Users
    </a>
  </nav>
</aside>
```

### Breadcrumb

```tsx
<nav className="flex items-center gap-2 text-sm">
  <a href="/" className="text-gray-500 hover:text-gray-700">Home</a>
  <ChevronRightIcon className="h-4 w-4 text-gray-400" />
  <a href="/products" className="text-gray-500 hover:text-gray-700">Products</a>
  <ChevronRightIcon className="h-4 w-4 text-gray-400" />
  <span className="text-gray-900 font-medium">Product Name</span>
</nav>
```

---

## 6. Badge / Tag Patterns

### Status Badge

```tsx
const badges = {
  success: 'bg-green-50 text-green-700 ring-1 ring-green-600/20',
  warning: 'bg-yellow-50 text-yellow-700 ring-1 ring-yellow-600/20',
  error: 'bg-red-50 text-red-700 ring-1 ring-red-600/20',
  info: 'bg-blue-50 text-blue-700 ring-1 ring-blue-600/20',
};

<span className={`
  inline-flex items-center
  px-2 py-1
  rounded-full
  text-xs font-medium
  ${badges.success}
`}>
  Active
</span>
```

### Tag

```tsx
<span className="
  inline-flex items-center gap-1
  px-2.5 py-0.5
  rounded-full
  bg-gray-100 text-gray-700
  text-xs font-medium
">
  Tag Label
  <button className="hover:text-gray-900">
    <XIcon className="h-3 w-3" />
  </button>
</span>
```

---

## 7. Alert / Toast Patterns

### Alert

```tsx
const alerts = {
  info: 'bg-blue-50 text-blue-800 border-blue-200',
  success: 'bg-green-50 text-green-800 border-green-200',
  warning: 'bg-yellow-50 text-yellow-800 border-yellow-200',
  error: 'bg-red-50 text-red-800 border-red-200',
};

<div className={`
  p-4 rounded-lg border
  ${alerts.info}
`}>
  <div className="flex gap-3">
    <InfoIcon className="h-5 w-5 flex-shrink-0" />
    <div>
      <h4 className="font-medium">Alert Title</h4>
      <p className="mt-1 text-sm opacity-90">Alert message goes here.</p>
    </div>
  </div>
</div>
```

### Toast

```tsx
<div className="
  fixed bottom-4 right-4
  flex items-center gap-3
  px-4 py-3
  bg-gray-900 text-white
  rounded-lg shadow-lg
  max-w-sm
">
  <CheckCircleIcon className="h-5 w-5 text-green-400" />
  <p className="text-sm">Successfully saved!</p>
  <button className="ml-auto text-gray-400 hover:text-white">
    <XIcon className="h-4 w-4" />
  </button>
</div>
```

---

## 8. Table Pattern

```tsx
<div className="overflow-hidden rounded-lg border border-gray-200">
  <table className="min-w-full divide-y divide-gray-200">
    <thead className="bg-gray-50">
      <tr>
        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
          Name
        </th>
        <th className="px-6 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">
          Status
        </th>
        <th className="px-6 py-3 text-right text-xs font-medium text-gray-500 uppercase tracking-wider">
          Actions
        </th>
      </tr>
    </thead>
    <tbody className="bg-white divide-y divide-gray-200">
      <tr className="hover:bg-gray-50">
        <td className="px-6 py-4 whitespace-nowrap text-sm text-gray-900">
          John Doe
        </td>
        <td className="px-6 py-4 whitespace-nowrap">
          <span className={`px-2 py-1 rounded-full text-xs font-medium ${badges.success}`}>
            Active
          </span>
        </td>
        <td className="px-6 py-4 whitespace-nowrap text-right">
          <button className="text-primary-600 hover:text-primary-700 text-sm font-medium">
            Edit
          </button>
        </td>
      </tr>
    </tbody>
  </table>
</div>
```

---

## 9. Skeleton Loading

```tsx
// Base Skeleton
const skeleton = `
  animate-pulse
  rounded-md
  bg-gray-200
`;

// Usage
<div className="space-y-3">
  <div className={`${skeleton} h-4 w-3/4`} />
  <div className={`${skeleton} h-4 w-full`} />
  <div className={`${skeleton} h-4 w-5/6`} />
</div>

// Card Skeleton
<div className="rounded-xl border border-gray-200 p-4">
  <div className={`${skeleton} aspect-square w-full`} />
  <div className={`${skeleton} mt-4 h-4 w-3/4`} />
  <div className={`${skeleton} mt-2 h-6 w-1/2`} />
</div>
```

---

## 10. Empty State

```tsx
<div className="text-center py-12">
  <div className="mx-auto h-12 w-12 text-gray-400">
    <InboxIcon className="h-full w-full" />
  </div>
  <h3 className="mt-4 text-lg font-medium text-gray-900">
    No items found
  </h3>
  <p className="mt-2 text-sm text-gray-500">
    Get started by creating your first item.
  </p>
  <div className="mt-6">
    <button className={primaryButton}>
      <PlusIcon className="h-4 w-4 mr-2" />
      New Item
    </button>
  </div>
</div>
```

---

*v1.0 | 2025-01-02 | Component Patterns*
