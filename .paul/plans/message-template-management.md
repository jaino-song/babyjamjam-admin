# Message Template Management Feature

## Context

### Original Request
"I want to make a feature that creates message templates. In the message page, there are templates that take user inputs for dynamic templates. I want it to provide options to the user to choose a type in input like existing templates. Create a dedicated page for this."

### Interview Summary

**Key Discussions:**
- **Variable Definition**: Hybrid approach - auto-detect `{{variables}}` from template text with manual customization
- **Variable Syntax**: `{{변수명}}` (Handlebars/Mustache style)
- **Auto-Detection**: Real-time as user types (300ms debounce)
- **Customizable Properties**: Label, Input Type, Required/Optional
- **Validation**: Block save until all template variables have matching definitions
- **Input Types**: Text only for now (architecture extensible for dropdown, date, etc.)
- **Permissions**: Global (all users see all templates)
- **Migration**: Parallel system (existing 7 hardcoded templates remain as-is)
- **Preview**: None initially (architecture ready for future live preview)

**Research Findings:**
- Existing message system at `/frontend/src/app/messages/page.tsx` with 7 hardcoded template types
- Clean Architecture pattern established in backend (Entity → Repository → Use Cases → Service → Controller)
- `AreaTemplateEntity` provides reference implementation for template CRUD
- Zustand store (`form-store.ts`) manages form state across message forms
- Alimtalk uses `#{variable}` syntax - new system uses `{{variable}}` for distinction

---

## Work Objectives

### Core Objective
Enable users to create, manage, and use custom message templates with dynamic variables that are auto-detected from template text and rendered as input forms.

### Concrete Deliverables
- **Backend**: `MessageTemplate` entity with full CRUD API (`/message-templates`)
- **Frontend**: Template management page at `/messages/templates`
- **Frontend**: Template create/edit page with side-by-side layout
- **Frontend**: Integration with existing `/messages` page (combined dropdown)
- **Database**: New `message_template` table with JSON field for variable definitions

### Definition of Done
- [ ] Users can create templates with `{{variable}}` placeholders
- [ ] Variables are auto-detected in real-time as user types
- [ ] Users can customize variable label, type, and required status
- [ ] Save is blocked if template variables don't match definitions
- [ ] Templates appear in combined dropdown on `/messages` page
- [ ] Selecting user template generates dynamic form based on variable definitions
- [ ] Generated message correctly substitutes all variables

### Must Have
- Real-time variable detection with `{{변수명}}` syntax
- Variable customization (label, type, required)
- Validation blocking save on variable mismatch
- Combined dropdown integration on messages page
- Hard delete with confirmation dialog
- Pagination on template list

### Must NOT Have (Guardrails)
- DO NOT modify existing 7 hardcoded templates or their form components
- DO NOT add categories, tags, or search/filter functionality
- DO NOT implement live preview (leave architecture extensible)
- DO NOT add default values or placeholder text for variables
- DO NOT implement soft delete or restore functionality
- DO NOT create separate database tables for each variable type
- DO NOT use rich text editor (plain textarea only)

---

## Design Decisions (Clarifications)

| Question | Decision | Rationale |
|----------|----------|-----------|
| **Template names unique?** | NO | Users may want similar names; no business need for uniqueness |
| **Deleted template impact?** | None | Templates are for message generation only; no audit trail needed |
| **Content character limit?** | NO | Not SMS; just text templates for copy/paste |
| **Variable key restrictions?** | Allow Korean + alphanumeric + spaces | Match natural language usage |
| **Templates with no variables?** | YES, valid | Static announcement templates are useful |
| **Duplicate template feature?** | OUT OF SCOPE | Can be added later if needed |
| **Edit changing variables impact?** | None | Only affects future message generation |

### Variable Validation Rules (CRITICAL)

**Definition of "Mismatch":**
1. Variables found in template content (via `{{regex}}`) MUST have corresponding entries in variables array
2. Variables array MUST NOT contain keys that don't appear in template content

**Validation Location:**
- **Frontend**: Block save button when mismatch detected, show inline error
- **Backend**: Validate on create/update, return 400 Bad Request if mismatch exists

**Example:**
```
Template: "안녕하세요 {{고객명}}님, {{서비스일자}}에 방문합니다."
Variables: [{ key: "고객명", ... }, { key: "서비스일자", ... }]
→ VALID

Template: "안녕하세요 {{고객명}}님"
Variables: [{ key: "고객명", ... }, { key: "서비스일자", ... }]
→ INVALID (서비스일자 in array but not in template)

Template: "안녕하세요 {{고객명}}님, {{담당자}}입니다"
Variables: [{ key: "고객명", ... }]
→ INVALID (담당자 in template but not in array)
```

### Pagination Strategy

- **Type**: Offset-based pagination (simpler, sufficient for expected data size)
- **Default page size**: 10 items per page
- **Parameters**: `page` (1-indexed), `limit` (default 10, max 100)
- **Response format**: `{ data: T[], total: number, page: number, limit: number, totalPages: number }`

---

## Task Flow

```
1. Database Schema
       ↓
2. Backend Entity
       ↓
3. Backend Repository (Interface + Implementation)
       ↓
4. Backend Use Cases (CRUD)
       ↓
5. Backend Service
       ↓
6. Backend Controller + DTOs
       ↓
7. Frontend API Client ──────────────────┐
       ↓                                 │
8. Template List Page ←──────────────────┤
       ↓                                 │
9. Template Create/Edit Page             │
   (with variable detection)             │
       ↓                                 │
10. Messages Page Integration ←──────────┘
```

## Parallelization

| Group | Tasks | Reason |
|-------|-------|--------|
| A | 2, 3 | Entity and Repository interface are independent |
| B | 8, 9 | List and Create/Edit pages can be built in parallel after API client |

| Task | Depends On | Reason |
|------|------------|--------|
| 3 (Repository Impl) | 1 (Schema) | Needs Prisma model |
| 4 (Use Cases) | 2, 3 | Needs Entity and Repository |
| 5 (Service) | 4 | Orchestrates Use Cases |
| 6 (Controller) | 5 | Exposes Service via REST |
| 7 (API Client) | 6 | Needs API endpoints |
| 8, 9, 10 | 7 | Need API Client |

---

## TODOs

### Phase 0: Setup

- [ ] 0. Add `.paul/` to `.gitignore`

  **What to do**:
  - Add `.paul/` to the project's `.gitignore` file
  - This keeps planning documents local and out of version control
  - Delete the draft file: `.paul/drafts/message-template-management.md`

  **Parallelizable**: NO (do first)

  **Acceptance Criteria**:
  - [ ] `.paul/` added to `.gitignore`
  - [ ] Draft file deleted
  - [ ] Verify with `git check-ignore .paul/plans/` returns the path

---

### Phase 1: Database & Backend Core

- [ ] 1. Create Prisma Schema for MessageTemplate

  **What to do**:
  - Add `message_template` model to `prisma/schema.prisma`
  - Fields: `id` (UUID), `name` (String), `content` (String), `variables` (Json), `createdAt`, `updatedAt`
  - `variables` JSON structure: `[{ key: string, label: string, type: string, required: boolean }]`
  - Run `prisma migrate dev` to create migration

  **Must NOT do**:
  - DO NOT create separate tables for variables
  - DO NOT add category, description, or userId fields

  **Parallelizable**: NO (first task)

  **References**:
  - `backend/prisma/schema.prisma` - Existing schema patterns
  - `message_template.variables` JSON example:
    ```json
    [
      { "key": "고객명", "label": "고객 이름", "type": "text", "required": true },
      { "key": "서비스일자", "label": "서비스 일자", "type": "text", "required": false }
    ]
    ```

  **Acceptance Criteria**:
  - [ ] `message_template` table exists in database
  - [ ] Migration file created and applied
  - [ ] Prisma client regenerated

---

- [ ] 2. Create MessageTemplate Entity

  **What to do**:
  - Create `backend/domain/entities/message-template.entity.ts`
  - Define `TemplateVariable` interface INLINE in the same file (not separate file)
  - Define `MessageTemplateEntity` class with properties matching schema
  - Add factory method `create()` for new templates
  - Add factory method `reconstitute()` for loading from DB
  - Add `validateVariables()` method to check template content matches variables array

  **Must NOT do**:
  - DO NOT add business logic for variable parsing (that's frontend)
  - DO NOT create separate file for TemplateVariable (keep it simple)

  **Parallelizable**: YES (with task 3 interface)

  **References**:
  - `backend/domain/entities/area-template.entity.ts:1-50` - Entity pattern
  - `backend/domain/entities/message.entity.ts` - Simple entity example

  **Entity Structure**:
  ```typescript
  // Inline interface in same file
  export interface TemplateVariable {
    key: string;      // Variable name (e.g., "고객명")
    label: string;    // Display label (e.g., "고객 이름")
    type: string;     // Input type (e.g., "text")
    required: boolean;
  }

  export class MessageTemplateEntity {
    constructor(
      public readonly id: string,
      public readonly name: string,
      public readonly content: string,
      public readonly variables: TemplateVariable[],
      public readonly createdAt: Date,
      public readonly updatedAt: Date
    ) {}

    // Validates that content variables match variables array
    validateVariables(): { valid: boolean; errors: string[] } {
      const contentVars = this.extractVariablesFromContent();
      const definedKeys = new Set(this.variables.map(v => v.key));
      // ... validation logic
    }

    private extractVariablesFromContent(): string[] {
      const regex = /\{\{([^}]+)\}\}/g;
      const matches = [...this.content.matchAll(regex)];
      return [...new Set(matches.map(m => m[1].trim()))];
    }

    static create(...) { }
    static reconstitute(...) { }
  }
  ```

  **Acceptance Criteria**:
  - [ ] Entity class with all required properties
  - [ ] `TemplateVariable` interface defined inline
  - [ ] Factory methods implemented
  - [ ] `validateVariables()` method returns validation result

---

- [ ] 3. Create MessageTemplate Repository

  **What to do**:
  - Create `backend/domain/repositories/message-template.repository.interface.ts`
  - Define interface with methods: `save`, `findById`, `findAll` (with pagination), `delete`
  - Create `backend/infrastructure/database/repositories/sb.message-template.repository.ts`
  - Implement Prisma-based repository
  - Create `backend/infrastructure/database/mapper/message-template.mapper.ts`

  **Must NOT do**:
  - DO NOT add search or filter methods
  - DO NOT add soft delete logic

  **Parallelizable**: YES (interface with task 2, implementation after task 1)

  **References**:
  - `backend/domain/repositories/area-template.repository.interface.ts` - Interface pattern
  - `backend/infrastructure/database/repositories/sb.area-template.repository.ts` - Implementation
  - `backend/infrastructure/database/mapper/area-template.mapper.ts` - Mapper pattern

  **Repository Interface**:
  ```typescript
  export interface PaginatedResult<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }

  export interface MessageTemplateRepositoryInterface {
    save(entity: MessageTemplateEntity): Promise<MessageTemplateEntity>;
    findById(id: string): Promise<MessageTemplateEntity | null>;
    findAll(page: number, limit: number): Promise<PaginatedResult<MessageTemplateEntity>>;
    delete(id: string): Promise<void>;
  }
  ```

  **Mapper Pattern**:
  ```typescript
  // message-template.mapper.ts
  export class MessageTemplateMapper {
    static toDomain(row: PrismaMessageTemplate): MessageTemplateEntity {
      return MessageTemplateEntity.reconstitute(
        row.id,
        row.name,
        row.content,
        row.variables as TemplateVariable[], // Prisma Json → typed array
        row.createdAt,
        row.updatedAt
      );
    }

    static toPrismaCreate(entity: MessageTemplateEntity): Prisma.message_templateCreateInput {
      return {
        id: entity.id,
        name: entity.name,
        content: entity.content,
        variables: entity.variables as any, // typed array → Prisma Json
      };
    }

    static toPrismaUpdate(entity: MessageTemplateEntity): Prisma.message_templateUpdateInput {
      return {
        name: entity.name,
        content: entity.content,
        variables: entity.variables as any,
      };
    }
  }
  ```

  **Acceptance Criteria**:
  - [ ] Repository interface defined with pagination support
  - [ ] Prisma implementation complete
  - [ ] Mapper correctly transforms Entity ↔ Prisma model
  - [ ] JSON field properly cast to/from typed array

---

- [ ] 4. Create MessageTemplate Use Cases

  **What to do**:
  - Create `backend/application/usecases/message-template/` directory
  - `create-message-template.usecase.ts` - Create new template (with validation)
  - `update-message-template.usecase.ts` - Update existing template (with validation)
  - `delete-message-template.usecase.ts` - Hard delete template
  - `list-message-templates.usecase.ts` - List all with pagination
  - `get-message-template.usecase.ts` - Get single by ID

  **Must NOT do**:
  - DO NOT add search/filter use cases

  **Parallelizable**: NO (depends on 2, 3)

  **References**:
  - `backend/application/usecases/area-template/` - Use case patterns
  - `backend/application/usecases/area-template/create-area-template.usecase.ts`

  **Use Case Details**:
  ```typescript
  // create-message-template.usecase.ts
  @Injectable()
  export class CreateMessageTemplateUseCase {
    constructor(
      @Inject('MessageTemplateRepositoryInterface')
      private readonly repository: MessageTemplateRepositoryInterface,
    ) {}

    async execute(dto: CreateMessageTemplateDto): Promise<MessageTemplateEntity> {
      const entity = MessageTemplateEntity.create(
        dto.name,
        dto.content,
        dto.variables
      );

      // Backend validation - returns 400 if mismatch
      const validation = entity.validateVariables();
      if (!validation.valid) {
        throw new BadRequestException(validation.errors.join(', '));
      }

      return this.repository.save(entity);
    }
  }

  // list-message-templates.usecase.ts
  @Injectable()
  export class ListMessageTemplatesUseCase {
    async execute(page: number = 1, limit: number = 10): Promise<PaginatedResult<MessageTemplateEntity>> {
      // Enforce max limit
      const safeLimit = Math.min(limit, 100);
      return this.repository.findAll(page, safeLimit);
    }
  }
  ```

  **Acceptance Criteria**:
  - [ ] All 5 use cases implemented
  - [ ] Create/Update use cases validate variables before saving
  - [ ] List use case accepts pagination params (page, limit)
  - [ ] Proper error handling (400 for validation, 404 for not found)

---

- [ ] 5. Create MessageTemplate Service

  **What to do**:
  - Create `backend/application/services/message-template.service.ts`
  - Inject all use cases
  - Expose methods that delegate to appropriate use cases
  - Handle pagination parameters for list operation

  **Must NOT do**:
  - DO NOT add business logic beyond orchestration
  - DO NOT directly access repository (use cases do that)

  **Parallelizable**: NO (depends on 4)

  **References**:
  - `backend/application/services/area-template.service.ts` - Service pattern

  **Acceptance Criteria**:
  - [ ] Service class with all methods
  - [ ] Proper dependency injection
  - [ ] Pagination support for list

---

- [ ] 6. Create MessageTemplate Controller, DTOs & Module

  **What to do**:
  - Create `backend/application/dto/message-template/` directory
  - `create-message-template.dto.ts` - Request body for create
  - `update-message-template.dto.ts` - Request body for update
  - `message-template-response.dto.ts` - Response format
  - Create `backend/interface/controllers/message-template.controller.ts`
  - Endpoints: `POST /`, `GET /`, `GET /:id`, `PATCH /:id`, `DELETE /:id`
  - Create `backend/module/message-template.module.ts`
  - Register module in `backend/app.module.ts`

  **Must NOT do**:
  - DO NOT add query parameters for search/filter
  - DO NOT add authentication/authorization (global for now)

  **Parallelizable**: NO (depends on 5)

  **References**:
  - `backend/interface/controllers/area-template.controller.ts` - Controller pattern
  - `backend/application/dto/area-template/` - DTO patterns
  - `backend/module/` - Existing module patterns

  **Controller Endpoints**:
  ```typescript
  @Controller('message-templates')
  export class MessageTemplateController {
    @Post()
    async create(@Body() dto: CreateMessageTemplateDto) { }
    // Returns: 201 Created

    @Get()
    async list(@Query('page') page = 1, @Query('limit') limit = 10) { }
    // Returns: 200 OK with PaginatedResult

    @Get(':id')
    async findOne(@Param('id') id: string) { }
    // Returns: 200 OK or 404 Not Found

    @Patch(':id')
    async update(@Param('id') id: string, @Body() dto: UpdateMessageTemplateDto) { }
    // Returns: 200 OK, 400 Bad Request (validation), or 404 Not Found

    @Delete(':id')
    async delete(@Param('id') id: string) { }
    // Returns: 204 No Content or 404 Not Found
  }
  ```

  **Module Structure**:
  ```typescript
  // backend/module/message-template.module.ts
  @Module({
    providers: [
      // Repository
      {
        provide: 'MessageTemplateRepositoryInterface',
        useClass: SbMessageTemplateRepository,
      },
      // Use Cases
      CreateMessageTemplateUseCase,
      UpdateMessageTemplateUseCase,
      DeleteMessageTemplateUseCase,
      ListMessageTemplatesUseCase,
      GetMessageTemplateUseCase,
      // Service
      MessageTemplateService,
    ],
    controllers: [MessageTemplateController],
    exports: [MessageTemplateService],
  })
  export class MessageTemplateModule {}

  // Add to app.module.ts imports array
  ```

  **Acceptance Criteria**:
  - [ ] All DTOs with class-validator decorators
  - [ ] Controller with all 5 endpoints
  - [ ] Proper HTTP status codes (201, 200, 204, 400, 404)
  - [ ] Module created with all providers registered
  - [ ] Module imported in app.module.ts

---

### Phase 2: Frontend Implementation

- [ ] 7. Create Frontend API Client

  **What to do**:
  - Check `frontend/next.config.ts` for existing API proxy rewrites
  - If proxy exists: API calls to `/api/message-templates` auto-forward to backend
  - If NO proxy: Create Next.js API routes:
    - `frontend/src/app/api/message-templates/route.ts` (GET list, POST create)
    - `frontend/src/app/api/message-templates/[id]/route.ts` (GET one, PATCH, DELETE)
  - Create `frontend/src/features/message-templates/api/message-template.api.ts`
  - Define TypeScript types matching backend DTOs
  - Create API functions: `createTemplate`, `updateTemplate`, `deleteTemplate`, `listTemplates`, `getTemplate`
  - Create `frontend/src/features/message-templates/hooks/use-message-templates.ts`
  - TanStack Query hooks: `useMessageTemplates`, `useMessageTemplate`, `useCreateTemplate`, `useUpdateTemplate`, `useDeleteTemplate`

  **Must NOT do**:
  - DO NOT call backend URL directly from client (use proxy or API routes)

  **Parallelizable**: NO (depends on 6)

  **References**:
  - `frontend/src/features/employees/hooks/use-employees.ts` - Hook patterns
  - `frontend/next.config.ts` - Check for existing API proxy rewrites
  - `frontend/src/app/api/` - Check for existing API route patterns

  **TypeScript Types**:
  ```typescript
  // types.ts
  export interface TemplateVariable {
    key: string;
    label: string;
    type: string;
    required: boolean;
  }

  export interface MessageTemplate {
    id: string;
    name: string;
    content: string;
    variables: TemplateVariable[];
    createdAt: string;
    updatedAt: string;
  }

  export interface PaginatedTemplates {
    data: MessageTemplate[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
  }

  export interface CreateTemplateDto {
    name: string;
    content: string;
    variables: TemplateVariable[];
  }

  export interface UpdateTemplateDto {
    name?: string;
    content?: string;
    variables?: TemplateVariable[];
  }
  ```

  **TanStack Query Hooks**:
  ```typescript
  // useMessageTemplates(page, limit) - list with pagination
  // useMessageTemplate(id) - single template
  // useCreateTemplate() - mutation returning { mutate, isPending }
  // useUpdateTemplate() - mutation
  // useDeleteTemplate() - mutation
  ```

  **Acceptance Criteria**:
  - [ ] API proxy or API routes configured
  - [ ] All API functions implemented
  - [ ] All TanStack Query hooks working
  - [ ] Types match backend DTOs
  - [ ] Proper error handling
  - [ ] Loading states available via `isPending`/`isLoading`

---

- [ ] 8. Create Template List Page

  **What to do**:
  - Create `frontend/src/app/messages/templates/page.tsx`
  - Use existing table component pattern from app
  - Columns: 템플릿 이름, 변수 개수, 생성일, 작업(편집/삭제)
  - Add pagination using existing pagination component
  - "새 템플릿 만들기" button links to `/messages/templates/new`
  - Back link to `/messages`
  - Delete button opens confirmation dialog
  - Show loading skeleton while fetching
  - Show empty state when no templates

  **Must NOT do**:
  - DO NOT add search or filter functionality
  - DO NOT implement custom table (reuse existing)

  **Parallelizable**: YES (with task 9 after task 7)

  **References**:
  - `frontend/src/app/settings/voucher-price/page.tsx` - Table page pattern
  - Existing table and pagination components in the app

  **Empty State Design**:
  ```
  ┌─────────────────────────────────────────┐
  │                                         │
  │           📝 (message icon)             │
  │                                         │
  │    아직 생성된 템플릿이 없습니다          │
  │                                         │
  │        [+ 새 템플릿 만들기]              │
  │                                         │
  └─────────────────────────────────────────┘
  ```

  **Loading State**:
  - Show skeleton rows in table while `isLoading` is true
  - Disable pagination controls during loading

  **Delete Confirmation Dialog**:
  ```
  Title: 템플릿 삭제
  Content: "{template.name}" 템플릿을 삭제하시겠습니까? 이 작업은 되돌릴 수 없습니다.
  Actions: [취소] [삭제]
  ```

  **Acceptance Criteria**:
  - [ ] List page renders templates in table
  - [ ] Loading skeleton shown while fetching
  - [ ] Pagination works (page changes refetch data)
  - [ ] Edit navigates to `/messages/templates/[id]/edit`
  - [ ] Delete shows confirmation dialog
  - [ ] Delete removes template and refreshes list
  - [ ] Empty state shown when no templates exist
  - [ ] Empty state has "새 템플릿 만들기" button

---

- [ ] 9. Create Template Create/Edit Page

  **What to do**:
  - Create `frontend/src/app/messages/templates/new/page.tsx` - Create mode
  - Create `frontend/src/app/messages/templates/[id]/edit/page.tsx` - Edit mode
  - Side-by-side layout: template editor (left), detected variables (right)
  - Template name input (required)
  - Template content textarea
  - Real-time variable detection with `{{변수명}}` regex
  - 300ms debounce on content changes
  - Variable list shows: key, label input, type dropdown (text only for now), required checkbox
  - Validation: block save if variables in template don't match variable list
  - Show error message when mismatch detected
  - Save and Cancel buttons

  **Must NOT do**:
  - DO NOT add preview functionality
  - DO NOT add default value or placeholder inputs
  - DO NOT use rich text editor

  **Parallelizable**: YES (with task 8 after task 7)

  **References**:
  - `frontend/src/app/(components)/messages/forms/PriceInfoMessageForm.tsx` - Form patterns
  - Variable detection regex: `/\{\{([^}]+)\}\}/g`

  **Variable Detection Logic**:
  ```typescript
  const detectVariables = (content: string): string[] => {
    const regex = /\{\{([^}]+)\}\}/g;
    const matches = [...content.matchAll(regex)];
    return [...new Set(matches.map(m => m[1].trim()))];
  };
  ```

  **Debounce Implementation**:
  ```typescript
  import { useDebouncedCallback } from 'use-debounce';
  // OR: import debounce from 'lodash/debounce';

  const [content, setContent] = useState('');
  const [detectedVars, setDetectedVars] = useState<string[]>([]);

  const debouncedDetect = useDebouncedCallback((text: string) => {
    const vars = detectVariables(text);
    setDetectedVars(vars);
    // Sync with variables state - add new ones, keep customizations for existing
  }, 300);

  const handleContentChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setContent(e.target.value);
    debouncedDetect(e.target.value);
  };
  ```

  **Validation Error Display**:
  ```
  ⚠️ 변수 불일치 오류:
  - 템플릿에 정의되지 않은 변수: {{담당자명}}
  - 사용되지 않는 변수 정의: 서비스일자
  
  템플릿 내용과 변수 목록이 일치해야 저장할 수 있습니다.
  ```

  **Loading States**:
  - Show loading spinner on Save button when `isPending`
  - Disable form inputs during save
  - Show toast/snackbar on success/error

  **Acceptance Criteria**:
  - [ ] Create page works for new templates
  - [ ] Edit page loads existing template data
  - [ ] Variables detected in real-time (300ms debounce)
  - [ ] New variables auto-added to list with defaults
  - [ ] Removed variables flagged for removal
  - [ ] Variable customization (label, type, required) works
  - [ ] Validation error shown inline when mismatch
  - [ ] Save button disabled when validation fails
  - [ ] Loading spinner on save button during submission
  - [ ] Save creates/updates template
  - [ ] Cancel navigates back to list

---

- [ ] 10. Integrate with Messages Page

  **What to do**:
  - Modify `frontend/src/app/messages/page.tsx`
  - Fetch user templates using `useMessageTemplates` hook
  - Update template type dropdown to show grouped options:
    - "기본 템플릿" section with existing 7 types
    - "사용자 템플릿" section with user-created templates
    - "+ 새 템플릿 만들기" link at bottom
  - When user template selected:
    - Generate dynamic form based on `template.variables`
    - Each variable becomes an input field with configured label and required status
    - On form submit, substitute variables in template content
    - Display generated message in output area

  **Must NOT do**:
  - DO NOT modify existing form components for hardcoded templates
  - DO NOT change how existing 7 templates work

  **Parallelizable**: NO (depends on 7, 8, 9)

  **References**:
  - `frontend/src/app/messages/page.tsx` - Current implementation
  - `frontend/src/app/(components)/messages/forms/` - Existing form patterns
  - `frontend/src/app/store/form-store.ts` - Form state management

  **Variable Substitution Logic**:
  ```typescript
  const substituteVariables = (
    content: string, 
    values: Record<string, string>
  ): string => {
    return content.replace(/\{\{([^}]+)\}\}/g, (_, key) => {
      return values[key.trim()] || `{{${key}}}`;
    });
  };
  ```

  **Dropdown Grouping Implementation (MUI Select)**:
  ```typescript
  import { Select, MenuItem, ListSubheader, Divider } from '@mui/material';

  const BUILTIN_TEMPLATES = [
    { id: 'greeting', label: '인사말' },
    { id: 'service-info', label: '서비스 안내' },
    // ... other 5 templates
  ];

  <Select value={selectedType} onChange={handleTypeChange}>
    {/* Built-in templates section */}
    <ListSubheader>기본 템플릿</ListSubheader>
    {BUILTIN_TEMPLATES.map(t => (
      <MenuItem key={t.id} value={`builtin:${t.id}`}>{t.label}</MenuItem>
    ))}

    {/* User templates section (only if userTemplates.length > 0) */}
    {userTemplates.length > 0 && (
      <>
        <ListSubheader>사용자 템플릿</ListSubheader>
        {userTemplates.map(t => (
          <MenuItem key={t.id} value={`user:${t.id}`}>{t.name}</MenuItem>
        ))}
      </>
    )}

    {/* Quick link to create */}
    <Divider />
    <MenuItem 
      value="__create__" 
      onClick={() => router.push('/messages/templates/new')}
    >
      + 새 템플릿 만들기
    </MenuItem>
  </Select>
  ```

  **Dynamic Form Generation for User Templates**:
  ```typescript
  // When user template selected, render inputs based on variables
  {selectedTemplate?.variables.map(variable => (
    <TextField
      key={variable.key}
      label={variable.label}
      required={variable.required}
      value={formValues[variable.key] || ''}
      onChange={(e) => setFormValues(prev => ({
        ...prev,
        [variable.key]: e.target.value
      }))}
    />
  ))}
  ```

  **Acceptance Criteria**:
  - [ ] Dropdown shows both template sections with separators
  - [ ] User templates appear under "사용자 템플릿" section
  - [ ] Section only shows if user templates exist
  - [ ] "+ 새 템플릿 만들기" link navigates to create page
  - [ ] Selecting user template shows dynamic form
  - [ ] Form inputs match template variables
  - [ ] Required fields marked with asterisk
  - [ ] Form validation respects required/optional settings
  - [ ] Generated message correctly substitutes all variables
  - [ ] Existing 7 templates continue to work unchanged

---

## Success Criteria

### Final Checklist
- [ ] All "Must Have" features implemented
- [ ] All "Must NOT Have" guardrails respected
- [ ] Backend follows Clean Architecture (Entity → Repository → Use Cases → Service → Controller)
- [ ] Frontend uses TanStack Query for server state
- [ ] Variable detection uses `{{변수명}}` syntax with real-time detection
- [ ] Validation blocks save on variable mismatch
- [ ] Combined dropdown integrates seamlessly with existing templates
- [ ] Hard delete works with confirmation dialog
- [ ] Pagination works on template list

### Performance Considerations
- Debounce variable detection at 300ms to avoid excessive re-renders
- Paginate template list (default 10 per page)
- Use TanStack Query caching for template data

### Future Extensibility Points
- **Input Types**: `type` field in variables supports future dropdown, date, number types
- **Live Preview**: Side-by-side layout can accommodate preview panel
- **Search/Filter**: API can be extended with query parameters
- **Soft Delete**: Add `deletedAt` field later if needed
