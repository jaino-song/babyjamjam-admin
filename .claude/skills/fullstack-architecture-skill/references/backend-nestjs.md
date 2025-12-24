# NestJS Backend Guide

## 모듈 구조 (DDD 기반)

```
src/
├── modules/
│   └── auth/
│       ├── domain/
│       │   ├── entities/
│       │   │   └── user.entity.ts
│       │   ├── value-objects/
│       │   │   └── email.vo.ts
│       │   ├── repositories/
│       │   │   └── user.repository.interface.ts
│       │   └── services/
│       │       └── password-hasher.interface.ts
│       ├── application/
│       │   ├── commands/
│       │   │   └── register-user.command.ts
│       │   ├── queries/
│       │   │   └── get-user.query.ts
│       │   └── handlers/
│       ├── infrastructure/
│       │   ├── persistence/
│       │   │   └── prisma-user.repository.ts
│       │   └── services/
│       │       └── bcrypt-password-hasher.ts
│       └── presentation/
│           ├── controllers/
│           └── dtos/
├── shared/
│   ├── domain/
│   ├── infrastructure/
│   └── utils/
└── core/
    ├── config/
    ├── guards/
    ├── interceptors/
    └── filters/
```

## 레이어별 책임

### Domain Layer
- 비즈니스 로직의 핵심
- 외부 의존성 없음 (Pure TypeScript)
- Entity, Value Object, Domain Service, Repository Interface

### Application Layer
- Use Case 구현
- Command/Query 패턴 (CQRS)
- 트랜잭션 관리
- 도메인 이벤트 발행

### Infrastructure Layer
- Repository 구현 (Prisma)
- 외부 서비스 연동
- 캐싱, 메시징

### Presentation Layer
- HTTP 요청/응답 처리
- DTO 변환
- 인증/인가 Guard

## 코드 패턴

### Controller (Thin)

```typescript
@Controller('users')
export class UserController {
  constructor(
    private readonly commandBus: CommandBus,
    private readonly queryBus: QueryBus,
  ) {}

  @Post()
  async create(@Body() dto: CreateUserDto) {
    return this.commandBus.execute(
      new CreateUserCommand(dto.email, dto.password, dto.name)
    );
  }

  @Get(':id')
  async findOne(@Param('id') id: string) {
    return this.queryBus.execute(new GetUserQuery(id));
  }
}
```

### Command Handler

```typescript
@CommandHandler(CreateUserCommand)
export class CreateUserHandler implements ICommandHandler<CreateUserCommand> {
  constructor(
    private readonly userRepository: UserRepository,
    private readonly passwordHasher: PasswordHasher,
    private readonly eventBus: EventBus,
  ) {}

  async execute(command: CreateUserCommand): Promise<User> {
    // 1. Validate
    const existingUser = await this.userRepository.findByEmail(command.email);
    if (existingUser) {
      throw new UserAlreadyExistsException(command.email);
    }

    // 2. Create Domain Entity
    const hashedPassword = await this.passwordHasher.hash(command.password);
    const user = User.create({
      email: Email.create(command.email),
      password: hashedPassword,
      name: command.name,
    });

    // 3. Persist
    await this.userRepository.save(user);

    // 4. Emit Events
    this.eventBus.publish(new UserCreatedEvent(user.id));

    return user;
  }
}
```

### Rich Domain Entity

```typescript
export class User {
  private constructor(
    private readonly _id: UserId,
    private _email: Email,
    private _password: string,
    private _name: string,
    private _isLocked: boolean,
    private _passwordChangedAt: Date | null,
  ) {}

  static create(props: CreateUserProps): User {
    return new User(
      UserId.generate(),
      props.email,
      props.password,
      props.name,
      false,
      null,
    );
  }

  changePassword(newPassword: string): void {
    if (this._isLocked) {
      throw new UserLockedException();
    }
    this._password = newPassword;
    this._passwordChangedAt = new Date();
  }

  lock(): void {
    this._isLocked = true;
  }

  // Getters
  get id(): UserId { return this._id; }
  get email(): Email { return this._email; }
  get isLocked(): boolean { return this._isLocked; }
}
```

### Repository Interface & Implementation

```typescript
// Domain Layer - Interface
export interface UserRepository {
  findById(id: UserId): Promise<User | null>;
  findByEmail(email: Email): Promise<User | null>;
  save(user: User): Promise<void>;
  delete(id: UserId): Promise<void>;
}

// Infrastructure Layer - Implementation
@Injectable()
export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: PrismaService) {}

  async findById(id: UserId): Promise<User | null> {
    const data = await this.prisma.user.findUnique({
      where: { id: id.value },
    });
    return data ? UserMapper.toDomain(data) : null;
  }

  async save(user: User): Promise<void> {
    const data = UserMapper.toPersistence(user);
    await this.prisma.user.upsert({
      where: { id: data.id },
      create: data,
      update: data,
    });
  }
}
```

## 에러 처리

### Domain Exception

```typescript
export abstract class DomainException extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly statusCode: number = 400,
  ) {
    super(message);
    this.name = this.constructor.name;
  }
}

export class UserNotFoundException extends DomainException {
  constructor(id: string) {
    super('USER_NOT_FOUND', `User with ID ${id} not found`, 404);
  }
}

export class UserAlreadyExistsException extends DomainException {
  constructor(email: string) {
    super('USER_ALREADY_EXISTS', `User with email ${email} already exists`, 409);
  }
}
```

### Global Exception Filter

```typescript
@Catch()
export class GlobalExceptionFilter implements ExceptionFilter {
  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = 500;
    let code = 'INTERNAL_ERROR';
    let message = 'Internal server error';

    if (exception instanceof DomainException) {
      status = exception.statusCode;
      code = exception.code;
      message = exception.message;
    } else if (exception instanceof HttpException) {
      status = exception.getStatus();
      message = exception.message;
    }

    response.status(status).json({
      success: false,
      error: {
        code,
        message,
        timestamp: new Date().toISOString(),
        path: request.url,
        traceId: request.headers['x-request-id'],
      },
    });
  }
}
```

## API 응답 포맷

```typescript
// 성공
{
  success: true,
  data: { ... }
}

// 실패
{
  success: false,
  error: {
    code: "USER_NOT_FOUND",
    message: "User with ID xxx not found",
    timestamp: "2024-01-01T00:00:00Z",
    path: "/api/users/xxx",
    traceId: "abc-123"
  }
}

// 페이지네이션
{
  success: true,
  data: [...],
  meta: {
    total: 100,
    page: 1,
    limit: 10,
    totalPages: 10
  }
}
```

## 모듈 등록

```typescript
// auth.module.ts
@Module({
  imports: [
    CqrsModule,
    JwtModule.registerAsync({ ... }),
  ],
  controllers: [AuthController],
  providers: [
    // Handlers
    CreateUserHandler,
    GetUserHandler,
    
    // Repository
    {
      provide: 'UserRepository',
      useClass: PrismaUserRepository,
    },
    
    // Services
    {
      provide: 'PasswordHasher',
      useClass: BcryptPasswordHasher,
    },
  ],
  exports: ['UserRepository'],
})
export class AuthModule {}
```
