# 아가잼잼 관리자 (babyjamjam-admin)

Mobile-first admin dashboard for 아가잼잼 baby care service management.

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Framework | Next.js 16 (App Router) + React 19 |
| Language | TypeScript 5 (strict) |
| Styling | Tailwind CSS v4 + CSS Variables (HSL) |
| UI Library | shadcn/ui (New York style) + Radix UI |
| Design System | V3 custom atomic components (37+) |
| State | Zustand (5 stores) |
| Data Fetching | TanStack React Query v5 + Axios |
| Forms | Zod validation + custom form components |
| i18n | next-intl (ko/en) |
| Animation | Framer Motion v12 |
| Icons | Lucide React |
| Testing | Jest + Playwright |
| Package Manager | pnpm |

## Getting Started

```bash
pnpm install
pnpm dev
```

App runs at `http://localhost:3000`.

## Project Structure

```
src/
├── app/                    # Next.js App Router pages
│   ├── (auth)/             # Auth routes (login, register, reset-password, etc.)
│   ├── dashboard/          # Main dashboard
│   ├── clients/            # Client management
│   ├── contracts/          # Contract management
│   ├── employees/          # Employee management
│   ├── messages/           # Messaging system + templates
│   ├── chat/               # AI chat interface
│   ├── files/              # File management
│   ├── settings/           # App settings
│   ├── admin/              # Admin panel
│   └── api/                # API routes (edge functions)
├── components/
│   ├── ui/                 # shadcn/ui primitives (32+ components)
│   ├── auth/               # Auth-specific components
│   └── app/                # Feature components by domain
│       ├── v3/             # V3 Design System (37 atomic components)
│       ├── dashboard/
│       ├── clients/
│       ├── employees/
│       ├── messages/
│       ├── chat/
│       ├── eformsign/
│       └── root/           # Root layout components
├── features/               # Feature modules (API, types, hooks)
├── hooks/                  # Custom hooks (25+)
├── lib/                    # Utilities, auth, validations, i18n
├── stores/                 # Zustand state stores
├── providers/              # React context providers
├── services/               # API service layer
├── texts/                  # i18n JSON (en.json, ko.json)
└── mocks/                  # MSW mock handlers
```

## Design System (V3)

The V3 design system uses a navy + blue primary palette with HSL-based CSS variables defined in `globals.css`.

### Key Design Tokens

- **Primary**: `hsl(214, 100%, 34%)` — Navy blue
- **Radius**: `0.5rem` (components use `rounded-2xl` for 16px)
- **Font**: Pretendard (Korean-optimized variable font)
- **Shadows**: Custom `shadow-v3` elevation system

### V3 Component Categories

| Category | Components |
|----------|-----------|
| Layout | SplitLayout, ListPanel, DetailPanel, V3Sidebar, V3MobileHeader, V3MainContent |
| Data Display | StatsBar, StatMini, InfoCard, InfoRow, ActivityTimeline, StatusBadge |
| Input | Input, InputField, SearchBox, FilterChips, ExpandableSearch |
| Navigation | DetailTabs, DetailActions, QuickActions, FloatingQuickActions |
| Wizard | SteppedWizard, Stepper |
| Content | Block, CardHeader, PageSection, EmptyState, AnimatedSlotList, TeaserOverlay |

## Scripts

```bash
pnpm dev          # Start dev server
pnpm build        # Production build
pnpm start        # Start production server
pnpm lint         # Run ESLint
pnpm test         # Run Jest tests
```

## Figma Design

The UI is exported to Figma at 393x852 (iPhone 15 Pro) viewport in the **아가잼잼** Figma file, organized by atomic design methodology.
