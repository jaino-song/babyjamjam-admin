# Simple Locale Management (Next.js Server Actions)

## Why This is Better

✅ **No API calls** - Direct server-side cookie manipulation  
✅ **No backend setup** - Pure Next.js solution  
✅ **No complex architecture** - Just one simple file  
✅ **Type-safe** - TypeScript enforced  
✅ **Secure** - HttpOnly cookies  

## Usage

### In Server Components

```typescript
import { getLocale } from '@/app/actions/locale';

export default async function Page() {
  const locale = await getLocale();
  
  return (
    <h1>{locale === 'ko' ? '안녕하세요' : 'Hello'}</h1>
  );
}
```

### In Client Components

```typescript
'use client';
import { setLocale } from '@/app/actions/locale';
import { useRouter } from 'next/navigation';

export const LanguageSwitcher = () => {
  const router = useRouter();

  const handleChange = async (lang: 'ko' | 'en') => {
    await setLocale(lang);
    router.refresh(); // Reload server components with new locale
  };

  return (
    <>
      <button onClick={() => handleChange('ko')}>한국어</button>
      <button onClick={() => handleChange('en')}>English</button>
    </>
  );
};
```

## That's It!

No domain layers, no repositories, no controllers, no modules. Just one file with two functions. 🎉

