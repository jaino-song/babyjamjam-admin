# Draft: Message Template Management Feature

## Requirements (confirmed)
- **Variable Definition**: Hybrid approach (auto-detect + manual customization)
- **Input Types**: Default to text for now (extensible for future types)
- **Permissions**: Global (all users see all templates)
- **Migration**: Keep parallel (existing 7 templates remain as-is)
- **Preview**: No preview initially (but architecture should allow future live preview)

## Technical Decisions
- **Variable Syntax**: `{{변수명}}` (Handlebars/Mustache style)
- **Auto-Detection**: Real-time as user types (with debounce ~300ms)
- **Customizable Properties per Variable**:
  - Display Label: YES (e.g., `고객명` → `고객 이름`)
  - Input Type: YES (default text, extensible for future dropdown/date)
  - Required/Optional: YES
  - Default Value: NO
  - Placeholder: NO
- **Validation**: Block save until all `{{variables}}` in template have matching definitions
- **Page Layout**: Side-by-side (template editor left, detected variables right)

## Research Findings

### Existing Message System
- **Location**: `/frontend/src/app/messages/page.tsx`
- **Pattern**: 7 hardcoded template types (greeting, service-info, price-info, reminder, thanks, survey, info)
- **Forms**: Each type has dedicated form component in `/frontend/src/app/(components)/messages/forms/`
- **Templates**: Static template functions in `/frontend/src/app/(components)/messages/templates/messageTemplate/`
- **State**: Zustand store (`form-store.ts`) manages form data

### Backend Architecture (Clean Architecture)
- **Entity Pattern**: `AreaTemplateEntity` as reference
- **Repository Pattern**: Interface + Prisma implementation
- **Use Cases**: CRUD operations as separate use cases
- **Controller**: REST API endpoints

### Variable Substitution Pattern
- **Alimtalk**: Uses `#{variable}` syntax with predefined variable arrays
- **Frontend Templates**: Uses `${data.variable}` direct interpolation

### Tech Stack
- **Frontend**: Next.js 16 (App Router), MUI v7, Zustand, TanStack Query
- **Backend**: NestJS 10, Prisma 6, PostgreSQL
- **Patterns**: Clean Architecture, Repository Pattern, Use Cases

## Open Questions
✅ All questions resolved

## Template Metadata
- **Name**: Required
- **Description**: Not needed
- **Category**: Not needed (just name is enough)

## Page & Navigation
- **Location**: `/messages/templates` (close to where templates are used)
- **List View**: Reuse existing app table component with pagination (no search/filter for now)
- **Integration**: Combined dropdown on `/messages` page - all templates in one list, user-created at bottom

## Delete Behavior
- **Hard delete** with confirmation dialog

## Scope Boundaries
- INCLUDE:
  - Backend: MessageTemplate entity with Clean Architecture (Entity → Repository → Use Cases → Service → Controller)
  - Backend: CRUD API endpoints (`/message-templates`)
  - Backend: Prisma schema for templates with JSON field for variable definitions
  - Frontend: Template management page at `/messages/templates`
  - Frontend: Template creation/edit form (side-by-side layout)
  - Frontend: Real-time variable detection from `{{변수명}}` syntax
  - Frontend: Variable customization (label, type, required)
  - Frontend: Integration with existing `/messages` page (combined dropdown)
  - Validation: Block save until all variables have definitions

- EXCLUDE:
  - Rich text editor (plain textarea)
  - Template categories/tags
  - Search/filter on list (just pagination)
  - Live preview (architecture ready for future)
  - Default values / placeholders for variables
  - Migration of existing 7 templates (keep parallel)
  - Soft delete / restore functionality

## Parallelization Opportunities
- (pending task breakdown)

## Dependencies
- (pending task breakdown)
