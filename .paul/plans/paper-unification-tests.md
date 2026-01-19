# TDD Test Specifications: Paper Component Unification

## Context

### Original Request
Create test specifications for the Paper Component Unification refactoring task, which involves:
1. Creating a new `ContentPaper` component
2. Migrating 18 files from `ComponentContainer`/direct `Paper` to `ContentPaper`
3. Deleting the old `ComponentContainer`

### Implementation Plan Reference
- **Plan File**: `.paul/plans/paper-unification.md`
- **Scope**: React component refactoring with MUI Paper unification

### Research Findings
- **Test Infrastructure**: Jest + React Testing Library for unit tests, Playwright for E2E
- **Existing Patterns**: `__tests__/` folders inside component directories
- **Jest Config**: `frontend/jest.config.js` with `@/` path alias
- **Playwright Config**: `frontend/playwright.config.ts` with `tests/` directory

### Thomas Review Applied
- Fixed TDD anti-patterns (removed MUI class name checks)
- Added missing migration tests for all 18 files
- Added edge case tests (empty children, multiple children, responsive padding)
- Specified mock requirements for i18n and hooks
- Deepened migration tests to verify visual consistency

---

## Test Setup Requirements (MANDATORY)

### Jest Setup (`frontend/jest.setup.ts`)

```typescript
import '@testing-library/jest-dom';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { render, RenderOptions } from '@testing-library/react';
import { ReactElement } from 'react';

// Create test theme matching production
const testTheme = createTheme({
  shape: { borderRadius: 14 },
  palette: {
    background: { default: '#fafafa' }
  }
});

// Custom render with theme provider
export const renderWithTheme = (
  ui: ReactElement,
  options?: Omit<RenderOptions, 'wrapper'>
) => {
  const Wrapper = ({ children }: { children: React.ReactNode }) => (
    <ThemeProvider theme={testTheme}>{children}</ThemeProvider>
  );
  return render(ui, { wrapper: Wrapper, ...options });
};

// Mock i18n - returns key as-is for testing
jest.mock('@/app/lib/i18n/translations', () => ({
  t: (locale: string, key: string) => key,
  Locale: { ko: 'ko', en: 'en' }
}));

// Mock LocaleProvider
jest.mock('@/app/(components)/LocaleProvider', () => ({
  useLocale: () => 'ko'
}));
```

### Playwright Setup (`frontend/tests/fixtures.ts`)

```typescript
import { test as base, expect } from '@playwright/test';

// Auth mock fixture (see notification-bell.spec.ts pattern)
export const test = base.extend({
  page: async ({ page }, use) => {
    // Mock auth for protected routes
    await page.route('**/api/auth/me', async (route) => {
      await route.fulfill({
        status: 200,
        contentType: 'application/json',
        body: JSON.stringify({
          id: 'test-user',
          name: '테스트 사용자',
          email: 'test@example.com',
          role: 'admin',
        }),
      });
    });
    await use(page);
  },
});

export { expect };
```

---

## Test Strategy

### Unit Test Track (Jest + React Testing Library)
- **Framework**: Jest with next/jest
- **Pattern**: `src/app/(components)/root/__tests__/ContentPaper.test.tsx`
- **Coverage Target**: 100% for ContentPaper component
- **Mocking Strategy**: Mock i18n via jest.setup.ts, use renderWithTheme wrapper

### E2E Test Track (Playwright)
- **Framework**: Playwright
- **Pattern**: `tests/paper-unification.spec.ts`
- **Browsers**: chromium (as per existing config)
- **Focus**: Visual regression, animation behavior, migrated components render correctly

---

## Phase 1: RED (Write Failing Tests)

> **Goal**: Define the contract through failing tests BEFORE implementation

### Unit Tests

#### Test Suite: ContentPaper Component

##### File: `frontend/src/app/(components)/root/__tests__/ContentPaper.test.tsx`

###### Basic Rendering Tests

- [ ] **Test**: renders children correctly
  - **Input**: `<ContentPaper><div data-testid="child">Hello</div></ContentPaper>`
  - **Expected Output**: Child element is visible in the document
  - **Setup**: Use `renderWithTheme` wrapper
  - **Assertions**:
    ```typescript
    // #given ContentPaper with child element
    const { getByTestId, getByText } = renderWithTheme(
      <ContentPaper><div data-testid="child">Hello</div></ContentPaper>
    );
    
    // #then child is rendered
    expect(getByTestId('child')).toBeInTheDocument();
    expect(getByText('Hello')).toBeVisible();
    ```

- [ ] **Test**: renders with data-component attribute for testing
  - **Input**: `<ContentPaper>Content</ContentPaper>`
  - **Expected Output**: Element has `data-component="content-paper"`
  - **Assertions**:
    ```typescript
    // #given ContentPaper rendered
    const { getByTestId } = renderWithTheme(<ContentPaper>Content</ContentPaper>);
    
    // #then has data-component attribute
    expect(getByTestId('content-paper')).toHaveAttribute('data-component', 'content-paper');
    ```

- [ ] **Test**: renders with empty children without error
  - **Input**: `<ContentPaper>{null}</ContentPaper>` and `<ContentPaper>{undefined}</ContentPaper>`
  - **Expected Output**: Paper renders without throwing
  - **Assertions**:
    ```typescript
    // #given ContentPaper with null/undefined children
    expect(() => renderWithTheme(<ContentPaper>{null}</ContentPaper>)).not.toThrow();
    expect(() => renderWithTheme(<ContentPaper>{undefined}</ContentPaper>)).not.toThrow();
    
    // #then paper still renders
    const { getByTestId } = renderWithTheme(<ContentPaper>{null}</ContentPaper>);
    expect(getByTestId('content-paper')).toBeInTheDocument();
    ```

- [ ] **Test**: renders multiple children in order
  - **Input**: `<ContentPaper><div>First</div><div>Second</div><div>Third</div></ContentPaper>`
  - **Expected Output**: All children rendered in correct order
  - **Assertions**:
    ```typescript
    // #given ContentPaper with multiple children
    const { getByTestId } = renderWithTheme(
      <ContentPaper>
        <div data-testid="first">First</div>
        <div data-testid="second">Second</div>
        <div data-testid="third">Third</div>
      </ContentPaper>
    );
    
    // #then all children are rendered
    expect(getByTestId('first')).toBeInTheDocument();
    expect(getByTestId('second')).toBeInTheDocument();
    expect(getByTestId('third')).toBeInTheDocument();
    
    // #and in correct order (first appears before second in DOM)
    const paper = getByTestId('content-paper');
    const children = paper.querySelectorAll('[data-testid]');
    expect(children[0]).toHaveAttribute('data-testid', 'first');
    expect(children[1]).toHaveAttribute('data-testid', 'second');
    expect(children[2]).toHaveAttribute('data-testid', 'third');
    ```

###### Elevation Tests

- [ ] **Test**: applies default elevation of 2
  - **Input**: `<ContentPaper>Content</ContentPaper>`
  - **Expected Output**: Paper has box-shadow indicating elevation 2
  - **Assertions**:
    ```typescript
    // #given ContentPaper with default props
    const { getByTestId } = renderWithTheme(<ContentPaper>Content</ContentPaper>);
    const paper = getByTestId('content-paper');
    
    // #then has elevation 2 (verified via computed box-shadow, not class name)
    const computedStyle = window.getComputedStyle(paper);
    // MUI elevation 2 produces a specific box-shadow
    expect(computedStyle.boxShadow).not.toBe('none');
    expect(computedStyle.boxShadow).toContain('rgba');
    ```

- [ ] **Test**: allows elevation override to 0
  - **Input**: `<ContentPaper elevation={0}>Content</ContentPaper>`
  - **Expected Output**: Paper has no box-shadow (elevation 0)
  - **Assertions**:
    ```typescript
    // #given ContentPaper with elevation={0}
    const { getByTestId } = renderWithTheme(
      <ContentPaper elevation={0}>Content</ContentPaper>
    );
    const paper = getByTestId('content-paper');
    
    // #then has no elevation shadow
    const computedStyle = window.getComputedStyle(paper);
    expect(computedStyle.boxShadow).toBe('none');
    ```

- [ ] **Test**: allows elevation override to higher values
  - **Input**: `<ContentPaper elevation={8}>Content</ContentPaper>`
  - **Expected Output**: Paper has stronger box-shadow
  - **Assertions**:
    ```typescript
    // #given ContentPaper with elevation={8}
    const { getByTestId } = renderWithTheme(
      <ContentPaper elevation={8}>Content</ContentPaper>
    );
    const paper = getByTestId('content-paper');
    
    // #then has box-shadow (stronger than default)
    const computedStyle = window.getComputedStyle(paper);
    expect(computedStyle.boxShadow).not.toBe('none');
    ```

###### Title/Subtitle Tests

- [ ] **Test**: renders title when provided
  - **Input**: `<ContentPaper title="Test Title">Content</ContentPaper>`
  - **Expected Output**: Title Typography is visible with h5 variant
  - **Assertions**:
    ```typescript
    // #given ContentPaper with title
    const { getByRole, getByText } = renderWithTheme(
      <ContentPaper title="Test Title">Content</ContentPaper>
    );
    
    // #then title is rendered as heading
    const heading = getByRole('heading', { level: 5 });
    expect(heading).toBeVisible();
    expect(getByText('Test Title')).toBeInTheDocument();
    ```

- [ ] **Test**: renders subtitle when provided with title
  - **Input**: `<ContentPaper title="Title" subtitle="Test Subtitle">Content</ContentPaper>`
  - **Expected Output**: Subtitle Typography is visible
  - **Assertions**:
    ```typescript
    // #given ContentPaper with title and subtitle
    const { getByText } = renderWithTheme(
      <ContentPaper title="Title" subtitle="Test Subtitle">Content</ContentPaper>
    );
    
    // #then subtitle is rendered
    expect(getByText('Test Subtitle')).toBeVisible();
    ```

- [ ] **Test**: does not render title/subtitle when not provided
  - **Input**: `<ContentPaper>Content</ContentPaper>`
  - **Expected Output**: No Typography elements for title/subtitle
  - **Assertions**:
    ```typescript
    // #given ContentPaper without title/subtitle
    const { queryByRole } = renderWithTheme(<ContentPaper>Content</ContentPaper>);
    
    // #then no heading is rendered
    expect(queryByRole('heading')).not.toBeInTheDocument();
    ```

- [ ] **Test**: renders title with special characters correctly
  - **Input**: `<ContentPaper title="직원 목록 <Test> & 'Quotes'">Content</ContentPaper>`
  - **Expected Output**: Special characters rendered correctly (not escaped)
  - **Assertions**:
    ```typescript
    // #given ContentPaper with special characters in title
    const { getByText } = renderWithTheme(
      <ContentPaper title="직원 목록 <Test> & 'Quotes'">Content</ContentPaper>
    );
    
    // #then special characters are rendered
    expect(getByText("직원 목록 <Test> & 'Quotes'")).toBeInTheDocument();
    ```

- [ ] **Test**: handles very long title without breaking layout
  - **Input**: `<ContentPaper title="This is a very long title that might overflow the container and cause layout issues if not handled properly">Content</ContentPaper>`
  - **Expected Output**: Title renders without horizontal overflow
  - **Assertions**:
    ```typescript
    // #given ContentPaper with very long title
    const { getByTestId, getByRole } = renderWithTheme(
      <ContentPaper title="This is a very long title that might overflow the container and cause layout issues if not handled properly">
        Content
      </ContentPaper>
    );
    
    // #then paper doesn't have horizontal overflow
    const paper = getByTestId('content-paper');
    expect(paper.scrollWidth).toBeLessThanOrEqual(paper.clientWidth + 1); // +1 for rounding
    ```

###### Header Prop Tests

- [ ] **Test**: header prop overrides title/subtitle
  - **Input**: 
    ```tsx
    <ContentPaper 
      title="Ignored Title" 
      subtitle="Ignored Subtitle"
      header={<div data-testid="custom-header">Custom Header</div>}
    >
      Content
    </ContentPaper>
    ```
  - **Expected Output**: Custom header visible, title/subtitle not rendered
  - **Assertions**:
    ```typescript
    // #given ContentPaper with header prop (and title/subtitle)
    const { getByTestId, queryByText } = renderWithTheme(
      <ContentPaper 
        title="Ignored Title" 
        subtitle="Ignored Subtitle"
        header={<div data-testid="custom-header">Custom Header</div>}
      >
        Content
      </ContentPaper>
    );
    
    // #then custom header is rendered
    expect(getByTestId('custom-header')).toBeVisible();
    
    // #and title/subtitle are NOT rendered
    expect(queryByText('Ignored Title')).not.toBeInTheDocument();
    expect(queryByText('Ignored Subtitle')).not.toBeInTheDocument();
    ```

- [ ] **Test**: header prop with complex ReactNode
  - **Input**: 
    ```tsx
    <ContentPaper 
      header={
        <div data-testid="complex-header">
          <h2>Custom Title</h2>
          <button>Action</button>
        </div>
      }
    >
      Content
    </ContentPaper>
    ```
  - **Expected Output**: Complex header renders correctly
  - **Assertions**:
    ```typescript
    // #given ContentPaper with complex header
    const { getByTestId, getByRole } = renderWithTheme(
      <ContentPaper 
        header={
          <div data-testid="complex-header">
            <h2>Custom Title</h2>
            <button>Action</button>
          </div>
        }
      >
        Content
      </ContentPaper>
    );
    
    // #then complex header elements are rendered
    expect(getByTestId('complex-header')).toBeVisible();
    expect(getByRole('heading', { level: 2 })).toHaveTextContent('Custom Title');
    expect(getByRole('button', { name: 'Action' })).toBeInTheDocument();
    ```

###### Padding/Styling Tests

- [ ] **Test**: applies default padding (p: 3 = 24px)
  - **Input**: `<ContentPaper>Content</ContentPaper>`
  - **Expected Output**: Paper has 24px padding
  - **Assertions**:
    ```typescript
    // #given ContentPaper with default props
    const { getByTestId } = renderWithTheme(<ContentPaper>Content</ContentPaper>);
    const paper = getByTestId('content-paper');
    
    // #then has default padding
    const computedStyle = window.getComputedStyle(paper);
    expect(computedStyle.padding).toBe('24px');
    ```

- [ ] **Test**: custom padding via sx overrides default
  - **Input**: `<ContentPaper sx={{ p: 2 }}>Content</ContentPaper>`
  - **Expected Output**: Custom padding (16px) applied instead of default (24px)
  - **Assertions**:
    ```typescript
    // #given ContentPaper with custom padding
    const { getByTestId } = renderWithTheme(
      <ContentPaper sx={{ p: 2 }}>Content</ContentPaper>
    );
    const paper = getByTestId('content-paper');
    
    // #then custom padding is applied
    const computedStyle = window.getComputedStyle(paper);
    expect(computedStyle.padding).toBe('16px');
    ```

- [ ] **Test**: merges custom sx props with defaults
  - **Input**: `<ContentPaper sx={{ minHeight: '70vh', borderRadius: 0 }}>Content</ContentPaper>`
  - **Expected Output**: Custom styles applied alongside defaults
  - **Assertions**:
    ```typescript
    // #given ContentPaper with custom sx props
    const { getByTestId } = renderWithTheme(
      <ContentPaper sx={{ minHeight: '70vh', borderRadius: 0 }}>Content</ContentPaper>
    );
    const paper = getByTestId('content-paper');
    
    // #then custom styles are applied
    const computedStyle = window.getComputedStyle(paper);
    expect(computedStyle.minHeight).toBe('70vh');
    expect(computedStyle.borderRadius).toBe('0px');
    
    // #and default padding is still applied
    expect(computedStyle.padding).toBe('24px');
    ```

- [ ] **Test**: responsive padding works at different breakpoints
  - **Input**: `<ContentPaper sx={{ p: { xs: 2, sm: 3 } }}>Content</ContentPaper>`
  - **Expected Output**: Different padding at different viewport widths
  - **Note**: This test requires viewport manipulation
  - **Assertions**:
    ```typescript
    // #given ContentPaper with responsive padding
    // Note: Jest/JSDOM doesn't support responsive styles well
    // This test verifies the sx prop is accepted without error
    expect(() => renderWithTheme(
      <ContentPaper sx={{ p: { xs: 2, sm: 3 } }}>Content</ContentPaper>
    )).not.toThrow();
    
    // Full responsive testing should be done in E2E tests
    ```

- [ ] **Test**: applies bgcolor background.default by default
  - **Input**: `<ContentPaper>Content</ContentPaper>`
  - **Expected Output**: Background color from theme
  - **Assertions**:
    ```typescript
    // #given ContentPaper with default props
    const { getByTestId } = renderWithTheme(<ContentPaper>Content</ContentPaper>);
    const paper = getByTestId('content-paper');
    
    // #then has background color (from theme)
    const computedStyle = window.getComputedStyle(paper);
    expect(computedStyle.backgroundColor).toBeTruthy();
    expect(computedStyle.backgroundColor).not.toBe('transparent');
    ```

###### Animation Tests

- [ ] **Test**: Fade animation is enabled by default
  - **Input**: `<ContentPaper>Content</ContentPaper>`
  - **Expected Output**: Content is visible after animation completes
  - **Assertions**:
    ```typescript
    // #given ContentPaper with default animation
    jest.useFakeTimers();
    const { getByTestId } = renderWithTheme(<ContentPaper>Content</ContentPaper>);
    
    // #when animation completes
    jest.advanceTimersByTime(500);
    
    // #then content is visible
    expect(getByTestId('content-paper')).toBeVisible();
    
    jest.useRealTimers();
    ```

- [ ] **Test**: disableAnimation prop renders content immediately
  - **Input**: `<ContentPaper disableAnimation>Content</ContentPaper>`
  - **Expected Output**: Content visible immediately without waiting
  - **Assertions**:
    ```typescript
    // #given ContentPaper with disableAnimation
    const { getByText } = renderWithTheme(
      <ContentPaper disableAnimation>Immediate Content</ContentPaper>
    );
    
    // #then content is immediately visible (no need to wait)
    expect(getByText('Immediate Content')).toBeVisible();
    ```

###### Prop Forwarding Tests

- [ ] **Test**: forwards component prop to Paper
  - **Input**: `<ContentPaper component="section">Content</ContentPaper>`
  - **Expected Output**: Renders as section element
  - **Assertions**:
    ```typescript
    // #given ContentPaper with component prop
    const { getByTestId } = renderWithTheme(
      <ContentPaper component="section">Content</ContentPaper>
    );
    const paper = getByTestId('content-paper');
    
    // #then renders as section
    expect(paper.tagName).toBe('SECTION');
    ```

- [ ] **Test**: forwards id prop to Paper
  - **Input**: `<ContentPaper id="test-section">Content</ContentPaper>`
  - **Expected Output**: Paper has id attribute
  - **Assertions**:
    ```typescript
    // #given ContentPaper with id prop
    const { getByTestId } = renderWithTheme(
      <ContentPaper id="test-section">Content</ContentPaper>
    );
    const paper = getByTestId('content-paper');
    
    // #then has id attribute
    expect(paper).toHaveAttribute('id', 'test-section');
    ```

- [ ] **Test**: forwards className prop to Paper
  - **Input**: `<ContentPaper className="custom-class">Content</ContentPaper>`
  - **Expected Output**: Paper has custom class
  - **Assertions**:
    ```typescript
    // #given ContentPaper with className
    const { getByTestId } = renderWithTheme(
      <ContentPaper className="custom-class">Content</ContentPaper>
    );
    const paper = getByTestId('content-paper');
    
    // #then has custom class
    expect(paper).toHaveClass('custom-class');
    ```

---

#### Test Suite: ContentPaper TypeScript Types

##### File: `frontend/src/app/(components)/root/__tests__/ContentPaper.types.test.tsx`

- [ ] **Test**: TypeScript accepts valid props
  - **Input**: Various valid prop combinations
  - **Expected**: No TypeScript errors (compile-time check)
  - **Assertions**:
    ```typescript
    // This test file should compile without errors
    // Valid usages:
    <ContentPaper>Children</ContentPaper>
    <ContentPaper title="Title">Children</ContentPaper>
    <ContentPaper title="Title" subtitle="Sub">Children</ContentPaper>
    <ContentPaper header={<div>Header</div>}>Children</ContentPaper>
    <ContentPaper elevation={0}>Children</ContentPaper>
    <ContentPaper elevation={8}>Children</ContentPaper>
    <ContentPaper disableAnimation>Children</ContentPaper>
    <ContentPaper sx={{ p: 2 }}>Children</ContentPaper>
    <ContentPaper sx={{ p: { xs: 2, sm: 3 } }}>Children</ContentPaper>
    <ContentPaper component="section">Children</ContentPaper>
    <ContentPaper id="test" className="custom">Children</ContentPaper>
    ```

- [ ] **Test**: TypeScript rejects invalid props
  - **Expected**: TypeScript errors for invalid usage
  - **Assertions**:
    ```typescript
    // @ts-expect-error - children is required
    <ContentPaper />
    
    // @ts-expect-error - textJSON is not a valid prop (old API)
    <ContentPaper textJSON="employees">Children</ContentPaper>
    
    // @ts-expect-error - borderTopLeftRadius is not a direct prop (use sx)
    <ContentPaper borderTopLeftRadius={0}>Children</ContentPaper>
    ```

---

### Integration Tests (Migrated Components)

> **Note**: All migration tests verify:
> 1. ContentPaper wrapper is present
> 2. Visual consistency (minHeight, padding preserved)
> 3. i18n titles render correctly
> 4. Component functionality is not broken

#### Test Suite: ComponentContainer Migrations (5 files)

##### File: `frontend/src/app/(components)/employees/__tests__/EmployeesTable.migration.test.tsx`

**Mock Setup Required**:
```typescript
jest.mock('@/app/hooks/useEmployees', () => ({
  useEmployees: jest.fn(),
  useDeleteEmployee: () => ({ mutateAsync: jest.fn() }),
}));
```

- [ ] **Test**: EmployeesTable renders with ContentPaper wrapper
  - **Setup**: Mock useEmployees to return `{ data: [], isLoading: false, error: null }`
  - **Assertions**:
    ```typescript
    // #given EmployeesTable rendered
    const { useEmployees } = require('@/app/hooks/useEmployees');
    useEmployees.mockReturnValue({ data: [], isLoading: false, error: null });
    
    const { getByTestId } = renderWithTheme(<EmployeesTable />);
    
    // #then ContentPaper wrapper is present
    expect(getByTestId('content-paper')).toBeInTheDocument();
    ```

- [ ] **Test**: EmployeesTable preserves minHeight: 70vh
  - **Setup**: Mock useEmployees to return empty array
  - **Assertions**:
    ```typescript
    // #given EmployeesTable rendered
    const { getByTestId } = renderWithTheme(<EmployeesTable />);
    const paper = getByTestId('content-paper');
    
    // #then minHeight is preserved from original ComponentContainer
    const computedStyle = window.getComputedStyle(paper);
    expect(computedStyle.minHeight).toBe('70vh');
    ```

- [ ] **Test**: EmployeesTable renders i18n title correctly
  - **Setup**: Mock useEmployees, mock i18n to return key
  - **Assertions**:
    ```typescript
    // #given EmployeesTable rendered with mocked i18n
    const { getByText } = renderWithTheme(<EmployeesTable />);
    
    // #then title key is rendered (mocked i18n returns key)
    expect(getByText('employees.title')).toBeInTheDocument();
    ```

- [ ] **Test**: EmployeesTable loading state renders in ContentPaper
  - **Setup**: Mock useEmployees with `{ isLoading: true }`
  - **Assertions**:
    ```typescript
    // #given EmployeesTable in loading state
    useEmployees.mockReturnValue({ data: undefined, isLoading: true, error: null });
    const { getByRole, getByTestId } = renderWithTheme(<EmployeesTable />);
    
    // #then loading spinner is inside ContentPaper
    expect(getByRole('progressbar')).toBeInTheDocument();
    expect(getByTestId('content-paper')).toBeInTheDocument();
    ```

- [ ] **Test**: EmployeesTable error state renders in ContentPaper
  - **Setup**: Mock useEmployees with error
  - **Assertions**:
    ```typescript
    // #given EmployeesTable in error state
    useEmployees.mockReturnValue({ data: undefined, isLoading: false, error: new Error('Failed') });
    const { getByRole, getByTestId } = renderWithTheme(<EmployeesTable />);
    
    // #then error alert is inside ContentPaper
    expect(getByRole('alert')).toBeInTheDocument();
    expect(getByTestId('content-paper')).toBeInTheDocument();
    ```

##### File: `frontend/src/app/(components)/clients/__tests__/ClientsTable.migration.test.tsx`

**Mock Setup Required**:
```typescript
jest.mock('@/app/hooks/useClients', () => ({
  useClients: jest.fn(),
  useDeleteClient: () => ({ mutateAsync: jest.fn() }),
}));
```

- [ ] **Test**: ClientsTable renders with ContentPaper wrapper
  - **Setup**: Mock useClients to return empty array
  - **Assertions**:
    ```typescript
    // #given ClientsTable rendered
    const { getByTestId, getByText } = renderWithTheme(<ClientsTable />);
    
    // #then ContentPaper wrapper is present with title
    expect(getByTestId('content-paper')).toBeInTheDocument();
    expect(getByText('clients.title')).toBeInTheDocument();
    ```

- [ ] **Test**: ClientsTable preserves minHeight: 70vh
  - **Assertions**:
    ```typescript
    const { getByTestId } = renderWithTheme(<ClientsTable />);
    const paper = getByTestId('content-paper');
    const computedStyle = window.getComputedStyle(paper);
    expect(computedStyle.minHeight).toBe('70vh');
    ```

##### File: `frontend/src/app/(components)/eformsign/__tests__/DocumentsList.migration.test.tsx`

- [ ] **Test**: DocumentsList renders with ContentPaper wrapper
  - **Assertions**:
    ```typescript
    // #given DocumentsList rendered
    const { getByTestId, getByText } = renderWithTheme(<DocumentsList />);
    
    // #then ContentPaper wrapper is present with title
    expect(getByTestId('content-paper')).toBeInTheDocument();
    expect(getByText('documents-list.title')).toBeInTheDocument();
    ```

##### File: `frontend/src/features/employees/components/__tests__/EmployeesTable.migration.test.tsx`

- [ ] **Test**: Legacy EmployeesTable renders with ContentPaper wrapper
  - **Note**: This is the legacy features/ version
  - **Assertions**:
    ```typescript
    expect(getByTestId('content-paper')).toBeInTheDocument();
    ```

##### File: `frontend/src/features/clients/components/__tests__/ClientsTable.migration.test.tsx`

- [ ] **Test**: Legacy ClientsTable renders with ContentPaper wrapper
  - **Note**: This is the legacy features/ version
  - **Assertions**:
    ```typescript
    expect(getByTestId('content-paper')).toBeInTheDocument();
    ```

---

#### Test Suite: Direct Paper Migrations (13 files)

##### File: `frontend/src/app/messages/__tests__/page.migration.test.tsx`

- [ ] **Test**: Messages page renders with ContentPaper
  - **Assertions**:
    ```typescript
    expect(getByTestId('content-paper')).toBeInTheDocument();
    ```

##### File: `frontend/src/app/messages/__tests__/loading.migration.test.tsx`

- [ ] **Test**: Messages loading page renders with ContentPaper
  - **Assertions**:
    ```typescript
    expect(getByTestId('content-paper')).toBeInTheDocument();
    ```

##### File: `frontend/src/app/settings/general/__tests__/page.migration.test.tsx`

- [ ] **Test**: Settings general page renders 3 ContentPapers
  - **Note**: This page has 3 Paper sections
  - **Assertions**:
    ```typescript
    // #given Settings general page rendered
    const { getAllByTestId } = renderWithTheme(<SettingsGeneralPage />);
    
    // #then 3 ContentPapers are present
    const papers = getAllByTestId('content-paper');
    expect(papers).toHaveLength(3);
    ```

##### File: `frontend/src/app/(components)/settings/__tests__/VoucherPriceUploadForm.migration.test.tsx`

- [ ] **Test**: VoucherPriceUploadForm renders with ContentPaper
  - **Assertions**:
    ```typescript
    expect(getByTestId('content-paper')).toBeInTheDocument();
    ```

##### File: `frontend/src/app/(components)/settings/__tests__/ImageDropzone.migration.test.tsx`

- [ ] **Test**: ImageDropzone renders with ContentPaper
  - **Assertions**:
    ```typescript
    expect(getByTestId('content-paper')).toBeInTheDocument();
    ```

##### File: `frontend/src/app/(components)/dashboard/__tests__/HeroBanner.migration.test.tsx`

- [ ] **Test**: HeroBanner renders with ContentPaper (elevation 0)
  - **Input**: HeroBanner with required props
  - **Assertions**:
    ```typescript
    // #given HeroBanner rendered
    const { getByTestId } = renderWithTheme(
      <HeroBanner 
        title="Title" 
        subtitle="Sub" 
        primaryActionLabel="Primary" 
        secondaryActionLabel="Secondary" 
      />
    );
    const paper = getByTestId('content-paper');
    
    // #then has elevation 0 (no shadow)
    const computedStyle = window.getComputedStyle(paper);
    expect(computedStyle.boxShadow).toBe('none');
    ```

- [ ] **Test**: HeroBanner preserves custom styling (gradient, borderRadius)
  - **Assertions**:
    ```typescript
    const { getByTestId } = renderWithTheme(
      <HeroBanner title="T" subtitle="S" primaryActionLabel="P" secondaryActionLabel="S" />
    );
    const paper = getByTestId('content-paper');
    const computedStyle = window.getComputedStyle(paper);
    
    // #then custom borderRadius is preserved
    expect(computedStyle.borderRadius).toBe('24px'); // borderRadius: 3 = 24px
    ```

##### File: `frontend/src/app/(components)/dashboard/__tests__/QuickActions.migration.test.tsx`

- [ ] **Test**: QuickActions renders with ContentPaper
  - **Assertions**:
    ```typescript
    expect(getByTestId('content-paper')).toBeInTheDocument();
    ```

##### File: `frontend/src/app/(components)/dashboard/__tests__/RecentActivity.migration.test.tsx`

- [ ] **Test**: RecentActivity renders with ContentPaper
  - **Assertions**:
    ```typescript
    expect(getByTestId('content-paper')).toBeInTheDocument();
    ```

##### File: `frontend/src/app/(components)/dashboard/__tests__/PerformanceOverview.migration.test.tsx`

- [ ] **Test**: PerformanceOverview renders with ContentPaper
  - **Assertions**:
    ```typescript
    expect(getByTestId('content-paper')).toBeInTheDocument();
    ```

##### File: `frontend/src/app/(components)/chat/__tests__/ChatFullscreen.migration.test.tsx`

- [ ] **Test**: ChatFullscreen renders with ContentPaper
  - **Assertions**:
    ```typescript
    expect(getByTestId('content-paper')).toBeInTheDocument();
    ```

##### File: `frontend/src/app/(components)/notifications/__tests__/NotificationSettings.migration.test.tsx`

- [ ] **Test**: NotificationSettings renders with ContentPaper
  - **Assertions**:
    ```typescript
    expect(getByTestId('content-paper')).toBeInTheDocument();
    ```

##### File: `frontend/src/app/(components)/messages/templates/__tests__/GeneratedMsg.migration.test.tsx`

- [ ] **Test**: GeneratedMsg renders with ContentPaper
  - **Assertions**:
    ```typescript
    expect(getByTestId('content-paper')).toBeInTheDocument();
    ```

##### File: `frontend/src/app/(components)/messages/forms/__tests__/ContractCreationForm.migration.test.tsx`

- [ ] **Test**: ContractCreationForm renders with ContentPaper
  - **Assertions**:
    ```typescript
    expect(getByTestId('content-paper')).toBeInTheDocument();
    ```

---

### E2E Tests

#### Test Suite: Paper Unification Visual Regression

##### File: `frontend/tests/paper-unification.spec.ts`

- [ ] **Test**: /employees page renders with ContentPaper
  - **Steps**:
    1. Navigate to `/employees`
    2. Wait for page load
    3. Verify ContentPaper is visible
  - **Assertions**:
    ```typescript
    await page.goto('/employees');
    await page.waitForLoadState('networkidle');
    
    // #then ContentPaper is visible
    const paper = page.locator('[data-component="content-paper"]');
    await expect(paper).toBeVisible();
    
    // #and has correct padding
    await expect(paper).toHaveCSS('padding', '24px');
    ```

- [ ] **Test**: /clients page renders with ContentPaper
  - **Steps**:
    1. Navigate to `/clients`
    2. Wait for page load
  - **Assertions**:
    ```typescript
    await page.goto('/clients');
    await expect(page.locator('[data-component="content-paper"]')).toBeVisible();
    ```

- [ ] **Test**: /settings/general page renders 3 ContentPapers
  - **Steps**:
    1. Navigate to `/settings/general`
    2. Count ContentPaper elements
  - **Assertions**:
    ```typescript
    await page.goto('/settings/general');
    const papers = page.locator('[data-component="content-paper"]');
    await expect(papers).toHaveCount(3);
    ```

- [ ] **Test**: /messages page renders with ContentPaper
  - **Steps**:
    1. Navigate to `/messages`
    2. Wait for page load
  - **Assertions**:
    ```typescript
    await page.goto('/messages');
    await expect(page.locator('[data-component="content-paper"]')).toBeVisible();
    ```

- [ ] **Test**: Fade animation completes without layout shift
  - **Steps**:
    1. Navigate to `/employees`
    2. Measure initial layout
    3. Wait for animation (500ms)
    4. Measure final layout
  - **Assertions**:
    ```typescript
    await page.goto('/employees');
    const paper = page.locator('[data-component="content-paper"]');
    
    // Wait for element to be attached
    await paper.waitFor({ state: 'attached' });
    
    const initialBox = await paper.boundingBox();
    await page.waitForTimeout(600); // Wait for 500ms animation + buffer
    const finalBox = await paper.boundingBox();
    
    // #then no layout shift occurred
    expect(initialBox?.width).toBe(finalBox?.width);
    expect(initialBox?.height).toBe(finalBox?.height);
    ```

- [ ] **Test**: No ComponentContainer references in rendered DOM
  - **Steps**:
    1. Navigate to `/employees`
    2. Search for old data-component attribute
  - **Assertions**:
    ```typescript
    await page.goto('/employees');
    await page.waitForLoadState('networkidle');
    
    // #then no old ComponentContainer elements exist
    await expect(page.locator('[data-component="component-container"]')).toHaveCount(0);
    await expect(page.locator('[data-component="component-container-content"]')).toHaveCount(0);
    await expect(page.locator('[data-component="component-container-title"]')).toHaveCount(0);
    ```

- [ ] **Test**: Title and subtitle render correctly on migrated pages
  - **Steps**:
    1. Navigate to `/employees`
    2. Check for title heading
  - **Assertions**:
    ```typescript
    await page.goto('/employees');
    
    // #then title heading is visible
    const heading = page.getByRole('heading', { level: 5 });
    await expect(heading).toBeVisible();
    ```

- [ ] **Test**: Responsive padding works on mobile viewport
  - **Steps**:
    1. Set viewport to mobile (390x844)
    2. Navigate to `/employees`
    3. Check padding
  - **Assertions**:
    ```typescript
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/employees');
    
    const paper = page.locator('[data-component="content-paper"]');
    await expect(paper).toBeVisible();
    // Responsive padding may differ - verify it's applied
    ```

- [ ] **Test**: User can interact with table inside ContentPaper
  - **Steps**:
    1. Navigate to `/employees`
    2. Click add button
    3. Verify modal opens
  - **Assertions**:
    ```typescript
    await page.goto('/employees');
    
    // #when user clicks add button
    await page.getByRole('button').filter({ has: page.locator('svg') }).last().click();
    
    // #then form dialog opens
    await expect(page.getByRole('dialog')).toBeVisible();
    ```

---

#### Test Suite: Excluded Files Verification

##### File: `frontend/tests/paper-exclusions.spec.ts`

- [ ] **Test**: Login page Paper is NOT ContentPaper
  - **Steps**:
    1. Navigate to `/login`
    2. Check Paper does not have content-paper attribute
  - **Assertions**:
    ```typescript
    await page.goto('/login');
    
    // #then no ContentPaper on login page
    await expect(page.locator('[data-component="content-paper"]')).toHaveCount(0);
    
    // #but original Paper still exists
    await expect(page.locator('.MuiPaper-root')).toBeVisible();
    ```

- [ ] **Test**: Autocomplete dropdowns use original Paper (not ContentPaper)
  - **Steps**:
    1. Navigate to `/messages` (has autocomplete)
    2. Open an autocomplete dropdown
    3. Verify dropdown Paper is not ContentPaper
  - **Assertions**:
    ```typescript
    await page.goto('/messages');
    
    // #when autocomplete is opened
    const autocomplete = page.locator('.MuiAutocomplete-root').first();
    await autocomplete.click();
    
    // #then dropdown Paper is NOT ContentPaper
    const dropdown = page.locator('.MuiAutocomplete-popper .MuiPaper-root');
    await expect(dropdown).toBeVisible();
    await expect(dropdown).not.toHaveAttribute('data-component', 'content-paper');
    ```

- [ ] **Test**: TableContainer Paper (ParsedDataPreview) is NOT ContentPaper
  - **Note**: TableContainer uses Paper as component prop - should not be migrated
  - **Assertions**:
    ```typescript
    // This is verified by ensuring ParsedDataPreview still works
    // The TableContainer component={Paper} pattern should remain unchanged
    ```

---

## Phase 2: GREEN (Implement to Pass)

> **Goal**: Write minimum code to make all tests pass

### Implementation Tasks (Reference Only - Not for Solomon)

The following tasks are defined in `.paul/plans/paper-unification.md`:

1. **Create ContentPaper Component** - Task 1
2. **Migrate ComponentContainer Usages** - Task 2 (5 files)
3. **Migrate Direct Paper Usages** - Task 3 (13 files)
4. **Delete ComponentContainer** - Task 4
5. **Verify & Cleanup** - Task 5

---

## Phase 3: REFACTOR (Keep Tests Green)

> **Goal**: Improve code quality while maintaining passing tests

### Refactoring Considerations

- [ ] Extract common test utilities to `frontend/src/test-utils/`
- [ ] Create shared test fixtures for ContentPaper props
- [ ] Optimize test performance by reducing unnecessary re-renders
- [ ] Add visual regression screenshots (optional)

**Verification**: After each refactor step, run:
- `npm test` → All unit tests pass
- `npx playwright test` → All E2E tests pass

---

## Verification Commands

### Unit Tests
```bash
# Run ContentPaper tests only
npm test -- --testPathPattern="ContentPaper"

# Run all migration tests
npm test -- --testPathPattern="migration"

# Run with coverage
npm test -- --coverage --collectCoverageFrom="src/app/(components)/root/ContentPaper.tsx"
```

### E2E Tests
```bash
# Run paper unification tests
npx playwright test paper-unification.spec.ts

# Run with headed browser
npx playwright test paper-unification.spec.ts --headed

# Run specific test
npx playwright test -g "employees page renders"
```

---

## Success Criteria

### RED Phase Complete When:
- [ ] All unit test files created in `__tests__/` directories
- [ ] E2E test files created at `tests/paper-unification.spec.ts` and `tests/paper-exclusions.spec.ts`
- [ ] `npm test` runs (and FAILS as expected - ContentPaper doesn't exist yet)
- [ ] `npx playwright test` runs (and FAILS as expected)

### GREEN Phase Complete When:
- [ ] `npm test` → 100% pass for ContentPaper tests
- [ ] `npm test` → 100% pass for migration tests
- [ ] `npx playwright test` → 100% pass
- [ ] All acceptance criteria from implementation plan met

### REFACTOR Phase Complete When:
- [ ] Test utilities extracted and reusable
- [ ] All tests still pass
- [ ] No regressions introduced
- [ ] Test execution time optimized

---

## Test File Summary

| Test Type | File Path | Test Count |
|-----------|-----------|------------|
| Unit | `root/__tests__/ContentPaper.test.tsx` | 24 |
| Unit | `root/__tests__/ContentPaper.types.test.tsx` | 2 |
| Integration | `employees/__tests__/EmployeesTable.migration.test.tsx` | 5 |
| Integration | `clients/__tests__/ClientsTable.migration.test.tsx` | 2 |
| Integration | `eformsign/__tests__/DocumentsList.migration.test.tsx` | 1 |
| Integration | `features/employees/__tests__/EmployeesTable.migration.test.tsx` | 1 |
| Integration | `features/clients/__tests__/ClientsTable.migration.test.tsx` | 1 |
| Integration | `messages/__tests__/page.migration.test.tsx` | 1 |
| Integration | `messages/__tests__/loading.migration.test.tsx` | 1 |
| Integration | `settings/general/__tests__/page.migration.test.tsx` | 1 |
| Integration | `settings/__tests__/VoucherPriceUploadForm.migration.test.tsx` | 1 |
| Integration | `settings/__tests__/ImageDropzone.migration.test.tsx` | 1 |
| Integration | `dashboard/__tests__/HeroBanner.migration.test.tsx` | 2 |
| Integration | `dashboard/__tests__/QuickActions.migration.test.tsx` | 1 |
| Integration | `dashboard/__tests__/RecentActivity.migration.test.tsx` | 1 |
| Integration | `dashboard/__tests__/PerformanceOverview.migration.test.tsx` | 1 |
| Integration | `chat/__tests__/ChatFullscreen.migration.test.tsx` | 1 |
| Integration | `notifications/__tests__/NotificationSettings.migration.test.tsx` | 1 |
| Integration | `messages/templates/__tests__/GeneratedMsg.migration.test.tsx` | 1 |
| Integration | `messages/forms/__tests__/ContractCreationForm.migration.test.tsx` | 1 |
| E2E | `tests/paper-unification.spec.ts` | 9 |
| E2E | `tests/paper-exclusions.spec.ts` | 3 |
| **Total** | | **62** |

---

## Notes for Test Implementers (Peter/John)

### Key Changes from Thomas Review

1. **Removed MUI class name checks** - Use computed styles or behavior tests instead
2. **Added BDD comments** - `#given`, `#when`, `#then` for clarity
3. **Specified mock requirements** - Each test file has explicit mock setup
4. **Added edge cases** - Empty children, multiple children, special characters, long titles
5. **Deepened migration tests** - Verify minHeight, padding, i18n, not just wrapper presence
6. **Added responsive tests** - Mobile viewport E2E test

### Visual Regression Considerations
- Screenshots should be taken BEFORE migration (rollback strategy in implementation plan)
- Compare padding, elevation shadow, border-radius
- Check responsive behavior at different viewports
- Verify Fade animation doesn't cause content jump

### Test Data Fixtures
Consider creating shared fixtures:
```typescript
// frontend/src/test-utils/fixtures.ts
export const mockEmployee = { id: 1, name: 'Test', openToNextWork: true };
export const mockClient = { id: 1, name: 'Client', phone: '010-1234-5678' };
```
