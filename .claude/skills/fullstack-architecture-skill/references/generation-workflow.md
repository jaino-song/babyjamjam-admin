# Code Generation Workflow

요구사항을 실제 코드로 변환하는 상세 워크플로우.

## Phase 1: 요구사항 파싱

### 입력 분석 체크리스트

```
□ Routes 추출 (페이지/화면 목록)
□ Features 추출 (기능 목록)
□ Entities 추출 (데이터 모델)
□ Auth 필요 여부 (로그인, OAuth)
□ Platforms (web / mobile / both)
□ External Services (결제, 알림 등)
```

### 예시 파싱

**입력:**
```
Todo 앱 만들어줘
- 할 일 추가/수정/삭제
- 완료 체크
- 카테고리 분류
- 카카오 로그인
- 웹이랑 앱 둘 다
```

**파싱 결과:**
```yaml
project:
  name: todo-app
  platforms: [web, mobile]

routes:
  public:
    - path: /login
      description: 로그인 페이지
  protected:
    - path: /
      description: Todo 목록 (메인)
    - path: /categories
      description: 카테고리 관리

features:
  - name: auth
    type: oauth
    providers: [kakao]
  - name: todos
    operations: [create, read, update, delete]
  - name: categories
    operations: [create, read, update, delete]

entities:
  - name: User
    fields:
      - id: string
      - email: string
      - name: string
      - profileImage: string?
  - name: Todo
    fields:
      - id: string
      - title: string
      - completed: boolean
      - categoryId: string?
      - userId: string
      - createdAt: Date
  - name: Category
    fields:
      - id: string
      - name: string
      - color: string
      - userId: string
```

## Phase 2: 파일 생성 순서

**폴더 최상위 이름:** 프로젝트명을 kebab-case로 변환 (예: `todo-app/`, `fiterview/`)

### 2.1 Shared Packages (먼저)

```
{project-name}/
└── packages/
    ├── types/
    │   └── src/
    │       ├── index.ts
    │       ├── user.ts
    │       ├── todo.ts
    │       └── category.ts
    └── validators/
        └── src/
            ├── index.ts
            ├── auth.schema.ts
            ├── todo.schema.ts
            └── category.schema.ts
```

### 2.2 Backend

```
{project-name}/
└── apps/backend/src/modules/
    ├── auth/
    │   ├── domain/
    │   │   └── entities/user.entity.ts
    │   ├── application/
    │   │   ├── commands/
    │   │   └── queries/
    │   ├── infrastructure/
    │   │   └── persistence/
    │   └── presentation/
    │       ├── auth.controller.ts
    │       └── dtos/
    ├── todos/
    │   ├── domain/
    │   ├── application/
    │   ├── infrastructure/
    │   └── presentation/
    └── categories/
        └── ...
```

### 2.3 Frontend (Web)

```
{project-name}/
└── apps/web/src/
    ├── app/
    │   ├── (auth)/
    │   │   └── login/
    │   │       └── page.tsx
    │   ├── (main)/
    │   │   ├── layout.tsx
    │   │   ├── page.tsx              # Todo 목록
    │   │   └── categories/
    │   │       └── page.tsx
    │   └── layout.tsx
    ├── features/
    │   ├── auth/
    │   │   ├── components/
    │   │   │   └── LoginForm.tsx
    │   │   └── hooks/
    │   │       └── useAuth.ts
    │   ├── todos/
    │   │   ├── components/
    │   │   │   ├── TodoList.tsx
    │   │   │   ├── TodoItem.tsx
    │   │   │   └── TodoForm.tsx
    │   │   └── hooks/
    │   │       └── useTodos.ts
    │   └── categories/
    │       └── ...
    └── e2e/
        ├── pages/
        │   ├── login.page.ts
        │   └── todo.page.ts
        └── tests/
            ├── auth.spec.ts
            └── todos.spec.ts
```

### 2.4 Frontend (Mobile)

```
{project-name}/
└── apps/mobile/src/
    ├── app/
    │   ├── (auth)/
    │   │   └── login.tsx
    │   ├── (tabs)/
    │   │   ├── _layout.tsx
    │   │   ├── index.tsx            # Todo 목록
    │   │   └── categories.tsx
    │   └── _layout.tsx
    └── features/
        ├── auth/
        ├── todos/
        └── categories/
```

## Phase 3: 코드 템플릿

### 3.1 Shared Types

```typescript
// packages/types/src/todo.ts
export interface Todo {
  id: string;
  title: string;
  completed: boolean;
  categoryId: string | null;
  userId: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateTodoInput {
  title: string;
  categoryId?: string;
}

export interface UpdateTodoInput {
  title?: string;
  completed?: boolean;
  categoryId?: string | null;
}

export interface TodosResponse {
  todos: Todo[];
  total: number;
}
```

### 3.2 Zod Validators

```typescript
// packages/validators/src/todo.schema.ts
import { z } from 'zod';

export const createTodoSchema = z.object({
  title: z.string().min(1, '제목을 입력해주세요').max(200),
  categoryId: z.string().uuid().optional(),
});

export const updateTodoSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  completed: z.boolean().optional(),
  categoryId: z.string().uuid().nullable().optional(),
});

export type CreateTodoInput = z.infer<typeof createTodoSchema>;
export type UpdateTodoInput = z.infer<typeof updateTodoSchema>;
```

### 3.3 Backend Entity

```typescript
// apps/backend/src/modules/todos/domain/entities/todo.entity.ts
export class Todo {
  private constructor(
    private readonly _id: string,
    private _title: string,
    private _completed: boolean,
    private _categoryId: string | null,
    private readonly _userId: string,
    private readonly _createdAt: Date,
    private _updatedAt: Date,
  ) {}

  static create(props: {
    title: string;
    userId: string;
    categoryId?: string;
  }): Todo {
    return new Todo(
      crypto.randomUUID(),
      props.title,
      false,
      props.categoryId || null,
      props.userId,
      new Date(),
      new Date(),
    );
  }

  complete(): void {
    this._completed = true;
    this._updatedAt = new Date();
  }

  uncomplete(): void {
    this._completed = false;
    this._updatedAt = new Date();
  }

  updateTitle(title: string): void {
    this._title = title;
    this._updatedAt = new Date();
  }

  // Getters
  get id() { return this._id; }
  get title() { return this._title; }
  get completed() { return this._completed; }
  get categoryId() { return this._categoryId; }
  get userId() { return this._userId; }
  get createdAt() { return this._createdAt; }
  get updatedAt() { return this._updatedAt; }
}
```

### 3.4 Backend Controller

```typescript
// apps/backend/src/modules/todos/presentation/todos.controller.ts
@Controller('todos')
@UseGuards(JwtGuard)
export class TodosController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  async findAll(@CurrentUser() user: UserPayload): Promise<TodosResponse> {
    return this.queryBus.execute(new GetTodosQuery(user.id));
  }

  @Post()
  async create(
    @Body() dto: CreateTodoDto,
    @CurrentUser() user: UserPayload,
  ): Promise<Todo> {
    return this.commandBus.execute(
      new CreateTodoCommand(dto.title, user.id, dto.categoryId),
    );
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: UpdateTodoDto,
    @CurrentUser() user: UserPayload,
  ): Promise<Todo> {
    return this.commandBus.execute(
      new UpdateTodoCommand(id, user.id, dto),
    );
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload,
  ): Promise<void> {
    return this.commandBus.execute(new DeleteTodoCommand(id, user.id));
  }
}
```

### 3.5 Frontend Component

```typescript
// apps/web/src/features/todos/components/TodoItem.tsx
'use client';

import { motion } from 'framer-motion';
import { Check, Trash2, Edit2 } from 'lucide-react';
import { Button } from '@/shared/components/atoms/Button';
import { Text } from '@/shared/components/atoms/Text';
import { cn } from '@/shared/lib/utils';
import type { Todo } from '@repo/types';

interface TodoItemProps {
  todo: Todo;
  onToggle: (id: string) => void;
  onDelete: (id: string) => void;
  onEdit: (todo: Todo) => void;
}

export function TodoItem({ todo, onToggle, onDelete, onEdit }: TodoItemProps) {
  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -100 }}
      className="flex items-center gap-3 p-4 bg-white rounded-lg shadow-sm"
      data-testid={`todo-item-${todo.id}`}
    >
      <Button
        variant="ghost"
        size="sm"
        onClick={() => onToggle(todo.id)}
        testId={`todo-toggle-${todo.id}`}
        className={cn(
          'rounded-full w-8 h-8 p-0',
          todo.completed && 'bg-success text-white'
        )}
      >
        {todo.completed && <Check className="w-4 h-4" />}
      </Button>

      <Text
        className={cn('flex-1', todo.completed && 'line-through text-gray-400')}
        testId={`todo-title-${todo.id}`}
      >
        {todo.title}
      </Text>

      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onEdit(todo)}
          testId={`todo-edit-${todo.id}`}
        >
          <Edit2 className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => onDelete(todo.id)}
          testId={`todo-delete-${todo.id}`}
        >
          <Trash2 className="w-4 h-4 text-error" />
        </Button>
      </div>
    </motion.div>
  );
}
```

### 3.6 Frontend Hook

```typescript
// apps/web/src/features/todos/hooks/useTodos.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/core/api';
import { useUIStore } from '@/core/stores/ui.store';
import type { CreateTodoInput, UpdateTodoInput } from '@repo/types';

export const todoKeys = {
  all: ['todos'] as const,
  list: () => [...todoKeys.all, 'list'] as const,
};

export function useTodos() {
  return useQuery({
    queryKey: todoKeys.list(),
    queryFn: () => api.todos.getAll(),
  });
}

export function useCreateTodo() {
  const queryClient = useQueryClient();
  const { addToast } = useUIStore();

  return useMutation({
    mutationFn: (data: CreateTodoInput) => api.todos.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todoKeys.all });
      addToast({ type: 'success', title: '할 일이 추가되었습니다' });
    },
    onError: () => {
      addToast({ type: 'error', title: '추가에 실패했습니다' });
    },
  });
}

export function useUpdateTodo() {
  const queryClient = useQueryClient();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: UpdateTodoInput }) =>
      api.todos.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todoKeys.all });
    },
  });
}

export function useDeleteTodo() {
  const queryClient = useQueryClient();
  const { addToast } = useUIStore();

  return useMutation({
    mutationFn: (id: string) => api.todos.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: todoKeys.all });
      addToast({ type: 'success', title: '삭제되었습니다' });
    },
  });
}
```

### 3.7 E2E Page Object

```typescript
// apps/web/e2e/pages/todo.page.ts
import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class TodoPage extends BasePage {
  readonly todoInput: Locator;
  readonly addButton: Locator;
  readonly todoList: Locator;

  constructor(page: Page) {
    super(page);
    this.todoInput = this.getByTestId('todo-input');
    this.addButton = this.getByTestId('todo-add-button');
    this.todoList = this.getByTestId('todo-list');
  }

  async goto() {
    await this.page.goto('/');
    await this.waitForPageLoad();
  }

  async addTodo(title: string) {
    await this.todoInput.fill(title);
    await this.addButton.click();
  }

  async toggleTodo(id: string) {
    await this.getByTestId(`todo-toggle-${id}`).click();
  }

  async deleteTodo(id: string) {
    await this.getByTestId(`todo-delete-${id}`).click();
  }

  async getTodoItem(id: string): Promise<Locator> {
    return this.getByTestId(`todo-item-${id}`);
  }

  async expectTodoCount(count: number) {
    const items = this.page.locator('[data-testid^="todo-item-"]');
    await expect(items).toHaveCount(count);
  }

  async expectTodoCompleted(id: string, completed: boolean) {
    const toggle = this.getByTestId(`todo-toggle-${id}`);
    if (completed) {
      await expect(toggle).toHaveClass(/bg-success/);
    } else {
      await expect(toggle).not.toHaveClass(/bg-success/);
    }
  }
}
```

### 3.8 E2E Test

```typescript
// apps/web/e2e/tests/todos.spec.ts
import { test, expect } from '../fixtures/auth.fixture';
import { TodoPage } from '../pages/todo.page';

test.describe('Todos', () => {
  let todoPage: TodoPage;

  test.beforeEach(async ({ authenticatedPage }) => {
    todoPage = new TodoPage(authenticatedPage);
    await todoPage.goto();
  });

  test('should display empty state initially', async () => {
    await todoPage.expectTodoCount(0);
  });

  test('should add a new todo', async () => {
    await todoPage.addTodo('새로운 할 일');
    
    await todoPage.expectTodoCount(1);
    await expect(todoPage.page.getByText('새로운 할 일')).toBeVisible();
  });

  test('should toggle todo completion', async () => {
    // Setup: Add a todo
    await todoPage.addTodo('테스트 할 일');
    
    // Get the todo ID from the DOM
    const todoItem = todoPage.page.locator('[data-testid^="todo-item-"]').first();
    const testId = await todoItem.getAttribute('data-testid');
    const todoId = testId?.replace('todo-item-', '');

    // Toggle
    await todoPage.toggleTodo(todoId!);
    await todoPage.expectTodoCompleted(todoId!, true);

    // Toggle back
    await todoPage.toggleTodo(todoId!);
    await todoPage.expectTodoCompleted(todoId!, false);
  });

  test('should delete a todo', async () => {
    await todoPage.addTodo('삭제할 할 일');
    await todoPage.expectTodoCount(1);

    const todoItem = todoPage.page.locator('[data-testid^="todo-item-"]').first();
    const testId = await todoItem.getAttribute('data-testid');
    const todoId = testId?.replace('todo-item-', '');

    await todoPage.deleteTodo(todoId!);
    await todoPage.expectTodoCount(0);
  });
});
```

## Phase 4: 생성 체크리스트

### Backend
```
□ Prisma Schema 생성/업데이트
□ Entity 생성
□ Repository Interface 정의
□ Repository Implementation
□ Commands & Queries
□ Handlers
□ Controller
□ DTOs
□ Module 등록
□ Integration Tests
```

### Frontend (Web)
```
□ Route 페이지 생성
□ Feature 폴더 구조
□ Components (testId 포함)
□ Hooks (TanStack Query)
□ API Service
□ Types import
□ Zod validation 연동
□ E2E Page Objects
□ E2E Tests
```

### Frontend (Mobile)
```
□ Expo Router 스크린
□ Feature 폴더 구조
□ Components (재사용)
□ Hooks (공유 가능하면 packages로)
□ Navigation 설정
□ Deep Link 설정 (필요시)
```

### Shared
```
□ Types 정의
□ Zod Schemas
□ API Client 메서드 추가
□ Constants (필요시)
```
