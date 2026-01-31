# Backend Conventions - NestJS Clean Architecture + DDD

This document defines the architectural patterns, code organization, and conventions for the NestJS backend following Clean Architecture and Domain-Driven Design (DDD) principles.

---

## 1. Architecture Overview

### Layer Structure

```
┌─────────────────────────────────────────────────────────────┐
│                    INTERFACE LAYER                          │
│  (Controllers, DTOs, HTTP Handlers)                         │
│  interface/controllers/                                     │
│  interface/dto/                                             │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│                 APPLICATION LAYER                           │
│  (Use Cases, Services, Business Logic Orchestration)        │
│  application/usecases/                                      │
│  application/services/                                      │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│                    DOMAIN LAYER                             │
│  (Entities, Value Objects, Repository Interfaces)          │
│  domain/entities/                                           │
│  domain/value-objects/                                      │
│  domain/repositories/                                       │
│  domain/constants/                                          │
└────────────────────┬────────────────────────────────────────┘
                     │
┌────────────────────▼────────────────────────────────────────┐
│               INFRASTRUCTURE LAYER                          │
│  (Database, External Services, Implementations)            │
│  infrastructure/database/repositories/                      │
│  infrastructure/database/mapper/                            │
│  infrastructure/database/prisma.service.ts                  │
│  infrastructure/external-services/                          │
└─────────────────────────────────────────────────────────────┘
```

### Dependency Flow

- **Interface** → Application (depends on use cases)
- **Application** → Domain (depends on entities, repositories)
- **Domain** → (no dependencies, pure business logic)
- **Infrastructure** → Domain (implements repository interfaces)

**Key Rule**: Never skip layers. Always go through Application layer from Interface.

---

## 2. Entity Patterns

Entities are the core business objects. They encapsulate business logic and maintain invariants.

### Entity Structure

```typescript
// domain/entities/system-template.entity.ts
import { SystemTemplateKey, CustomVariable } from '../constants/system-template-registry';

export interface VariableValidationResult {
  valid: boolean;
  missingVariables: string[];
  unknownVariables: string[];
  syntaxErrors: string[];
}

export class SystemTemplateEntity {
  // Constructor: private, only called by static factories
  constructor(
    public readonly id: string,
    public readonly templateKey: SystemTemplateKey,
    public content: string,
    public readonly createdAt: Date,
    public updatedAt: Date,
    public readonly customVariables: CustomVariable[] = [],
  ) {}

  // Business method: encapsulates domain logic
  updateContent(newContent: string): void {
    this.content = newContent;
    this.updatedAt = new Date();
  }

  // Business method: extract variables from template
  extractVariables(): string[] {
    const regex = /\{\{\s*(\w+)\s*\}\}/g;
    const matches = Array.from(this.content.matchAll(regex));
    return [...new Set(matches.map(m => m[1]?.trim() ?? '').filter(Boolean))];
  }

  // Business method: validate template variables
  validateVariables(
    requiredVariableKeys: string[],
    customVariables?: CustomVariable[]
  ): VariableValidationResult {
    const contentVars = this.extractVariables();
    const customVars = customVariables ?? this.customVariables;
    
    const customVarKeys = customVars.map(cv => cv.key);
    const allowedKeys = new Set([...requiredVariableKeys, ...customVarKeys]);
    
    const requiredCustomVarKeys = customVars.filter(cv => cv.required).map(cv => cv.key);
    const allRequiredKeys = [...requiredVariableKeys, ...requiredCustomVarKeys];
    
    const contentSet = new Set(contentVars);
    
    const missingVariables = allRequiredKeys.filter(v => !contentSet.has(v));
    const unknownVariables = contentVars.filter(v => !allowedKeys.has(v));
    const syntaxErrors = this.findSyntaxErrors();
    
    return {
      valid: missingVariables.length === 0 && unknownVariables.length === 0 && syntaxErrors.length === 0,
      missingVariables,
      unknownVariables,
      syntaxErrors,
    };
  }

  private findSyntaxErrors(): string[] {
    const errors: string[] = [];
    const unclosedOpen = this.content.match(/\{\{(?![^{]*\}\})/g);
    if (unclosedOpen) {
      errors.push('템플릿에 닫히지 않은 {{ 가 있습니다');
    }
    return errors;
  }

  // Factory: create new entity (ID will be assigned by DB)
  static create(
    templateKey: SystemTemplateKey,
    content: string,
    customVariables?: CustomVariable[]
  ): SystemTemplateEntity {
    return new SystemTemplateEntity(
      '', // Empty ID for new entities
      templateKey,
      content,
      new Date(),
      new Date(),
      customVariables ?? []
    );
  }

  // Factory: reconstitute from database (ID already exists)
  static reconstitute(
    id: string,
    templateKey: SystemTemplateKey,
    content: string,
    createdAt: Date,
    updatedAt: Date,
    customVariables?: CustomVariable[]
  ): SystemTemplateEntity {
    return new SystemTemplateEntity(
      id,
      templateKey,
      content,
      createdAt,
      updatedAt,
      customVariables ?? []
    );
  }
}
```

### Entity Conventions

| Aspect | Convention | Example |
|--------|-----------|---------|
| **Constructor** | Private, only called by factories | `private constructor(...)` |
| **Properties** | `readonly` for immutable fields | `public readonly id: string` |
| **Mutable fields** | Public, modified via methods | `public content: string` |
| **Factory for creation** | `static create()` with empty ID | `static create(...): Entity` |
| **Factory for DB load** | `static reconstitute()` with ID | `static reconstitute(id, ...)` |
| **Business methods** | Encapsulate domain logic | `updateContent()`, `validate()` |
| **Nullish coalescing** | Use `??` for defaults | `customVariables ?? []` |

---

## 3. Repository Patterns

Repositories abstract data access and provide a domain-centric interface.

### Repository Interface

```typescript
// domain/repositories/area-template.repository.interface.ts
import { AreaTemplateEntity } from "domain/entities/area-template.entity";

export interface IAreaTemplateRepository {
    findAll(): Promise<AreaTemplateEntity[]>;
    findByArea(area: string): Promise<AreaTemplateEntity | null>;
    create(areaTemplate: AreaTemplateEntity): Promise<AreaTemplateEntity>;
    update(areaTemplate: AreaTemplateEntity): Promise<AreaTemplateEntity>;
    delete(id: string): Promise<void>;
}

// Injection token (used in DI container)
export const AREA_TEMPLATE_REPOSITORY = 'AREA_TEMPLATE_REPOSITORY';
```

### Paginated Result Type

```typescript
// domain/types/paginated-result.ts
export interface PaginatedResult<T> {
    data: T[];
    total: number;
    page: number;
    pageSize: number;
    hasMore: boolean;
}
```

### Repository Implementation

```typescript
// infrastructure/database/repositories/sb.user.repository.ts
import { IUserRepository } from "domain/repositories/user.repository.interface";
import { UserEntity } from "domain/entities/user.entity";
import { PrismaService } from "../prisma.service";
import { Injectable } from "@nestjs/common";
import { UserMapper } from "../mapper/user.mapper";

@Injectable()
export class SbUserRepository implements IUserRepository {
    constructor(private prismaService: PrismaService) {}

    async findById(id: string): Promise<UserEntity | null> {
        const user = await this.prismaService.user.findUnique({
            where: { id },
        });
        return user ? UserMapper.toDomain(user) : null;
    }

    async findByKakaoId(kakaoId: string): Promise<UserEntity | null> {
        const user = await this.prismaService.user.findUnique({
            where: { kakao_id: kakaoId },
        });
        return user ? UserMapper.toDomain(user) : null;
    }

    async create(user: UserEntity): Promise<UserEntity> {
        const created = await this.prismaService.user.create({
            data: UserMapper.toPrismaCreate(user),
        });
        return UserMapper.toDomain(created);
    }

    async update(user: UserEntity): Promise<UserEntity> {
        const updated = await this.prismaService.user.update({
            where: { id: user.id },
            data: UserMapper.toPrismaUpdate(user),
        });
        return UserMapper.toDomain(updated);
    }

    async delete(id: string): Promise<void> {
        await this.prismaService.user.delete({
            where: { id },
        });
    }

    async findByRoles(roles: string[]): Promise<UserEntity[]> {
        const users = await this.prismaService.user.findMany({
            where: {
                role: { in: roles },
            },
        });
        return users.map(UserMapper.toDomain);
    }
}
```

### Repository Conventions

| Aspect | Convention | Example |
|--------|-----------|---------|
| **Interface naming** | `I{Entity}Repository` | `IUserRepository` |
| **Implementation naming** | `Sb{Entity}Repository` (Sb = Supabase) | `SbUserRepository` |
| **Injection token** | `{ENTITY}_REPOSITORY` | `USER_REPOSITORY` |
| **Return type** | Entity or `null`, never throw for not found | `Promise<Entity \| null>` |
| **Pagination** | Use `PaginatedResult<T>` | `Promise<PaginatedResult<Entity>>` |
| **Mapper usage** | Always map DB rows to domain entities | `UserMapper.toDomain(row)` |

---

## 4. Mapper Patterns

Mappers translate between database models (snake_case) and domain entities (camelCase).

### Mapper Structure

```typescript
// infrastructure/database/mapper/employee.mapper.ts
import { EmployeeEntity } from "domain/entities/employee.entity";

type EmployeeRow = {
    id: number;
    name: string;
    work_area: string[];
    phone: string;
    grade: string;
    open_to_next_work: boolean;
    company_registered_date: Date | null;
};

export class EmployeeMapper {
    // Convert DB row to domain entity
    static toDomain(row: EmployeeRow): EmployeeEntity {
        return new EmployeeEntity(
            row.id,
            row.name,
            row.work_area,
            row.phone,
            row.grade,
            row.open_to_next_work,
            row.company_registered_date ?? new Date(),
        );
    }

    // Convert entity to Prisma create payload
    static toPrismaCreate(entity: EmployeeEntity) {
        return {
            id: entity.id,
            name: entity.name,
            work_area: entity.workArea,
            phone: entity.phone,
            grade: entity.grade,
            open_to_next_work: entity.openToNextWork,
            company_registered_date: entity.registeredDate,
        };
    }

    // Convert entity to Prisma update payload (exclude ID and timestamps)
    static toPrismaUpdate(entity: EmployeeEntity) {
        return {
            name: entity.name,
            work_area: entity.workArea,
            phone: entity.phone,
            grade: entity.grade,
            open_to_next_work: entity.openToNextWork,
        };
    }
}
```

### Mapper Conventions

| Aspect | Convention | Example |
|--------|-----------|---------|
| **Naming** | `{Entity}Mapper` | `EmployeeMapper` |
| **Methods** | `toDomain()`, `toPrismaCreate()`, `toPrismaUpdate()` | Static methods |
| **Case conversion** | DB: snake_case → Entity: camelCase | `work_area` → `workArea` |
| **Null handling** | Use nullish coalescing | `row.date ?? new Date()` |
| **Update payload** | Exclude ID and system timestamps | Only mutable fields |

---

## 5. UseCase Patterns

Use cases orchestrate business logic by coordinating entities and repositories.

### UseCase Structure

```typescript
// application/usecases/system-setting/get-setting.usecase.ts
import { Injectable, Inject } from "@nestjs/common";
import {
    ISystemSettingRepository,
    SYSTEM_SETTING_REPOSITORY,
} from "domain/repositories/system-setting.repository.interface";

@Injectable()
export class GetSettingUsecase {
    constructor(
        @Inject(SYSTEM_SETTING_REPOSITORY)
        private readonly repository: ISystemSettingRepository
    ) {}

    // Single execute method
    async execute(key: string): Promise<string | null> {
        const entity = await this.repository.findByKey(key);
        return entity?.value ?? null;
    }

    // Optional: convenience method with default
    async executeWithDefault(key: string, defaultValue: string): Promise<string> {
        const value = await this.execute(key);
        return value ?? defaultValue;
    }
}
```

### UseCase Conventions

| Aspect | Convention | Example |
|--------|-----------|---------|
| **Decorator** | `@Injectable()` for NestJS DI | `@Injectable()` |
| **Injection** | `@Inject(TOKEN)` for interfaces | `@Inject(CLIENT_REPOSITORY)` |
| **Method** | Single `execute()` method | `async execute(input): Promise<Output>` |
| **Naming** | `{Action}{Entity}Usecase` | `CreateClientUsecase` |
| **File location** | `application/usecases/{entity}/{action}.usecase.ts` | `application/usecases/client/create-client.usecase.ts` |
| **Input** | Separate interface or DTO | `CreateClientInput` |
| **Error handling** | Throw domain exceptions | `throw new DomainException(...)` |

---

## 6. Module Patterns

Modules organize providers and define dependency injection bindings.

### Module Structure

```typescript
// module/client.module.ts
import { Module } from "@nestjs/common";
import {
    CreateClientUsecase,
    DeleteClientUsecase,
    FindClientByIdUsecase,
    ListClientsUsecase,
    ListClientsPaginatedUsecase,
    UpdateClientUsecase,
} from "application/usecases/client";
import { CLIENT_REPOSITORY } from "domain/repositories/client.repository.interface";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ClientService } from "application/services/client.service";
import { ClientController } from "interface/controllers/client.controller";
import { AlimtalkModule } from "./alimtalk.module";

@Module({
    imports: [AlimtalkModule],
    controllers: [ClientController],
    providers: [
        // Use cases
        CreateClientUsecase,
        DeleteClientUsecase,
        FindClientByIdUsecase,
        ListClientsUsecase,
        ListClientsPaginatedUsecase,
        UpdateClientUsecase,
        
        // Services
        ClientService,
        
        // Infrastructure
        PrismaService,
        
        // Dependency injection binding
        {
            provide: CLIENT_REPOSITORY,
            useClass: SbClientRepository,
        },
    ],
    exports: [ClientService],
})
export class ClientModule {}
```

### Module Conventions

| Aspect | Convention | Example |
|--------|-----------|---------|
| **Naming** | `{Entity}Module` | `ClientModule` |
| **File location** | `module/{entity}.module.ts` | `module/client.module.ts` |
| **Provider binding** | `{ provide: TOKEN, useClass: Implementation }` | `{ provide: CLIENT_REPOSITORY, useClass: SbClientRepository }` |
| **Exports** | Export services, not repositories | `exports: [ClientService]` |
| **Imports** | Import dependent modules | `imports: [AlimtalkModule]` |

---

## 7. DTO Patterns

DTOs (Data Transfer Objects) validate and transform HTTP request/response data.

### DTO Structure

```typescript
// interface/dto/system-template.dto.ts
import {
    IsString,
    IsNotEmpty,
    IsObject,
    IsOptional,
    IsArray,
    ValidateNested,
    IsBoolean,
} from 'class-validator';
import { Type } from 'class-transformer';

// Nested DTO
class CustomVariableDto {
    @IsString()
    @IsNotEmpty()
    key!: string;

    @IsString()
    @IsNotEmpty()
    label!: string;

    @IsBoolean()
    required!: boolean;
}

// Request DTO
export class UpdateSystemTemplateDto {
    @IsString()
    @IsNotEmpty()
    content!: string;

    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => CustomVariableDto)
    customVariables?: CustomVariableDto[];
}

export class ValidateTemplateDto {
    @IsString()
    @IsNotEmpty()
    content!: string;
}

export class PreviewTemplateDto {
    @IsString()
    @IsOptional()
    content?: string;

    @IsObject()
    @IsNotEmpty()
    data!: Record<string, unknown>;
}
```

### DTO Conventions

| Aspect | Convention | Example |
|--------|-----------|---------|
| **Naming** | `{Action}{Entity}Dto` | `UpdateSystemTemplateDto` |
| **Validation** | Use `class-validator` decorators | `@IsString()`, `@IsNotEmpty()` |
| **Nested objects** | Use `@ValidateNested()` + `@Type()` | `@Type(() => CustomVariableDto)` |
| **Optional fields** | Use `@IsOptional()` | `@IsOptional() @IsString()` |
| **File location** | `interface/dto/{entity}.dto.ts` | `interface/dto/system-template.dto.ts` |
| **Non-null assertion** | Use `!` for required fields | `key!: string` |

---

## 8. Value Objects

Value Objects represent immutable, domain-specific values with validation.

### Value Object Structure

```typescript
// domain/value-objects/email.vo.ts
export class Email {
    private readonly value: string;

    private constructor(value: string) {
        this.value = value.toLowerCase().trim();
    }

    // Factory: create with validation
    static create(value: string | null | undefined): Email | null {
        if (!value) return null;

        const trimmed = value.trim().toLowerCase();
        if (!Email.isValid(trimmed)) {
            return null;
        }

        return new Email(trimmed);
    }

    // Factory: create or throw
    static createOrThrow(value: string): Email {
        const email = Email.create(value);
        if (!email) {
            throw new Error(`Invalid email address: ${value}`);
        }
        return email;
    }

    // Validation logic
    private static isValid(value: string): boolean {
        const emailPattern = /^[a-zA-Z0-9.!#$%&'*+/=?^_`{|}~-]+@[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?(?:\.[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)*$/;
        return emailPattern.test(value);
    }

    // Accessors
    toString(): string {
        return this.value;
    }

    getDomain(): string {
        return this.value.split('@')[1] ?? '';
    }

    getLocalPart(): string {
        return this.value.split('@')[0] ?? '';
    }

    // Equality
    equals(other: Email | null | undefined): boolean {
        if (!other) return false;
        return this.value === other.value;
    }
}
```

### Value Object Conventions

| Aspect | Convention | Example |
|--------|-----------|---------|
| **Constructor** | Private, only via factories | `private constructor(...)` |
| **Properties** | All `readonly` | `private readonly value: string` |
| **Factory** | `static create()` returns `null` on invalid | `static create(...): VO \| null` |
| **Factory strict** | `static createOrThrow()` throws on invalid | `static createOrThrow(...)` |
| **Validation** | Encapsulated in private methods | `private static isValid(...)` |
| **Equality** | Implement `equals()` method | `equals(other: VO): boolean` |
| **String conversion** | Implement `toString()` | `toString(): string` |

---

## 9. Naming Conventions

### File Naming

| Type | Pattern | Example |
|------|---------|---------|
| **Entity** | `{name}.entity.ts` | `client.entity.ts` |
| **Value Object** | `{name}.vo.ts` | `email.vo.ts` |
| **Repository Interface** | `{name}.repository.interface.ts` | `client.repository.interface.ts` |
| **Repository Implementation** | `sb.{name}.repository.ts` | `sb.client.repository.ts` |
| **Mapper** | `{name}.mapper.ts` | `client.mapper.ts` |
| **UseCase** | `{action}-{entity}.usecase.ts` | `create-client.usecase.ts` |
| **Service** | `{name}.service.ts` | `client.service.ts` |
| **Controller** | `{name}.controller.ts` | `client.controller.ts` |
| **DTO** | `{name}.dto.ts` | `create-client.dto.ts` |
| **Module** | `{name}.module.ts` | `client.module.ts` |

### Class Naming

| Type | Pattern | Example |
|------|---------|---------|
| **Entity** | `{Name}Entity` | `ClientEntity` |
| **Value Object** | `{Name}` | `Email` |
| **Repository Interface** | `I{Name}Repository` | `IClientRepository` |
| **Repository Implementation** | `Sb{Name}Repository` | `SbClientRepository` |
| **Mapper** | `{Name}Mapper` | `ClientMapper` |
| **UseCase** | `{Action}{Name}Usecase` | `CreateClientUsecase` |
| **Service** | `{Name}Service` | `ClientService` |
| **Controller** | `{Name}Controller` | `ClientController` |
| **DTO** | `{Action}{Name}Dto` | `CreateClientDto` |
| **Module** | `{Name}Module` | `ClientModule` |

### Injection Token Naming

| Type | Pattern | Example |
|------|---------|---------|
| **Repository** | `{ENTITY}_REPOSITORY` | `CLIENT_REPOSITORY` |
| **Service** | `{ENTITY}_SERVICE` | `CLIENT_SERVICE` |
| **Custom** | `{PURPOSE}_{TYPE}` | `EMAIL_VALIDATOR` |

---

## 10. Anti-Patterns

### ❌ DO NOT

1. **Direct database calls in controllers**
   ```typescript
   // ❌ WRONG
   @Get(':id')
   async getClient(@Param('id') id: string) {
       return this.prisma.client.findUnique({ where: { id } });
   }

   // ✅ CORRECT
   @Get(':id')
   async getClient(@Param('id') id: string) {
       return this.findClientUsecase.execute(id);
   }
   ```

2. **Business logic in controllers**
   ```typescript
   // ❌ WRONG
   @Post()
   async create(@Body() dto: CreateClientDto) {
       if (dto.email.includes('@')) {
           // Business logic in controller
       }
   }

   // ✅ CORRECT
   @Post()
   async create(@Body() dto: CreateClientDto) {
       return this.createClientUsecase.execute(dto);
   }
   ```

3. **Skipping mappers**
   ```typescript
   // ❌ WRONG
   const client = await this.prisma.client.findUnique({ where: { id } });
   return client; // Returning DB row directly

   // ✅ CORRECT
   const row = await this.prisma.client.findUnique({ where: { id } });
   return ClientMapper.toDomain(row);
   ```

4. **Mutable entities**
   ```typescript
   // ❌ WRONG
   entity.id = newId; // Changing ID after creation
   entity.createdAt = new Date(); // Changing immutable field

   // ✅ CORRECT
   const entity = ClientEntity.create(...); // ID assigned by factory
   entity.update(...); // Use update methods
   ```

5. **Throwing generic errors**
   ```typescript
   // ❌ WRONG
   throw new Error('Something went wrong');

   // ✅ CORRECT
   throw new ClientNotFoundException('Client not found');
   throw new InvalidClientDataException('Email is invalid');
   ```

6. **Circular dependencies**
   ```typescript
   // ❌ WRONG
   // ClientModule imports UserModule
   // UserModule imports ClientModule

   // ✅ CORRECT
   // Create SharedModule for common dependencies
   // Both import SharedModule
   ```

7. **Mixing concerns in services**
   ```typescript
   // ❌ WRONG
   export class ClientService {
       async createAndSendEmail(dto) {
           // Creating client AND sending email
       }
   }

   // ✅ CORRECT
   export class CreateClientUsecase {
       async execute(dto) {
           // Only create client
       }
   }
   // Separate usecase for email sending
   ```

8. **Using `any` type**
   ```typescript
   // ❌ WRONG
   const data: any = await this.repository.find();

   // ✅ CORRECT
   const data: ClientEntity = await this.repository.find();
   ```

9. **Returning entities directly from API**
   ```typescript
   // ❌ WRONG
   @Get(':id')
   async getClient(@Param('id') id: string): Promise<ClientEntity> {
       return this.findClientUsecase.execute(id);
   }

   // ✅ CORRECT
   @Get(':id')
   async getClient(@Param('id') id: string): Promise<ClientResponseDto> {
       const entity = await this.findClientUsecase.execute(id);
       return ClientMapper.toResponse(entity);
   }
   ```

10. **Modifying entities after creation**
    ```typescript
    // ❌ WRONG
    const client = ClientEntity.create(...);
    client.name = 'New Name'; // Direct mutation

    // ✅ CORRECT
    const client = ClientEntity.create(...);
    client.updateName('New Name'); // Use update method
    ```

---

## 11. Directory Structure

```
backend/
├── domain/                          # Pure business logic
│   ├── entities/
│   │   ├── client.entity.ts
│   │   ├── employee.entity.ts
│   │   └── ...
│   ├── value-objects/
│   │   ├── email.vo.ts
│   │   ├── phone-number.vo.ts
│   │   └── ...
│   ├── repositories/
│   │   ├── client.repository.interface.ts
│   │   ├── employee.repository.interface.ts
│   │   └── ...
│   ├── constants/
│   │   └── system-template-registry.ts
│   └── exceptions/
│       ├── client-not-found.exception.ts
│       └── ...
│
├── application/                     # Use cases & services
│   ├── usecases/
│   │   ├── client/
│   │   │   ├── create-client.usecase.ts
│   │   │   ├── update-client.usecase.ts
│   │   │   ├── delete-client.usecase.ts
│   │   │   ├── find-client-by-id.usecase.ts
│   │   │   ├── list-clients.usecase.ts
│   │   │   └── index.ts
│   │   ├── employee/
│   │   │   └── ...
│   │   └── ...
│   └── services/
│       ├── client.service.ts
│       └── ...
│
├── infrastructure/                  # External dependencies
│   ├── database/
│   │   ├── prisma.service.ts
│   │   ├── repositories/
│   │   │   ├── sb.client.repository.ts
│   │   │   ├── sb.employee.repository.ts
│   │   │   └── ...
│   │   └── mapper/
│   │       ├── client.mapper.ts
│   │       ├── employee.mapper.ts
│   │       └── ...
│   └── external-services/
│       ├── alimtalk/
│       └── ...
│
├── interface/                       # HTTP layer
│   ├── controllers/
│   │   ├── client.controller.ts
│   │   ├── employee.controller.ts
│   │   └── ...
│   └── dto/
│       ├── client.dto.ts
│       ├── employee.dto.ts
│       └── ...
│
├── module/                          # NestJS modules
│   ├── client.module.ts
│   ├── employee.module.ts
│   └── ...
│
├── app.module.ts                    # Root module
├── main.ts                          # Entry point
└── jest.config.ts                   # Testing config
```

---

## 12. Testing Conventions

### Unit Test Structure

```typescript
// domain/entities/client.entity.spec.ts
describe('ClientEntity', () => {
    describe('create', () => {
        it('should create a new client with empty ID', () => {
            const client = ClientEntity.create('John', 'john@example.com', '010-1234-5678');
            expect(client.id).toBe('');
            expect(client.name).toBe('John');
        });

        it('should validate email format', () => {
            const client = ClientEntity.create('John', 'invalid-email', '010-1234-5678');
            expect(client.isValid()).toBe(false);
        });
    });

    describe('update', () => {
        it('should update client name', () => {
            const client = ClientEntity.create('John', 'john@example.com', '010-1234-5678');
            client.updateName('Jane');
            expect(client.name).toBe('Jane');
        });
    });
});
```

### Repository Test Structure

```typescript
// infrastructure/database/repositories/sb.client.repository.spec.ts
describe('SbClientRepository', () => {
    let repository: SbClientRepository;
    let prismaService: PrismaService;

    beforeEach(() => {
        prismaService = {
            client: {
                findUnique: jest.fn(),
                create: jest.fn(),
                update: jest.fn(),
                delete: jest.fn(),
            },
        } as any;

        repository = new SbClientRepository(prismaService);
    });

    describe('findById', () => {
        it('should return client entity when found', async () => {
            const mockRow = { id: '1', name: 'John', email: 'john@example.com' };
            prismaService.client.findUnique.mockResolvedValue(mockRow);

            const result = await repository.findById('1');

            expect(result).toBeInstanceOf(ClientEntity);
            expect(result?.name).toBe('John');
        });

        it('should return null when not found', async () => {
            prismaService.client.findUnique.mockResolvedValue(null);

            const result = await repository.findById('1');

            expect(result).toBeNull();
        });
    });
});
```

---

## 13. Common Patterns

### Pagination

```typescript
// UseCase with pagination
async listClientsPaginated(
    page: number,
    pageSize: number
): Promise<PaginatedResult<ClientEntity>> {
    const skip = (page - 1) * pageSize;
    
    const [data, total] = await Promise.all([
        this.prismaService.client.findMany({
            skip,
            take: pageSize,
            orderBy: { createdAt: 'desc' },
        }),
        this.prismaService.client.count(),
    ]);

    return {
        data: data.map(ClientMapper.toDomain),
        total,
        page,
        pageSize,
        hasMore: skip + pageSize < total,
    };
}
```

### Error Handling

```typescript
// Custom exception
export class ClientNotFoundException extends Error {
    constructor(id: string) {
        super(`Client with ID ${id} not found`);
        this.name = 'ClientNotFoundException';
    }
}

// UseCase with error handling
async execute(id: string): Promise<ClientEntity> {
    const client = await this.repository.findById(id);
    if (!client) {
        throw new ClientNotFoundException(id);
    }
    return client;
}
```

### Transaction

```typescript
// Multiple operations in transaction
async transferClient(fromId: string, toId: string): Promise<void> {
    await this.prismaService.$transaction(async (tx) => {
        const client = await tx.client.findUnique({ where: { id: fromId } });
        if (!client) throw new Error('Client not found');

        await tx.client.update({
            where: { id: fromId },
            data: { status: 'transferred' },
        });

        await tx.client.create({
            data: { ...client, id: toId },
        });
    });
}
```

---

## 14. Quick Reference

### When to use each layer

| Task | Layer | Example |
|------|-------|---------|
| Validate input | Interface (DTO) | `@IsEmail()` |
| Orchestrate logic | Application (UseCase) | `CreateClientUsecase` |
| Encapsulate rules | Domain (Entity) | `ClientEntity.create()` |
| Access data | Infrastructure (Repository) | `SbClientRepository` |

### Dependency injection checklist

- [ ] Repository interface in `domain/repositories/`
- [ ] Injection token exported from interface
- [ ] Repository implementation in `infrastructure/database/repositories/`
- [ ] UseCase injects repository via `@Inject(TOKEN)`
- [ ] Module binds token to implementation
- [ ] Controller injects UseCase

### Code review checklist

- [ ] No business logic in controllers
- [ ] All entities use factories (`create`, `reconstitute`)
- [ ] All DB rows mapped to entities via mappers
- [ ] All repositories implement interfaces
- [ ] All use cases have single `execute()` method
- [ ] All DTOs use `class-validator` decorators
- [ ] No circular dependencies between modules
- [ ] No `any` types without comments
- [ ] Error handling with custom exceptions
- [ ] Proper naming conventions followed
    // ... other properties (all optional)
}

export class ClientEntity {
    // 1. Public readonly id - immutable identifier
    constructor(
        public readonly id: number,
        public name: string,
        public address: string | null,
        public phone: string | null,
        // ... other properties
    ) {}

    // 2. Business methods - encapsulate domain logic
    isGoingToCareCenter(): boolean {
        return this.careCenter;
    }

    isVoucherClient(): boolean {
        return this.voucherClient;
    }

    /**
     * Compute the current service status based on dates
     * Returns the computed status without modifying the entity
     */
    computeCurrentStatus(): ServiceStatusType {
        return computeServiceStatus(this.serviceStatus, this.startDate, this.endDate);
    }

    /**
     * Check if the stored status differs from the computed status
     * If true, the status should be updated in the database
     */
    needsStatusUpdate(): boolean {
        const computed = this.computeCurrentStatus();
        return this.serviceStatus !== computed;
    }

    // 3. Static factory for creating new entities (ID = 0)
    static create(props: CreateClientProps): ClientEntity {
        return new ClientEntity(
            0, // New entities always start with ID 0
            props.name,
            props.address,
            props.phone,
            // ... pass all props
        );
    }

    // 4. Update method with nullish coalescing (??)
    // Only updates fields that are explicitly provided
    update(props: UpdateClientProps): void {
        this.name = props.name ?? this.name;
        this.address = props.address ?? this.address;
        this.phone = props.phone ?? this.phone;
        // ... use ?? to preserve existing values if not provided
    }

    // 5. Static reconstitute for loading from database
    // Used by Mapper to reconstruct entities from persistence data
    static reconstitute(
        id: number,
        name: string,
        address: string | null,
        phone: string | null,
        // ... all properties
    ): ClientEntity {
        return new ClientEntity(
            id,
            name,
            address,
            phone,
            // ... pass all props
        );
    }
}
```

### Key Principles

- **Immutable ID**: `public readonly id` - never changes after creation
- **Factory Methods**: 
  - `create()` - for new entities (ID = 0)
  - `reconstitute()` - for loading from database
- **Business Logic**: Methods like `computeCurrentStatus()`, `needsStatusUpdate()` encapsulate domain rules
- **Update Pattern**: Use nullish coalescing (`??`) to preserve existing values
- **Props Interfaces**: Separate `CreateClientProps` and `UpdateClientProps` for type safety

---

## 2. Repository Pattern

Repositories abstract data access and provide a domain-centric interface.

### Repository Interface (Domain Layer)

```typescript
// backend/domain/repositories/client.repository.interface.ts

export interface PaginatedResult<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface IClientRepository {
    // Basic CRUD
    findById(id: number): Promise<ClientEntity | null>;
    findAll(): Promise<ClientEntity[]>;
    findAllPaginated(page: number, limit: number, search?: string): Promise<PaginatedResult<ClientEntity>>;
    create(client: ClientEntity): Promise<ClientEntity>;
    update(client: ClientEntity): Promise<ClientEntity>;
    delete(id: number): Promise<void>;

    // Domain-specific queries
    findByStartDate(date: Date): Promise<ClientEntity[]>;
    findByEndDate(date: Date): Promise<ClientEntity[]>;
    findStartingWithinDays(days: number): Promise<ClientEntity[]>;
    findEndingWithinDays(days: number): Promise<ClientEntity[]>;
}

// Injection token - used in DI container
export const CLIENT_REPOSITORY = "CLIENT_REPOSITORY";
```

### Key Principles

- **Interface in Domain**: Repository interface lives in `domain/repositories/`
- **Injection Token**: Export a string constant for DI (e.g., `CLIENT_REPOSITORY = "CLIENT_REPOSITORY"`)
- **PaginatedResult Type**: Standard pagination response with `data`, `total`, `page`, `limit`, `totalPages`
- **Domain-Specific Methods**: Include business queries (e.g., `findStartingWithinDays()`)
- **Return Domain Entities**: Always return `ClientEntity`, never raw database rows

---

## 3. Mapper Pattern

Mappers translate between domain entities and database representations.

### Structure

```typescript
// backend/infrastructure/database/mapper/client.mapper.ts

import { ClientEntity } from "domain/entities/client.entity";

// Type for database row (snake_case from Prisma)
type ClientRow = {
    id: number;
    name: string;
    address: string | null;
    phone: string | null;
    full_price: string | null;      // snake_case
    start_date: Date | null;        // snake_case
    care_center: boolean;           // snake_case
    // ... other fields
};

export class ClientMapper {
    // 1. toDomain: Prisma row → Domain entity
    static toDomain(row: ClientRow): ClientEntity {
        return new ClientEntity(
            row.id,
            row.name,
            row.address,
            row.phone,
            row.full_price,           // snake_case → camelCase
            row.start_date,           // snake_case → camelCase
            row.care_center,          // snake_case → camelCase
            // ... map all fields
        );
    }

    // 2. toPrismaCreate: Domain entity → Prisma create input
    static toPrismaCreate(entity: ClientEntity) {
        return {
            name: entity.name,
            address: entity.address,
            phone: entity.phone,
            full_price: entity.fullPrice,      // camelCase → snake_case
            start_date: entity.startDate,      // camelCase → snake_case
            care_center: entity.careCenter,    // camelCase → snake_case
            // ... map all fields
        };
    }

    // 3. toPrismaUpdate: Domain entity → Prisma update input
    static toPrismaUpdate(entity: ClientEntity) {
        return {
            name: entity.name,
            address: entity.address,
            phone: entity.phone,
            full_price: entity.fullPrice,
            start_date: entity.startDate,
            care_center: entity.careCenter,
            // ... map all fields
        };
    }
}
```

### Key Principles

- **Three Methods**: `toDomain()`, `toPrismaCreate()`, `toPrismaUpdate()`
- **Case Conversion**: Map between snake_case (DB) and camelCase (domain)
- **Static Methods**: All mapper methods are static for easy access
- **Type Safety**: Define `ClientRow` type for database representation
- **Nullish Coalescing**: Use `??` when converting optional fields

---

## 4. Use Case Pattern

Use cases orchestrate business logic and coordinate between domain and infrastructure layers.

### Structure

```typescript
// backend/application/usecases/client/create-client.usecase.ts

import { Inject, Injectable } from "@nestjs/common";
import { ClientEntity } from "domain/entities/client.entity";
import { CLIENT_REPOSITORY, IClientRepository } from "domain/repositories/client.repository.interface";

// 1. Type-safe params interface
type CreateClientParams = {
    name: string;
    address: string | null;
    phone: string | null;
    type: string | null;
    duration: number | null;
    fullPrice: string | null;
    grant: string | null;
    actualPrice: string | null;
    startDate: Date | null;
    endDate: Date | null;
    careCenter: boolean;
    voucherClient: boolean;
    birthday: string | null;
    dueDate: Date | null;
    serviceStatus: string | null;
    breastPump: boolean;
    eDocId?: string | null;
};

// 2. @Injectable() decorator for NestJS DI
@Injectable()
export class CreateClientUsecase {
    // 3. Constructor injection with @Inject(TOKEN)
    constructor(
        @Inject(CLIENT_REPOSITORY)
        private readonly clientRepository: IClientRepository,
    ) {}

    // 4. Single execute() method
    execute(params: CreateClientParams): Promise<ClientEntity> {
        // Create domain entity using factory
        const client = ClientEntity.create({
            ...params,
            eDocId: params.eDocId ?? null,
        });

        // Delegate to repository
        return this.clientRepository.create(client);
    }
}
```

### Key Principles

- **@Injectable()**: Required for NestJS dependency injection
- **@Inject(TOKEN)**: Use injection token from repository interface
- **Single execute()**: One public method per use case
- **Type-Safe Params**: Define params interface for each use case
- **Domain Entity Creation**: Use `Entity.create()` factory method
- **Repository Delegation**: Coordinate with repository, don't access database directly

---

## 5. Module Pattern

Modules wire up dependencies and configure the NestJS application.

### Structure

```typescript
// backend/module/client.module.ts

import { Module } from "@nestjs/common";
import {
    CreateClientUsecase,
    DeleteClientUsecase,
    FindClientByIdUsecase,
    ListClientsUsecase,
    ListClientsPaginatedUsecase,
    UpdateClientUsecase,
} from "application/usecases/client";
import { CLIENT_REPOSITORY } from "domain/repositories/client.repository.interface";
import { SbClientRepository } from "infrastructure/database/repositories/sb.client.repository";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ClientService } from "application/services/client.service";
import { ClientController } from "interface/controllers/client.controller";

@Module({
    imports: [AlimtalkModule],
    controllers: [ClientController],
    providers: [
        // 1. Use cases
        CreateClientUsecase,
        DeleteClientUsecase,
        FindClientByIdUsecase,
        ListClientsUsecase,
        ListClientsPaginatedUsecase,
        UpdateClientUsecase,

        // 2. Services
        ClientService,

        // 3. Infrastructure
        PrismaService,

        // 4. Dependency injection binding
        {
            provide: CLIENT_REPOSITORY,
            useClass: SbClientRepository,
        },
    ],
    exports: [ClientService],
})
export class ClientModule {}
```

### Key Principles

- **Provider Binding**: Use `{ provide: TOKEN, useClass: Implementation }` pattern
- **Exports**: Export services that other modules need
- **Imports**: Import other modules (e.g., `AlimtalkModule`)
- **Organization**: Group providers by type (use cases, services, infrastructure)

---

## 6. DTO Pattern

DTOs (Data Transfer Objects) validate and transform HTTP request/response data.

### Structure

```typescript
// backend/interface/dto/client.dto.ts

import { IsBoolean, IsDateString, IsInt, IsOptional, IsString } from "class-validator";

// 1. Create DTO - for POST requests
export class CreateClientDto {
    @IsString()
    name!: string;

    @IsOptional()
    @IsString()
    address?: string | null;

    @IsOptional()
    @IsString()
    phone?: string | null;

    @IsOptional()
    @IsInt()
    duration?: number | null;

    @IsOptional()
    @IsDateString()
    startDate?: string | null;

    @IsOptional()
    @IsDateString()
    endDate?: string | null;

    @IsBoolean()
    careCenter!: boolean;

    @IsBoolean()
    voucherClient!: boolean;

    @IsBoolean()
    breastPump!: boolean;

    @IsOptional()
    @IsString()
    eDocId?: string | null;
}

// 2. Update DTO - for PATCH/PUT requests (all fields optional)
export class UpdateClientDto {
    @IsOptional()
    @IsString()
    name?: string;

    @IsOptional()
    @IsString()
    address?: string | null;

    @IsOptional()
    @IsString()
    phone?: string | null;

    @IsOptional()
    @IsInt()
    duration?: number | null;

    @IsOptional()
    @IsDateString()
    startDate?: string | null;

    @IsOptional()
    @IsDateString()
    endDate?: string | null;

    @IsOptional()
    @IsBoolean()
    careCenter?: boolean;

    @IsOptional()
    @IsBoolean()
    voucherClient?: boolean;

    @IsOptional()
    @IsBoolean()
    breastPump?: boolean;

    @IsOptional()
    @IsString()
    eDocId?: string | null;
}

// 3. Specialized DTOs for specific operations
export class TerminateServiceDto {
    @IsOptional()
    @IsString()
    reason?: string;
}

export class RequestReplacementDto {
    @IsInt()
    newPrimaryEmployeeId!: number;

    @IsOptional()
    @IsInt()
    newSecondaryEmployeeId?: number | null;
}
```

### Key Principles

- **class-validator Decorators**: Use `@IsString()`, `@IsInt()`, `@IsBoolean()`, `@IsDateString()`, `@IsOptional()`
- **Separate Create/Update**: Create DTOs have required fields, Update DTOs have all optional
- **Specialized DTOs**: Create domain-specific DTOs for complex operations
- **Non-null Assertion**: Use `!` for required fields (e.g., `name!: string`)
- **Date Strings**: Use `@IsDateString()` for ISO 8601 date validation

---

## 7. Naming Conventions

Consistent naming makes code predictable and maintainable.

| Type | Pattern | Example | Location |
|------|---------|---------|----------|
| Entity | `{Name}Entity` | `ClientEntity` | `domain/entities/` |
| Repository Interface | `I{Name}Repository` | `IClientRepository` | `domain/repositories/` |
| Repository Implementation | `Sb{Name}Repository` | `SbClientRepository` | `infrastructure/database/repositories/` |
| Use Case | `{Verb}{Name}Usecase` | `CreateClientUsecase` | `application/usecases/{entity}/` |
| Service | `{Name}Service` | `ClientService` | `application/services/` |
| DTO | `{Verb}{Name}Dto` | `CreateClientDto` | `interface/dto/` |
| Mapper | `{Name}Mapper` | `ClientMapper` | `infrastructure/database/mapper/` |
| Controller | `{Name}Controller` | `ClientController` | `interface/controllers/` |
| Module | `{Name}Module` | `ClientModule` | `module/` |
| Injection Token | `{ENTITY}_REPOSITORY` | `CLIENT_REPOSITORY` | `domain/repositories/` |

### Naming Rules

- **Entities**: Always suffix with `Entity`
- **Repositories**: Prefix interface with `I`, implementation with provider name (e.g., `Sb` for Supabase)
- **Use Cases**: Start with verb (Create, Update, Delete, Find, List)
- **DTOs**: Start with verb (Create, Update) or operation name
- **Injection Tokens**: UPPERCASE with underscores

---

## 8. Directory Structure

```
backend/
├── domain/                          # Domain layer (business logic)
│   ├── entities/
│   │   ├── client.entity.ts
│   │   ├── employee.entity.ts
│   │   └── ...
│   ├── repositories/
│   │   ├── client.repository.interface.ts
│   │   ├── employee.repository.interface.ts
│   │   └── ...
│   └── value-objects/
│       ├── service-status.vo.ts
│       └── ...
│
├── application/                     # Application layer (use cases, services)
│   ├── usecases/
│   │   ├── client/
│   │   │   ├── create-client.usecase.ts
│   │   │   ├── update-client.usecase.ts
│   │   │   ├── delete-client.usecase.ts
│   │   │   ├── find-client-by-id.usecase.ts
│   │   │   ├── list-clients.usecase.ts
│   │   │   └── index.ts
│   │   ├── employee/
│   │   └── ...
│   └── services/
│       ├── client.service.ts
│       └── ...
│
├── infrastructure/                  # Infrastructure layer (database, external APIs)
│   ├── database/
│   │   ├── prisma.service.ts
│   │   ├── repositories/
│   │   │   ├── sb.client.repository.ts
│   │   │   ├── sb.employee.repository.ts
│   │   │   └── ...
│   │   └── mapper/
│   │       ├── client.mapper.ts
│   │       ├── employee.mapper.ts
│   │       └── ...
│   └── external/
│       ├── alimtalk/
│       └── ...
│
├── interface/                       # Interface layer (HTTP, DTOs, Controllers)
│   ├── controllers/
│   │   ├── client.controller.ts
│   │   ├── employee.controller.ts
│   │   └── ...
│   └── dto/
│       ├── client.dto.ts
│       ├── employee.dto.ts
│       └── ...
│
├── module/                          # NestJS modules
│   ├── client.module.ts
│   ├── employee.module.ts
│   ├── alimtalk.module.ts
│   └── app.module.ts
│
└── main.ts                          # Application entry point
```

---

## 9. Data Flow Example

### Creating a Client

```
1. HTTP Request
   POST /clients
   Body: CreateClientDto { name: "John", careCenter: true, ... }

2. Controller (interface/controllers/client.controller.ts)
   @Post()
   async create(@Body() dto: CreateClientDto) {
       return this.clientService.create(dto);
   }

3. Service (application/services/client.service.ts)
   async create(dto: CreateClientDto) {
       return this.createClientUsecase.execute({
           name: dto.name,
           careCenter: dto.careCenter,
           ...
       });
   }

4. Use Case (application/usecases/client/create-client.usecase.ts)
   execute(params: CreateClientParams): Promise<ClientEntity> {
       const client = ClientEntity.create(params);
       return this.clientRepository.create(client);
   }

5. Repository (infrastructure/database/repositories/sb.client.repository.ts)
   async create(entity: ClientEntity): Promise<ClientEntity> {
       const data = ClientMapper.toPrismaCreate(entity);
       const row = await this.prisma.client.create({ data });
       return ClientMapper.toDomain(row);
   }

6. Database
   INSERT INTO clients (name, care_center, ...) VALUES (...)

7. Response
   HTTP 201 Created
   Body: ClientEntity { id: 1, name: "John", careCenter: true, ... }
```

---

## 10. Anti-Patterns (What NOT to Do)

### ❌ Anti-Pattern 1: Direct Database Access in Use Cases

```typescript
// WRONG - Don't do this!
@Injectable()
export class CreateClientUsecase {
    constructor(private prisma: PrismaService) {}

    execute(params: CreateClientParams): Promise<ClientEntity> {
        // Direct database access bypasses repository abstraction
        return this.prisma.client.create({ data: params });
    }
}
```

**Why**: Violates repository pattern, makes testing difficult, couples business logic to database.

**Correct**:
```typescript
@Injectable()
export class CreateClientUsecase {
    constructor(@Inject(CLIENT_REPOSITORY) private repo: IClientRepository) {}

    execute(params: CreateClientParams): Promise<ClientEntity> {
        const client = ClientEntity.create(params);
        return this.repo.create(client);
    }
}
```

---

### ❌ Anti-Pattern 2: Business Logic in Controllers

```typescript
// WRONG - Don't do this!
@Controller('clients')
export class ClientController {
    @Post()
    async create(@Body() dto: CreateClientDto) {
        // Business logic in controller
        const client = new ClientEntity(0, dto.name, ...);
        const result = await this.prisma.client.create({...});
        return result;
    }
}
```

**Why**: Controllers should only handle HTTP concerns, not business logic.

**Correct**:
```typescript
@Controller('clients')
export class ClientController {
    constructor(private clientService: ClientService) {}

    @Post()
    async create(@Body() dto: CreateClientDto) {
        return this.clientService.create(dto);
    }
}
```

---

### ❌ Anti-Pattern 3: Returning Raw Database Rows

```typescript
// WRONG - Don't do this!
async findById(id: number) {
    const row = await this.prisma.client.findUnique({ where: { id } });
    return row; // Returns raw database row with snake_case fields
}
```

**Why**: Exposes database schema to application layer, breaks abstraction.

**Correct**:
```typescript
async findById(id: number): Promise<ClientEntity | null> {
    const row = await this.prisma.client.findUnique({ where: { id } });
    if (!row) return null;
    return ClientMapper.toDomain(row); // Returns domain entity
}
```

---

### ❌ Anti-Pattern 4: Mutable Entity IDs

```typescript
// WRONG - Don't do this!
export class ClientEntity {
    constructor(
        public id: number, // Not readonly!
        public name: string,
        ...
    ) {}
}

// Later, someone might do:
client.id = 999; // Oops! Entity ID changed
```

**Why**: Entity identity should be immutable.

**Correct**:
```typescript
export class ClientEntity {
    constructor(
        public readonly id: number, // Immutable!
        public name: string,
        ...
    ) {}
}
```

---

### ❌ Anti-Pattern 5: Skipping Mapper Layer

```typescript
// WRONG - Don't do this!
async create(entity: ClientEntity): Promise<ClientEntity> {
    const result = await this.prisma.client.create({
        data: {
            name: entity.name,
            address: entity.address,
            // ... manually mapping fields
        },
    });
    return new ClientEntity(result.id, result.name, ...);
}
```

**Why**: Duplicates mapping logic, hard to maintain.

**Correct**:
```typescript
async create(entity: ClientEntity): Promise<ClientEntity> {
    const data = ClientMapper.toPrismaCreate(entity);
    const row = await this.prisma.client.create({ data });
    return ClientMapper.toDomain(row);
}
```

---

### ❌ Anti-Pattern 6: Mixing Update Logic

```typescript
// WRONG - Don't do this!
update(props: UpdateClientProps): void {
    if (props.name) this.name = props.name;
    if (props.address) this.address = props.address;
    // Doesn't handle null values correctly
}
```

**Why**: Can't distinguish between "not provided" and "explicitly set to null".

**Correct**:
```typescript
update(props: UpdateClientProps): void {
    this.name = props.name ?? this.name;
    this.address = props.address ?? this.address;
    // Uses nullish coalescing to preserve existing values
}
```

---

### ❌ Anti-Pattern 7: Hardcoded Injection Tokens

```typescript
// WRONG - Don't do this!
constructor(@Inject("CLIENT_REPOSITORY") private repo: IClientRepository) {}
```

**Why**: String literals are error-prone and not refactorable.

**Correct**:
```typescript
// In domain/repositories/client.repository.interface.ts
export const CLIENT_REPOSITORY = "CLIENT_REPOSITORY";

// In use case
constructor(@Inject(CLIENT_REPOSITORY) private repo: IClientRepository) {}
```

---

### ❌ Anti-Pattern 8: Validation in Entity

```typescript
// WRONG - Don't do this!
export class ClientEntity {
    constructor(public readonly id: number, public name: string) {
        if (!name || name.length === 0) {
            throw new Error("Name is required");
        }
    }
}
```

**Why**: Validation should happen at DTO layer, not entity layer.

**Correct**:
```typescript
// In DTO
export class CreateClientDto {
    @IsString()
    @IsNotEmpty()
    name!: string;
}

// Entity just stores the data
export class ClientEntity {
    constructor(public readonly id: number, public name: string) {}
}
```

---

## 11. Best Practices

### ✅ Use Value Objects for Complex Types

```typescript
// domain/value-objects/service-status.vo.ts
export type ServiceStatusType = "active" | "pending" | "completed" | "cancelled";

export function computeServiceStatus(
    stored: string | null,
    startDate: Date | null,
    endDate: Date | null,
): ServiceStatusType {
    // Complex business logic for status computation
    if (!startDate) return "pending";
    if (new Date() < startDate) return "pending";
    if (endDate && new Date() > endDate) return "completed";
    return "active";
}
```

### ✅ Use Repository Queries for Complex Filters

```typescript
// Instead of fetching all and filtering in memory:
const allClients = await this.repo.findAll();
const filtered = allClients.filter(c => c.startDate > date);

// Do this:
const filtered = await this.repo.findStartingWithinDays(7);
```

### ✅ Use Pagination for Large Result Sets

```typescript
// Instead of:
const allClients = await this.repo.findAll();

// Do this:
const result = await this.repo.findAllPaginated(page, limit);
// Returns: { data: [...], total: 1000, page: 1, limit: 20, totalPages: 50 }
```

### ✅ Use Transactions for Multi-Entity Operations

```typescript
// In repository implementation
async updateClientAndEmployee(clientId: number, employeeId: number) {
    return this.prisma.$transaction(async (tx) => {
        const client = await tx.client.update({...});
        const employee = await tx.employee.update({...});
        return { client, employee };
    });
}
```

### ✅ Document Complex Business Logic

```typescript
/**
 * Compute the current service status based on dates
 * Returns the computed status without modifying the entity
 * 
 * Rules:
 * - If startDate is in the future: "pending"
 * - If endDate is in the past: "completed"
 * - Otherwise: "active"
 */
computeCurrentStatus(): ServiceStatusType {
    return computeServiceStatus(this.serviceStatus, this.startDate, this.endDate);
}
```

---

## 12. Testing Strategy

### Unit Test: Entity

```typescript
describe('ClientEntity', () => {
    it('should create a new client with ID 0', () => {
        const client = ClientEntity.create({
            name: 'John',
            careCenter: true,
            // ...
        });
        expect(client.id).toBe(0);
        expect(client.name).toBe('John');
    });

    it('should update only provided fields', () => {
        const client = ClientEntity.create({ name: 'John', phone: '123' });
        client.update({ name: 'Jane' });
        expect(client.name).toBe('Jane');
        expect(client.phone).toBe('123'); // Unchanged
    });
});
```

### Unit Test: Use Case

```typescript
describe('CreateClientUsecase', () => {
    it('should create a client via repository', async () => {
        const mockRepo = {
            create: jest.fn().mockResolvedValue(new ClientEntity(1, 'John', ...)),
        };
        const usecase = new CreateClientUsecase(mockRepo);

        const result = await usecase.execute({ name: 'John', ... });

        expect(mockRepo.create).toHaveBeenCalled();
        expect(result.id).toBe(1);
    });
});
```

### Integration Test: Repository

```typescript
describe('SbClientRepository', () => {
    it('should create and retrieve a client', async () => {
        const client = ClientEntity.create({ name: 'John', ... });
        const created = await repo.create(client);

        const found = await repo.findById(created.id);
        expect(found?.name).toBe('John');
    });
});
```

---

## 13. Common Mistakes to Avoid

| Mistake | Impact | Solution |
|---------|--------|----------|
| Returning raw DB rows | Breaks abstraction | Always use Mapper |
| Direct Prisma in use cases | Hard to test | Inject repository |
| Business logic in controllers | Violates separation of concerns | Move to service/use case |
| Mutable entity IDs | Breaks identity | Use `readonly` |
| Mixing null and undefined | Type confusion | Use nullish coalescing `??` |
| Hardcoded injection tokens | Not refactorable | Export constants |
| Validation in entities | Wrong layer | Use DTOs with class-validator |
| Skipping mappers | Duplicated logic | Always use mapper layer |

---

## 14. Checklist for New Entity

When adding a new entity, follow this checklist:

- [ ] Create `{Name}Entity` in `domain/entities/`
- [ ] Create `I{Name}Repository` interface in `domain/repositories/`
- [ ] Export injection token `{ENTITY}_REPOSITORY`
- [ ] Create `Sb{Name}Repository` in `infrastructure/database/repositories/`
- [ ] Create `{Name}Mapper` in `infrastructure/database/mapper/`
- [ ] Create use cases in `application/usecases/{entity}/`
  - [ ] `Create{Name}Usecase`
  - [ ] `Update{Name}Usecase`
  - [ ] `Delete{Name}Usecase`
  - [ ] `Find{Name}ByIdUsecase`
  - [ ] `List{Name}sUsecase`
- [ ] Create `{Name}Service` in `application/services/`
- [ ] Create `{Name}Controller` in `interface/controllers/`
- [ ] Create DTOs in `interface/dto/`
  - [ ] `Create{Name}Dto`
  - [ ] `Update{Name}Dto`
- [ ] Create `{Name}Module` in `module/`
- [ ] Add module to `app.module.ts`
- [ ] Write unit tests for entity and use cases
- [ ] Write integration tests for repository

---

## References

- [Clean Architecture](https://blog.cleancoder.com/uncle-bob/2012/08/13/the-clean-architecture.html)
- [Domain-Driven Design](https://www.domainlanguage.com/ddd/)
- [NestJS Documentation](https://docs.nestjs.com/)
- [Prisma Documentation](https://www.prisma.io/docs/)
