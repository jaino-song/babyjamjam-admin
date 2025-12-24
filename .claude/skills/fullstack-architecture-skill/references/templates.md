# Code Templates

실제 코드 생성 시 사용하는 템플릿 모음.

## 1. Prisma Schema

```prisma
// prisma/schema.prisma

generator client {
  provider = "prisma-client-js"
}

datasource db {
  provider = "postgresql"
  url      = env("DATABASE_URL")
}

model User {
  id           String    @id @default(uuid())
  email        String    @unique
  name         String
  profileImage String?
  provider     String    // kakao, naver, google, email
  providerId   String?
  createdAt    DateTime  @default(now())
  updatedAt    DateTime  @updatedAt

  // Relations
  todos      Todo[]
  categories Category[]

  @@map("users")
}

model Todo {
  id          String    @id @default(uuid())
  title       String
  completed   Boolean   @default(false)
  userId      String
  categoryId  String?
  createdAt   DateTime  @default(now())
  updatedAt   DateTime  @updatedAt

  // Relations
  user     User      @relation(fields: [userId], references: [id], onDelete: Cascade)
  category Category? @relation(fields: [categoryId], references: [id], onDelete: SetNull)

  @@index([userId])
  @@index([categoryId])
  @@map("todos")
}

model Category {
  id        String   @id @default(uuid())
  name      String
  color     String   @default("#3b82f6")
  userId    String
  createdAt DateTime @default(now())
  updatedAt DateTime @updatedAt

  // Relations
  user  User   @relation(fields: [userId], references: [id], onDelete: Cascade)
  todos Todo[]

  @@unique([userId, name])
  @@map("categories")
}
```

## 2. Backend Module Template

### 2.1 Module Structure

```
modules/
└── {feature}/
    ├── domain/
    │   ├── entities/
    │   │   └── {feature}.entity.ts
    │   ├── repositories/
    │   │   └── {feature}.repository.interface.ts
    │   └── events/
    │       └── {feature}-created.event.ts
    ├── application/
    │   ├── commands/
    │   │   ├── create-{feature}.command.ts
    │   │   ├── update-{feature}.command.ts
    │   │   └── delete-{feature}.command.ts
    │   ├── queries/
    │   │   ├── get-{feature}.query.ts
    │   │   └── get-{features}.query.ts
    │   └── handlers/
    │       ├── create-{feature}.handler.ts
    │       └── ...
    ├── infrastructure/
    │   └── persistence/
    │       └── prisma-{feature}.repository.ts
    ├── presentation/
    │   ├── {feature}.controller.ts
    │   └── dtos/
    │       ├── create-{feature}.dto.ts
    │       └── update-{feature}.dto.ts
    └── {feature}.module.ts
```

### 2.2 Module File

```typescript
// modules/{feature}/{feature}.module.ts
import { Module } from '@nestjs/common';
import { CqrsModule } from '@nestjs/cqrs';
import { {Feature}Controller } from './presentation/{feature}.controller';
import { Create{Feature}Handler } from './application/handlers/create-{feature}.handler';
import { Update{Feature}Handler } from './application/handlers/update-{feature}.handler';
import { Delete{Feature}Handler } from './application/handlers/delete-{feature}.handler';
import { Get{Feature}Handler } from './application/handlers/get-{feature}.handler';
import { Get{Features}Handler } from './application/handlers/get-{features}.handler';
import { Prisma{Feature}Repository } from './infrastructure/persistence/prisma-{feature}.repository';

const CommandHandlers = [
  Create{Feature}Handler,
  Update{Feature}Handler,
  Delete{Feature}Handler,
];

const QueryHandlers = [
  Get{Feature}Handler,
  Get{Features}Handler,
];

@Module({
  imports: [CqrsModule],
  controllers: [{Feature}Controller],
  providers: [
    ...CommandHandlers,
    ...QueryHandlers,
    {
      provide: '{Feature}Repository',
      useClass: Prisma{Feature}Repository,
    },
  ],
  exports: ['{Feature}Repository'],
})
export class {Feature}Module {}
```

### 2.3 Controller Template

```typescript
// modules/{feature}/presentation/{feature}.controller.ts
import {
  Controller,
  Get,
  Post,
  Patch,
  Delete,
  Body,
  Param,
  Query,
  UseGuards,
} from '@nestjs/common';
import { CommandBus, QueryBus } from '@nestjs/cqrs';
import { JwtGuard } from '@/core/guards/jwt.guard';
import { CurrentUser } from '@/core/decorators/current-user.decorator';
import { UserPayload } from '@/core/types';
import { Create{Feature}Command } from '../application/commands/create-{feature}.command';
import { Update{Feature}Command } from '../application/commands/update-{feature}.command';
import { Delete{Feature}Command } from '../application/commands/delete-{feature}.command';
import { Get{Feature}Query } from '../application/queries/get-{feature}.query';
import { Get{Features}Query } from '../application/queries/get-{features}.query';
import { Create{Feature}Dto } from './dtos/create-{feature}.dto';
import { Update{Feature}Dto } from './dtos/update-{feature}.dto';

@Controller('{features}')
@UseGuards(JwtGuard)
export class {Feature}Controller {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Get()
  async findAll(@CurrentUser() user: UserPayload) {
    return this.queryBus.execute(new Get{Features}Query(user.id));
  }

  @Get(':id')
  async findOne(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload,
  ) {
    return this.queryBus.execute(new Get{Feature}Query(id, user.id));
  }

  @Post()
  async create(
    @Body() dto: Create{Feature}Dto,
    @CurrentUser() user: UserPayload,
  ) {
    return this.commandBus.execute(
      new Create{Feature}Command({ ...dto, userId: user.id }),
    );
  }

  @Patch(':id')
  async update(
    @Param('id') id: string,
    @Body() dto: Update{Feature}Dto,
    @CurrentUser() user: UserPayload,
  ) {
    return this.commandBus.execute(
      new Update{Feature}Command(id, user.id, dto),
    );
  }

  @Delete(':id')
  async remove(
    @Param('id') id: string,
    @CurrentUser() user: UserPayload,
  ) {
    return this.commandBus.execute(new Delete{Feature}Command(id, user.id));
  }
}
```

### 2.4 DTO Template

```typescript
// modules/{feature}/presentation/dtos/create-{feature}.dto.ts
import { IsString, IsOptional, MaxLength, MinLength } from 'class-validator';

export class Create{Feature}Dto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsString()
  categoryId?: string;
}

// modules/{feature}/presentation/dtos/update-{feature}.dto.ts
import { IsString, IsOptional, IsBoolean, MaxLength, MinLength } from 'class-validator';

export class Update{Feature}Dto {
  @IsOptional()
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title?: string;

  @IsOptional()
  @IsBoolean()
  completed?: boolean;

  @IsOptional()
  @IsString()
  categoryId?: string | null;
}
```

## 3. Frontend Templates

### 3.1 Page Template

```typescript
// app/(main)/{feature}/page.tsx
import { Suspense } from 'react';
import { {Feature}List } from '@/features/{feature}/components/{Feature}List';
import { {Feature}ListSkeleton } from '@/features/{feature}/components/{Feature}ListSkeleton';
import { Text } from '@/shared/components/atoms/Text';

export default function {Feature}Page() {
  return (
    <div className="container mx-auto py-8 px-4">
      <div className="flex items-center justify-between mb-8">
        <Text variant="h2">{Features}</Text>
      </div>

      <Suspense fallback={<{Feature}ListSkeleton />}>
        <{Feature}List />
      </Suspense>
    </div>
  );
}
```

### 3.2 List Component Template

```typescript
// features/{feature}/components/{Feature}List.tsx
'use client';

import { AnimatePresence } from 'framer-motion';
import { use{Features} } from '../hooks/use{Features}';
import { {Feature}Item } from './{Feature}Item';
import { {Feature}Form } from './{Feature}Form';
import { {Feature}EmptyState } from './{Feature}EmptyState';
import { Spinner } from '@/shared/components/atoms/Spinner';

export function {Feature}List() {
  const { data, isLoading } = use{Features}();

  if (isLoading) {
    return (
      <div className="flex justify-center py-12">
        <Spinner size="lg" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <{Feature}Form />

      <div className="space-y-3" data-testid="{feature}-list">
        <AnimatePresence mode="popLayout">
          {data?.length === 0 ? (
            <{Feature}EmptyState />
          ) : (
            data?.map((item) => (
              <{Feature}Item key={item.id} {feature}={item} />
            ))
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
```

### 3.3 Item Component Template

```typescript
// features/{feature}/components/{Feature}Item.tsx
'use client';

import { motion } from 'framer-motion';
import { Trash2, Edit2 } from 'lucide-react';
import { Button } from '@/shared/components/atoms/Button';
import { Text } from '@/shared/components/atoms/Text';
import { useDelete{Feature} } from '../hooks/use{Features}';
import { useUIStore } from '@/core/stores/ui.store';
import type { {Feature} } from '@repo/types';

interface {Feature}ItemProps {
  {feature}: {Feature};
}

export function {Feature}Item({ {feature} }: {Feature}ItemProps) {
  const { mutate: delete{Feature} } = useDelete{Feature}();
  const { openModal } = useUIStore();

  const handleEdit = () => {
    openModal('edit-{feature}', { {feature} });
  };

  const handleDelete = () => {
    if (confirm('정말 삭제하시겠습니까?')) {
      delete{Feature}({feature}.id);
    }
  };

  return (
    <motion.div
      layout
      initial={{ opacity: 0, y: 10 }}
      animate={{ opacity: 1, y: 0 }}
      exit={{ opacity: 0, x: -100 }}
      className="flex items-center gap-3 p-4 bg-white rounded-lg shadow-sm"
      data-testid={`{feature}-item-${{feature}.id}`}
    >
      <Text className="flex-1" testId={`{feature}-title-${{feature}.id}`}>
        {{feature}.title}
      </Text>

      <div className="flex gap-1">
        <Button
          variant="ghost"
          size="sm"
          onClick={handleEdit}
          testId={`{feature}-edit-${{feature}.id}`}
        >
          <Edit2 className="w-4 h-4" />
        </Button>
        <Button
          variant="ghost"
          size="sm"
          onClick={handleDelete}
          testId={`{feature}-delete-${{feature}.id}`}
        >
          <Trash2 className="w-4 h-4 text-error" />
        </Button>
      </div>
    </motion.div>
  );
}
```

### 3.4 Form Component Template

```typescript
// features/{feature}/components/{Feature}Form.tsx
'use client';

import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { create{Feature}Schema, type Create{Feature}Input } from '@repo/validators';
import { InputField } from '@/shared/components/molecules/InputField';
import { Button } from '@/shared/components/atoms/Button';
import { useCreate{Feature} } from '../hooks/use{Features}';

export function {Feature}Form() {
  const { mutate: create, isPending } = useCreate{Feature}();

  const form = useForm<Create{Feature}Input>({
    resolver: zodResolver(create{Feature}Schema),
    defaultValues: { title: '' },
  });

  const onSubmit = (data: Create{Feature}Input) => {
    create(data, {
      onSuccess: () => form.reset(),
    });
  };

  return (
    <form onSubmit={form.handleSubmit(onSubmit)} className="flex gap-3">
      <div className="flex-1">
        <InputField
          placeholder="새로운 항목 추가..."
          error={form.formState.errors.title?.message}
          testId="{feature}-input"
          {...form.register('title')}
        />
      </div>
      <Button
        type="submit"
        loading={isPending}
        testId="{feature}-add-button"
      >
        추가
      </Button>
    </form>
  );
}
```

### 3.5 Hooks Template

```typescript
// features/{feature}/hooks/use{Features}.ts
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '@/core/api';
import { useUIStore } from '@/core/stores/ui.store';
import type { Create{Feature}Input, Update{Feature}Input } from '@repo/types';

export const {feature}Keys = {
  all: ['{features}'] as const,
  list: () => [...{feature}Keys.all, 'list'] as const,
  detail: (id: string) => [...{feature}Keys.all, 'detail', id] as const,
};

export function use{Features}() {
  return useQuery({
    queryKey: {feature}Keys.list(),
    queryFn: () => api.{features}.getAll(),
  });
}

export function use{Feature}(id: string) {
  return useQuery({
    queryKey: {feature}Keys.detail(id),
    queryFn: () => api.{features}.getById(id),
    enabled: !!id,
  });
}

export function useCreate{Feature}() {
  const queryClient = useQueryClient();
  const { addToast } = useUIStore();

  return useMutation({
    mutationFn: (data: Create{Feature}Input) => api.{features}.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: {feature}Keys.all });
      addToast({ type: 'success', title: '추가되었습니다' });
    },
    onError: () => {
      addToast({ type: 'error', title: '추가에 실패했습니다' });
    },
  });
}

export function useUpdate{Feature}() {
  const queryClient = useQueryClient();
  const { addToast } = useUIStore();

  return useMutation({
    mutationFn: ({ id, data }: { id: string; data: Update{Feature}Input }) =>
      api.{features}.update(id, data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: {feature}Keys.all });
      addToast({ type: 'success', title: '수정되었습니다' });
    },
  });
}

export function useDelete{Feature}() {
  const queryClient = useQueryClient();
  const { addToast } = useUIStore();

  return useMutation({
    mutationFn: (id: string) => api.{features}.delete(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: {feature}Keys.all });
      addToast({ type: 'success', title: '삭제되었습니다' });
    },
  });
}
```

### 3.6 API Service Template

```typescript
// core/api/services/{feature}.api.ts
import apiClient from '../axios';
import type {
  {Feature},
  Create{Feature}Input,
  Update{Feature}Input,
  {Features}Response,
} from '@repo/types';

export const {features}Api = {
  getAll: async (): Promise<{Feature}[]> => {
    const response = await apiClient.get('/{features}');
    return response.data;
  },

  getById: async (id: string): Promise<{Feature}> => {
    const response = await apiClient.get(`/{features}/${id}`);
    return response.data;
  },

  create: async (data: Create{Feature}Input): Promise<{Feature}> => {
    const response = await apiClient.post('/{features}', data);
    return response.data;
  },

  update: async (id: string, data: Update{Feature}Input): Promise<{Feature}> => {
    const response = await apiClient.patch(`/{features}/${id}`, data);
    return response.data;
  },

  delete: async (id: string): Promise<void> => {
    await apiClient.delete(`/{features}/${id}`);
  },
};
```

## 4. E2E Test Templates

### 4.1 Page Object Template

```typescript
// e2e/pages/{feature}.page.ts
import { Page, Locator, expect } from '@playwright/test';
import { BasePage } from './base.page';

export class {Feature}Page extends BasePage {
  readonly input: Locator;
  readonly addButton: Locator;
  readonly list: Locator;

  constructor(page: Page) {
    super(page);
    this.input = this.getByTestId('{feature}-input');
    this.addButton = this.getByTestId('{feature}-add-button');
    this.list = this.getByTestId('{feature}-list');
  }

  async goto() {
    await this.page.goto('/{features}');
    await this.waitForPageLoad();
  }

  async add{Feature}(title: string) {
    await this.input.fill(title);
    await this.addButton.click();
  }

  async edit{Feature}(id: string) {
    await this.getByTestId(`{feature}-edit-${id}`).click();
  }

  async delete{Feature}(id: string) {
    await this.getByTestId(`{feature}-delete-${id}`).click();
  }

  async getItem(id: string): Promise<Locator> {
    return this.getByTestId(`{feature}-item-${id}`);
  }

  async expectCount(count: number) {
    const items = this.page.locator('[data-testid^="{feature}-item-"]');
    await expect(items).toHaveCount(count);
  }
}
```

### 4.2 Test Template

```typescript
// e2e/tests/{feature}.spec.ts
import { test, expect } from '../fixtures/auth.fixture';
import { {Feature}Page } from '../pages/{feature}.page';

test.describe('{Features}', () => {
  let {feature}Page: {Feature}Page;

  test.beforeEach(async ({ authenticatedPage }) => {
    {feature}Page = new {Feature}Page(authenticatedPage);
    await {feature}Page.goto();
  });

  test('should display empty state initially', async () => {
    await {feature}Page.expectCount(0);
  });

  test('should add a new {feature}', async () => {
    await {feature}Page.add{Feature}('테스트 항목');
    await {feature}Page.expectCount(1);
    await expect({feature}Page.page.getByText('테스트 항목')).toBeVisible();
  });

  test('should delete a {feature}', async () => {
    // Setup
    await {feature}Page.add{Feature}('삭제할 항목');
    await {feature}Page.expectCount(1);

    // Get ID
    const item = {feature}Page.page.locator('[data-testid^="{feature}-item-"]').first();
    const testId = await item.getAttribute('data-testid');
    const id = testId?.replace('{feature}-item-', '');

    // Delete
    await {feature}Page.delete{Feature}(id!);
    
    // Confirm dialog
    {feature}Page.page.on('dialog', dialog => dialog.accept());
    
    await {feature}Page.expectCount(0);
  });
});
```

## 5. Mobile Templates (Expo)

### 5.1 Screen Template

```typescript
// app/(tabs)/{features}.tsx
import { View, FlatList, RefreshControl } from 'react-native';
import { use{Features} } from '@/features/{feature}/hooks/use{Features}';
import { {Feature}Item } from '@/features/{feature}/components/{Feature}Item';
import { {Feature}Form } from '@/features/{feature}/components/{Feature}Form';
import { Text } from '@/shared/components/Text';
import { Spinner } from '@/shared/components/Spinner';

export default function {Features}Screen() {
  const { data, isLoading, refetch, isRefetching } = use{Features}();

  if (isLoading) {
    return (
      <View className="flex-1 items-center justify-center">
        <Spinner />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-gray-50">
      <FlatList
        data={data}
        keyExtractor={(item) => item.id}
        renderItem={({ item }) => <{Feature}Item {feature}={item} />}
        ListHeaderComponent={<{Feature}Form />}
        ListEmptyComponent={
          <View className="py-12 items-center">
            <Text className="text-gray-400">항목이 없습니다</Text>
          </View>
        }
        refreshControl={
          <RefreshControl refreshing={isRefetching} onRefresh={refetch} />
        }
        contentContainerStyle={{ padding: 16, gap: 12 }}
      />
    </View>
  );
}
```
