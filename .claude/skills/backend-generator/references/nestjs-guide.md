# NestJS Backend Architect Skill

> ✅ **필수 백엔드**: 이 프로젝트는 반드시 NestJS를 메인 백엔드로 사용합니다.
> Supabase, Firebase 등은 보조 서비스로만 사용 가능합니다.

> **역할**: NestJS 백엔드 모듈 구현 전문가
> **담당**: Domain → Application → Infrastructure → Presentation 레이어 코드 생성

---

## 🎯 사용 시점 (Trigger)

이 skill을 사용하는 경우:
- "Backend Phase 시작해줘"
- "User 모듈 구현해줘"  
- "{Entity} API 만들어줘"
- implementation-plan.md 확정 후 Backend 구현 시
- **모든 백엔드 구현 요청** (NestJS 필수)

---

## 📥 Input (필수 정보)

### 반드시 확인해야 할 것

```
□ docs/implementation-plan.md 존재 여부
  └─ Data Models 섹션 (Entity 정의)
  └─ API Endpoints 섹션 (필요한 API 목록)
  └─ Status Flows 섹션 (상태 전이 있는 경우)

□ prisma/schema.prisma 존재 여부
  └─ 없으면 Data Models 기반으로 먼저 생성

□ 구현할 Entity 이름
```

### Input 예시

```yaml
# implementation-plan.md에서 추출
Entity: Todo
Fields:
  - id: string (UUID)
  - title: string
  - completed: boolean
  - userId: string (FK)
  - categoryId: string? (FK, nullable)
  - createdAt: Date
  - updatedAt: Date

API:
  - POST /todos (create)
  - GET /todos (list, with pagination)
  - GET /todos/:id (detail)
  - PATCH /todos/:id (update)
  - DELETE /todos/:id (delete)
  - PATCH /todos/:id/complete (toggle complete)
```

---

## 📤 Output (생성해야 할 파일)

### Entity당 생성 파일 목록

```
src/modules/{entity}/
├── domain/
│   ├── entities/
│   │   └── {entity}.entity.ts           ← Step 1
│   ├── value-objects/
│   │   └── {entity}-id.vo.ts            ← Step 1
│   ├── repositories/
│   │   └── {entity}.repository.interface.ts  ← Step 2
│   └── exceptions/
│       └── {entity}-not-found.exception.ts   ← Step 2
├── application/
│   ├── commands/
│   │   ├── create-{entity}.command.ts   ← Step 3
│   │   ├── update-{entity}.command.ts
│   │   └── delete-{entity}.command.ts
│   ├── queries/
│   │   ├── get-{entity}.query.ts        ← Step 3
│   │   └── list-{entity}.query.ts
│   ├── handlers/
│   │   ├── create-{entity}.handler.ts   ← Step 4
│   │   ├── update-{entity}.handler.ts
│   │   ├── delete-{entity}.handler.ts
│   │   ├── get-{entity}.handler.ts
│   │   └── list-{entity}.handler.ts
│   └── dtos/
│       ├── create-{entity}.dto.ts       ← Step 3
│       ├── update-{entity}.dto.ts
│       └── {entity}.response.dto.ts
├── infrastructure/
│   └── persistence/
│       ├── prisma-{entity}.repository.ts  ← Step 5
│       └── {entity}.mapper.ts             ← Step 5
├── presentation/
│   └── controllers/
│       └── {entity}.controller.ts       ← Step 6
├── __tests__/
│   ├── {entity}.entity.spec.ts          ← 각 Step과 함께
│   ├── create-{entity}.handler.spec.ts
│   └── {entity}.controller.spec.ts
└── {entity}.module.ts                   ← Step 7 (마지막)
```

---

## 🔢 실행 순서 (반드시 따르세요!)

### Step 1: Value Objects & Entity (의존성 없음)

**먼저** 외부 의존성 없는 Domain 핵심 생성

```typescript
// 1-1. Value Object: {entity}-id.vo.ts
export class TodoId {
  private constructor(private readonly _value: string) {}
  
  static create(value: string): TodoId {
    if (!value || value.trim() === '') {
      throw new InvalidTodoIdException();
    }
    return new TodoId(value);
  }
  
  static generate(): TodoId {
    return new TodoId(crypto.randomUUID());
  }
  
  get value(): string { return this._value; }
  
  equals(other: TodoId): boolean {
    return this._value === other._value;
  }
}
```

```typescript
// 1-2. Entity: {entity}.entity.ts
export class Todo {
  private constructor(
    private readonly _id: TodoId,
    private _title: string,
    private _completed: boolean,
    private readonly _userId: string,
    private _categoryId: string | null,
    private readonly _createdAt: Date,
    private _updatedAt: Date,
  ) {}

  // ✅ static factory method (new 직접 호출 금지)
  static create(props: CreateTodoProps): Todo {
    return new Todo(
      TodoId.generate(),
      props.title,
      false,  // 새로 생성 시 항상 미완료
      props.userId,
      props.categoryId ?? null,
      new Date(),
      new Date(),
    );
  }

  // ✅ 비즈니스 메서드 (상태 변경 로직은 여기에)
  complete(): void {
    if (this._completed) {
      throw new TodoAlreadyCompletedException(this._id.value);
    }
    this._completed = true;
    this._updatedAt = new Date();
  }

  updateTitle(newTitle: string): void {
    if (!newTitle || newTitle.trim() === '') {
      throw new InvalidTodoTitleException();
    }
    this._title = newTitle.trim();
    this._updatedAt = new Date();
  }

  // Getters only (no setters!)
  get id(): TodoId { return this._id; }
  get title(): string { return this._title; }
  get completed(): boolean { return this._completed; }
  get userId(): string { return this._userId; }
}
```

### Step 2: Repository Interface & Exceptions

```typescript
// 2-1. Repository Interface (Domain Layer에 위치!)
export interface TodoRepository {
  findById(id: TodoId): Promise<Todo | null>;
  findByUserId(userId: string, options?: PaginationOptions): Promise<PaginatedResult<Todo>>;
  save(todo: Todo): Promise<void>;
  delete(id: TodoId): Promise<void>;
}

// injection token
export const TODO_REPOSITORY = Symbol('TODO_REPOSITORY');
```

```typescript
// 2-2. Domain Exception
export class TodoNotFoundException extends DomainException {
  constructor(id: string) {
    super('TODO_NOT_FOUND', `Todo with ID ${id} not found`, 404);
  }
}
```

### Step 3: Commands, Queries, DTOs

```typescript
// 3-1. Command (readonly properties!)
export class CreateTodoCommand {
  constructor(
    public readonly title: string,
    public readonly userId: string,
    public readonly categoryId?: string,
  ) {}
}
```

```typescript
// 3-2. DTO with validation
export class CreateTodoDto {
  @IsString()
  @MinLength(1)
  @MaxLength(200)
  title: string;

  @IsOptional()
  @IsUUID()
  categoryId?: string;
}
```

### Step 4: Handlers (비즈니스 로직)

```typescript
// 4. Command Handler
@CommandHandler(CreateTodoCommand)
export class CreateTodoHandler implements ICommandHandler<CreateTodoCommand> {
  constructor(
    @Inject(TODO_REPOSITORY)
    private readonly todoRepository: TodoRepository,
  ) {}

  async execute(command: CreateTodoCommand): Promise<TodoResponseDto> {
    // 1. Create domain entity
    const todo = Todo.create({
      title: command.title,
      userId: command.userId,
      categoryId: command.categoryId,
    });

    // 2. Persist
    await this.todoRepository.save(todo);

    // 3. Return DTO (not entity!)
    return TodoResponseDto.from(todo);
  }
}
```

### Step 5: Infrastructure (Repository 구현)

```typescript
// 5. Prisma Repository Implementation
@Injectable()
export class PrismaTodoRepository implements TodoRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: TodoId): Promise<Todo | null> {
    const data = await this.prisma.todo.findUnique({
      where: { id: id.value },
    });
    return data ? TodoMapper.toDomain(data) : null;
  }

  async save(todo: Todo): Promise<void> {
    const data = TodoMapper.toPersistence(todo);
    await this.prisma.todo.upsert({
      where: { id: data.id },
      create: data,
      update: data,
    });
  }
}
```

### Step 6: Controller (Thin!)

```typescript
// 6. Controller - 로직 없이 위임만!
@Controller('todos')
@UseGuards(JwtAuthGuard)
export class TodoController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  @ApiOperation({ summary: 'Create a new todo' })
  async create(
    @Body() dto: CreateTodoDto,
    @CurrentUser() user: UserPayload,
  ): Promise<TodoResponseDto> {
    return this.commandBus.execute(
      new CreateTodoCommand(dto.title, user.id, dto.categoryId),
    );
  }
}
```

### Step 7: Module 등록 (마지막)

```typescript
// 7. Module
@Module({
  imports: [CqrsModule],
  controllers: [TodoController],
  providers: [
    // Handlers
    CreateTodoHandler,
    UpdateTodoHandler,
    DeleteTodoHandler,
    GetTodoHandler,
    ListTodoHandler,
    
    // Repository
    {
      provide: TODO_REPOSITORY,
      useClass: PrismaTodoRepository,
    },
  ],
  exports: [TODO_REPOSITORY],
})
export class TodoModule {}
```

---

## ❌ Anti-Patterns (절대 금지!)

### 1. Controller에서 비즈니스 로직 처리

```typescript
// ❌ BAD - Fat Controller
@Post()
async create(@Body() dto: CreateTodoDto, @CurrentUser() user) {
  // Controller에서 직접 로직 처리 - 절대 금지!
  const todo = await this.prisma.todo.create({
    data: { ...dto, userId: user.id },
  });
  return todo;
}
```

**왜 안 되는가:**
- 테스트 시 HTTP 레이어까지 필요
- 로직 재사용 불가
- 트랜잭션 관리 어려움

```typescript
// ✅ GOOD - Command로 위임
@Post()
async create(@Body() dto: CreateTodoDto, @CurrentUser() user) {
  return this.commandBus.execute(new CreateTodoCommand(dto.title, user.id));
}
```

---

### 2. Domain Entity에서 외부 의존성

```typescript
// ❌ BAD - Domain이 Infrastructure 의존
import { PrismaClient } from '@prisma/client';

export class Todo {
  constructor(private prisma: PrismaClient) {} // ❌ 절대 금지!
}
```

**왜 안 되는가:**
- Domain Layer는 순수 TypeScript만
- DB 변경 시 Domain도 수정 필요
- 테스트 시 Prisma 모킹 필요

---

### 3. Entity에 public setter

```typescript
// ❌ BAD - Public setter
export class Todo {
  public title: string;  // ❌
  
  setTitle(title: string) {  // ❌
    this.title = title;
  }
}
```

**왜 안 되는가:**
- 불변성 위반
- 비즈니스 규칙 우회 가능

```typescript
// ✅ GOOD - 비즈니스 메서드
export class Todo {
  private _title: string;
  
  updateTitle(newTitle: string): void {
    if (!newTitle.trim()) throw new InvalidTitleException();
    this._title = newTitle;
  }
  
  get title(): string { return this._title; }
}
```

---

### 4. Handler에서 Entity 직접 반환

```typescript
// ❌ BAD - Entity 노출
async execute(command: CreateTodoCommand): Promise<Todo> {
  const todo = Todo.create({ ... });
  await this.todoRepository.save(todo);
  return todo;  // ❌ Domain Entity 외부 노출
}
```

**왜 안 되는가:**
- Domain 변경이 API 응답에 영향
- 민감 정보 노출 가능

```typescript
// ✅ GOOD - DTO로 변환 후 반환
async execute(command: CreateTodoCommand): Promise<TodoResponseDto> {
  const todo = Todo.create({ ... });
  await this.todoRepository.save(todo);
  return TodoResponseDto.from(todo);  // DTO로 변환
}
```

---

### 5. Repository에서 비즈니스 로직

```typescript
// ❌ BAD - Repository가 비즈니스 담당
async completeTodo(id: string): Promise<void> {
  await this.prisma.todo.update({
    where: { id },
    data: { 
      completed: true,
      completedAt: new Date(),  // ❌ 비즈니스 로직
    },
  });
}
```

**왜 안 되는가:**
- Repository는 CRUD만 담당
- 비즈니스 로직은 Domain/Application Layer에서

```typescript
// ✅ GOOD - Entity에서 비즈니스, Repository는 저장만
// Entity
todo.complete();  // 비즈니스 로직

// Repository
await this.todoRepository.save(todo);  // 저장만
```

---

## 📝 네이밍 규칙

### 파일명 (kebab-case)

| 유형 | 패턴 | 예시 |
|------|------|------|
| Entity | `{name}.entity.ts` | `todo.entity.ts` |
| Value Object | `{name}.vo.ts` | `todo-id.vo.ts` |
| Repository Interface | `{name}.repository.interface.ts` | `todo.repository.interface.ts` |
| Repository Impl | `prisma-{name}.repository.ts` | `prisma-todo.repository.ts` |
| Command | `{verb}-{noun}.command.ts` | `create-todo.command.ts` |
| Handler | `{verb}-{noun}.handler.ts` | `create-todo.handler.ts` |
| DTO | `{verb}-{noun}.dto.ts` | `create-todo.dto.ts` |
| Controller | `{name}.controller.ts` | `todo.controller.ts` |
| Exception | `{reason}.exception.ts` | `todo-not-found.exception.ts` |
| Test | `{target}.spec.ts` | `todo.entity.spec.ts` |

### 클래스명 (PascalCase)

| 유형 | 패턴 | 예시 |
|------|------|------|
| Entity | `{Name}` | `Todo` |
| Value Object | `{Name}Id` | `TodoId` |
| Command | `{Verb}{Noun}Command` | `CreateTodoCommand` |
| Handler | `{Verb}{Noun}Handler` | `CreateTodoHandler` |
| DTO | `{Verb}{Noun}Dto` | `CreateTodoDto` |
| Exception | `{Noun}{Reason}Exception` | `TodoNotFoundException` |

---

## ✅ 검증 체크리스트

생성 완료 후 반드시 확인:

### Domain Layer
- [ ] Entity가 `private constructor` + `static create()` 패턴
- [ ] Entity에 public setter 없음 (getter만)
- [ ] Entity가 외부 라이브러리 import 없음
- [ ] Value Object가 불변 (변경 메서드는 새 인스턴스 반환)
- [ ] Repository Interface가 `domain/repositories/`에 위치

### Application Layer
- [ ] Command/Query가 readonly properties
- [ ] Handler가 `execute` 메서드만 보유
- [ ] Handler가 Entity 대신 DTO 반환
- [ ] DTO에 class-validator decorator 적용

### Infrastructure Layer
- [ ] Repository가 Interface를 `implements`
- [ ] Mapper에 `toDomain`, `toPersistence` 존재
- [ ] Prisma 타입이 Domain Layer로 침투 안 함

### Presentation Layer
- [ ] Controller가 로직 없이 CommandBus/QueryBus 위임만
- [ ] Swagger decorator (`@ApiOperation`, `@ApiResponse`) 적용
- [ ] 적절한 Guard 적용 (`@UseGuards(JwtAuthGuard)`)

### Tests
- [ ] Entity 생성/메서드 테스트 존재
- [ ] Handler 단위 테스트 (Repository mock)
- [ ] 에러 케이스 테스트 (not found, validation 등)

### Build
- [ ] `pnpm tsc --noEmit` 통과
- [ ] `pnpm lint` 통과
- [ ] `pnpm test` 통과

---

## 🔗 다른 Skill과의 관계

### 이전 단계에서 받는 것
- **product-manager skill** → `implementation-plan.md`
- **database-designer skill** → `prisma/schema.prisma`

### 다음 단계에 전달하는 것
- **frontend-engineer skill** → API Endpoints, Response DTOs
- `dev-context-backend.md` 작성하여 전달

---

## 💡 참고: TDD 순서

```
1. Entity 테스트 작성 (Red)
2. Entity 구현 (Green)
3. Handler 테스트 작성 (Red) - Repository mock
4. Handler 구현 (Green)
5. Repository 구현
6. Controller 구현
7. Integration 테스트
```
