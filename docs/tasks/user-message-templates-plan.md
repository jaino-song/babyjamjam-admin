# User-Created Message Templates - Implementation Plan

> **Status:** Planned  
> **Created:** 2026-01-17  
> **Branch:** TBD (create new branch for implementation)

## Overview

Allow users to create custom message templates with variable placeholders (e.g., `{{name}}`, `{{phone}}`). When generating a message, the system parses the template, dynamically renders input fields, and substitutes values.

### Key Decisions

| Decision | Choice |
|----------|--------|
| Variable Source | **Hybrid** (system data + custom options) |
| Template Editor UI | **Dedicated page** (`/my-templates/new`, `/my-templates/[id]/edit`) |
| Categories | **Skip for MVP** |
| Access Control | All users can create templates |
| Zustand Integration | Yes - share state with existing `form-store.ts` |

---

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────────┐
│                         USER FLOW                                │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  /my-templates                    /my-templates/new              │
│  ┌────────────────────┐          ┌────────────────────┐         │
│  │ Template List      │  ──────► │ Template Editor    │         │
│  │ - View all         │          │ - Name             │         │
│  │ - Edit/Delete      │          │ - Content          │         │
│  │ - [+ New Template] │          │ - Variables config │         │
│  └────────────────────┘          │ - Live preview     │         │
│           │                      └────────────────────┘         │
│           ▼                                                      │
│  /messages                                                       │
│  ┌────────────────────────────────────────────────────┐         │
│  │ Message Generator                                   │         │
│  │ - Preset templates (existing)                       │         │
│  │ - Custom templates (from /my-templates)             │         │
│  │ - Dynamic form based on selected template           │         │
│  └────────────────────────────────────────────────────┘         │
└─────────────────────────────────────────────────────────────────┘
```

---

## Data Model

### Prisma Schema

```prisma
model message_template {
  id          Int       @id @default(autoincrement())
  name        String                          // Template display name
  content     String    @db.Text              // Template with {{variable}} placeholders
  variables   Json                            // Variable definitions array
  is_active   Boolean   @default(true)        // Soft delete flag
  created_at  DateTime  @default(now()) @db.Timestamptz(6)
  updated_at  DateTime  @updatedAt @db.Timestamptz(6)
}
```

### Variable JSON Structure

```typescript
interface TemplateVariable {
  key: string;                    // Unique identifier, used in {{key}}
  type: 'text' | 'phone' | 'select' | 'date' | 'number' | 'textarea';
  label: string;                  // Display label in form
  placeholder?: string;           // Input placeholder
  required: boolean;              // Validation flag
  
  // For 'select' type only
  optionType?: 'custom' | 'dataSource';
  options?: string[];             // When optionType = 'custom'
  dataSource?: string;            // When optionType = 'dataSource'
  
  // For 'number' type only
  min?: number;
  max?: number;
}
```

### Example Variable Definition

```json
{
  "variables": [
    {
      "key": "name",
      "type": "text",
      "label": "고객명",
      "placeholder": "홍길동",
      "required": true
    },
    {
      "key": "area",
      "type": "select",
      "label": "지역",
      "required": true,
      "optionType": "dataSource",
      "dataSource": "areas"
    },
    {
      "key": "customerGrade",
      "type": "select",
      "label": "고객 등급",
      "required": false,
      "optionType": "custom",
      "options": ["VIP", "일반", "신규"]
    }
  ]
}
```

### Available Data Sources

| ID | Description | Source |
|----|-------------|--------|
| `areas` | 지역 목록 | `GET /bank-account-infos` → area field |
| `voucher-types` | 바우처 유형 | Static JSON (existing `voucher.json`) |
| `employees` | 직원 목록 | `GET /employees` → name field |

---

## File Structure

### New Files

```
backend/
├── domain/
│   ├── entities/
│   │   └── message-template.entity.ts           # NEW
│   └── repositories/
│       └── message-template.repository.interface.ts  # NEW
├── application/
│   ├── usecases/
│   │   └── message-template/                    # NEW
│   │       ├── index.ts
│   │       ├── create-message-template.usecase.ts
│   │       ├── update-message-template.usecase.ts
│   │       ├── delete-message-template.usecase.ts
│   │       ├── find-message-template-by-id.usecase.ts
│   │       └── list-message-templates.usecase.ts
│   └── services/
│       └── message-template.service.ts          # NEW
├── infrastructure/
│   └── database/
│       ├── mapper/
│       │   └── message-template.mapper.ts       # NEW
│       └── repositories/
│           └── sb.message-template.repository.ts # NEW
├── interface/
│   ├── controllers/
│   │   └── message-template.controller.ts       # NEW
│   └── dto/
│       └── message-template.dto.ts              # NEW
├── module/
│   └── message-template.module.ts               # NEW
└── prisma/
    └── schema.prisma                            # MODIFIED

frontend/
├── src/
│   ├── app/
│   │   ├── messages/
│   │   │   └── page.tsx                         # MODIFIED
│   │   ├── my-templates/                        # NEW
│   │   │   ├── page.tsx                         # List page
│   │   │   ├── new/
│   │   │   │   └── page.tsx                     # Create page
│   │   │   └── [id]/
│   │   │       └── edit/
│   │   │           └── page.tsx                 # Edit page
│   │   ├── (components)/
│   │   │   ├── messages/
│   │   │   │   └── forms/
│   │   │   │       ├── CustomTemplateForm.tsx   # NEW
│   │   │   │       └── form-components/
│   │   │   │           ├── DateInput.tsx        # NEW
│   │   │   │           ├── NumberInput.tsx      # NEW
│   │   │   │           ├── TextareaInput.tsx    # NEW
│   │   │   │           ├── DynamicSelect.tsx    # NEW
│   │   │   │           └── DynamicInput.tsx     # NEW
│   │   │   └── my-templates/                    # NEW
│   │   │       ├── TemplateList.tsx
│   │   │       ├── TemplateEditor.tsx
│   │   │       ├── VariableConfigurator.tsx
│   │   │       ├── VariableInserter.tsx
│   │   │       └── TemplatePreview.tsx
│   │   ├── store/
│   │   │   └── template-store.ts                # NEW
│   │   ├── hooks/
│   │   │   └── useMessageTemplates.ts           # NEW
│   │   └── lib/
│   │       └── template/
│   │           ├── variable-parser.ts           # NEW
│   │           ├── data-sources.ts              # NEW
│   │           └── types.ts                     # NEW
│   └── texts/
│       ├── ko.json                              # MODIFIED
│       └── en.json                              # MODIFIED
```

---

## API Endpoints

| Method | Endpoint | Description | Request Body |
|--------|----------|-------------|--------------|
| `POST` | `/message-templates` | Create template | `{ name, content, variables }` |
| `GET` | `/message-templates` | List all active | - |
| `GET` | `/message-templates/:id` | Get by ID | - |
| `PATCH` | `/message-templates/:id` | Update | `{ name?, content?, variables? }` |
| `DELETE` | `/message-templates/:id` | Soft delete | - |

---

## Implementation Tasks

### Phase 1: Backend Foundation

| # | Task | Files |
|---|------|-------|
| 1.1 | Add `message_template` model to Prisma schema | `prisma/schema.prisma` |
| 1.2 | Run migration | `npx prisma migrate dev` |
| 1.3 | Create entity class | `domain/entities/message-template.entity.ts` |
| 1.4 | Create repository interface | `domain/repositories/message-template.repository.interface.ts` |
| 1.5 | Create mapper | `infrastructure/database/mapper/message-template.mapper.ts` |
| 1.6 | Create repository implementation | `infrastructure/database/repositories/sb.message-template.repository.ts` |
| 1.7 | Create use cases (CRUD) | `application/usecases/message-template/*.ts` |
| 1.8 | Create service | `application/services/message-template.service.ts` |
| 1.9 | Create DTOs | `interface/dto/message-template.dto.ts` |
| 1.10 | Create controller | `interface/controllers/message-template.controller.ts` |
| 1.11 | Create module & register in app.module | `module/message-template.module.ts` |

### Phase 2: Frontend Foundation

| # | Task | Files |
|---|------|-------|
| 2.1 | Create TypeScript types | `lib/template/types.ts` |
| 2.2 | Create variable parser utility | `lib/template/variable-parser.ts` |
| 2.3 | Create data sources config | `lib/template/data-sources.ts` |
| 2.4 | Create template Zustand store | `store/template-store.ts` |
| 2.5 | Create API hooks | `hooks/useMessageTemplates.ts` |
| 2.6 | Add API route proxy | `app/api/message-templates/route.ts` |

### Phase 3: Frontend - Input Components

| # | Task | Files |
|---|------|-------|
| 3.1 | Create DateInput component | `form-components/DateInput.tsx` |
| 3.2 | Create NumberInput component | `form-components/NumberInput.tsx` |
| 3.3 | Create TextareaInput component | `form-components/TextareaInput.tsx` |
| 3.4 | Create DynamicSelect component | `form-components/DynamicSelect.tsx` |
| 3.5 | Create DynamicInput router | `form-components/DynamicInput.tsx` |
| 3.6 | Create CustomTemplateForm | `forms/CustomTemplateForm.tsx` |

### Phase 4: Frontend - My Templates Pages

| # | Task | Files |
|---|------|-------|
| 4.1 | Create TemplateList component | `(components)/my-templates/TemplateList.tsx` |
| 4.2 | Create TemplateEditor component | `(components)/my-templates/TemplateEditor.tsx` |
| 4.3 | Create VariableConfigurator component | `(components)/my-templates/VariableConfigurator.tsx` |
| 4.4 | Create VariableInserter component | `(components)/my-templates/VariableInserter.tsx` |
| 4.5 | Create TemplatePreview component | `(components)/my-templates/TemplatePreview.tsx` |
| 4.6 | Create list page | `my-templates/page.tsx` |
| 4.7 | Create new template page | `my-templates/new/page.tsx` |
| 4.8 | Create edit template page | `my-templates/[id]/edit/page.tsx` |

### Phase 5: Integration

| # | Task | Files |
|---|------|-------|
| 5.1 | Update messages page dropdown | `messages/page.tsx` |
| 5.2 | Update NavBar with My Templates link | `nav-bar/NavBar.tsx` |
| 5.3 | Add i18n translations | `texts/ko.json`, `texts/en.json` |

### Phase 6: Testing & Polish

| # | Task | Files |
|---|------|-------|
| 6.1 | Backend unit tests | `test/usecases/message-template/*.spec.ts` |
| 6.2 | Backend repository tests | `test/repositories/sb.message-template.repository.spec.ts` |
| 6.3 | Frontend E2E tests | `tests/my-templates.spec.ts` |

---

## Zustand Store Integration

Map standard variable keys to existing `form-store.ts` fields:

```typescript
const FORM_STORE_MAPPING = {
  // Client fields
  'name': 'name',
  'phone': 'phone', 
  'address': 'address',
  'birthday': 'birthday',
  
  // Employee fields
  'employeeName': 'employeeName',
  'employeePhone': 'employeePhone',
  'employee2Name': 'employee2Name',
  'employee2Phone': 'employee2Phone',
  
  // Contract fields
  'startDate': 'startDate',
  'endDate': 'endDate',
  'voucherType': 'voucherType',
  'voucherDuration': 'voucherDuration',
  'fullPrice': 'fullPrice',
  'grant': 'grant',
  'actualPrice': 'actualPrice',
  'area': 'area',
};
```

When generating a message:
1. For standard keys (in mapping): Use value from `form-store`
2. For custom keys: Use value from `template-store.variableValues`

---

## UI Wireframes

### My Templates List Page (`/my-templates`)

```
┌─────────────────────────────────────────────────────────────────┐
│  내 메시지 템플릿                              [+ 새 템플릿 만들기] │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 🔍 검색...                                                  ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 📄 VIP 고객 환영 메시지                                      ││
│  │    변수: 이름, 서비스유형, 시작일                            ││
│  │    수정일: 2026-01-15                                        ││
│  │                                        [수정] [삭제] [미리보기]││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 📄 가격 안내 v2                                              ││
│  │    변수: 이름, 지역, 바우처유형, 기간, 금액                   ││
│  │    수정일: 2026-01-10                                        ││
│  │                                        [수정] [삭제] [미리보기]││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Template Editor Page (`/my-templates/new`)

```
┌─────────────────────────────────────────────────────────────────┐
│  ← 뒤로    새 템플릿 만들기                          [저장] [취소] │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  템플릿 이름                                                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ VIP 고객 환영 메시지                                         ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ───────────────────────────────────────────────────────────────│
│                                                                  │
│  변수 빠른 삽입:                                                 │
│  [이름] [연락처] [주소] [시작일] [종료일] [지역] [+ 커스텀 변수]   │
│                                                                  │
│  템플릿 내용                                                     │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ [사회서비스 제공자 품질평가 A등급]                            ││
│  │                                                              ││
│  │ {{name}} 고객님 안녕하세요~♡                                 ││
│  │                                                              ││
│  │ {{area}} 지역 {{serviceType}} 서비스를 이용해 주셔서         ││
│  │ 진심으로 감사드립니다.                                       ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ───────────────────────────────────────────────────────────────│
│                                                                  │
│  변수 설정 (자동 감지됨: 3개)                                    │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ 1. name                                                      ││
│  │    타입: [텍스트 ▼]  라벨: [고객명        ]  필수: [✓]       ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │ 2. area                                                      ││
│  │    타입: [선택 ▼]    라벨: [지역          ]  필수: [✓]       ││
│  │    옵션: (•) 시스템 데이터 [지역 목록 ▼]                     ││
│  │          ( ) 직접 입력                                       ││
│  ├─────────────────────────────────────────────────────────────┤│
│  │ 3. serviceType                                               ││
│  │    타입: [선택 ▼]    라벨: [서비스 유형    ]  필수: [✓]       ││
│  │    옵션: (•) 시스템 데이터 [바우처 유형 ▼]                   ││
│  └─────────────────────────────────────────────────────────────┘│
│                                                                  │
│  ───────────────────────────────────────────────────────────────│
│                                                                  │
│  실시간 미리보기                                                 │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ [사회서비스 제공자 품질평가 A등급]                            ││
│  │                                                              ││
│  │ [고객명] 고객님 안녕하세요~♡                                 ││
│  │                                                              ││
│  │ [지역] 지역 [서비스 유형] 서비스를 이용해 주셔서             ││
│  │ 진심으로 감사드립니다.                                       ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

### Messages Page Dropdown (Updated)

```
┌─────────────────────────────────────────────────────────────────┐
│  메시지 유형 선택                                                │
│  ┌─────────────────────────────────────────────────────────────┐│
│  │ [인사 메시지                                              ▼] ││
│  │  ├─ 인사 메시지                        ← 기본 템플릿         ││
│  │  ├─ 서비스 안내                                              ││
│  │  ├─ 가격 안내                                                ││
│  │  ├─ 리마인더                                                 ││
│  │  ├─ 감사 메시지                                              ││
│  │  ├─ 설문 요청                                                ││
│  │  ├─ 안내 메시지                                              ││
│  │  ├─ ─────────────────────────                                ││
│  │  ├─ 📄 VIP 고객 환영 메시지            ← 내 템플릿            ││
│  │  ├─ 📄 가격 안내 v2                                          ││
│  │  └─ 📄 계약 완료 감사                                        ││
│  └─────────────────────────────────────────────────────────────┘│
└─────────────────────────────────────────────────────────────────┘
```

---

## Estimated Effort

| Phase | Effort |
|-------|--------|
| Backend Foundation | 4-6 hours |
| Frontend Foundation | 2-3 hours |
| Input Components | 2-3 hours |
| My Templates Pages | 4-5 hours |
| Integration | 1-2 hours |
| Testing | 2-3 hours |
| **Total** | **15-22 hours** |

---

## Future Enhancements (Post-MVP)

- [ ] Template categories for branch
- [ ] Template sharing between users
- [ ] Template versioning/history
- [ ] Import/export templates
- [ ] Template usage analytics
- [ ] Rich text editor for content
