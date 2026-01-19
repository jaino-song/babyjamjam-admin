# TDD Test Specifications: Message Template Management

## Context

### Implementation Plan Reference
This test specification is based on the implementation plan at `.paul/plans/message-template-management.md`.

### Feature Summary
Message Template Management enables users to create, manage, and use custom message templates with dynamic variables (`{{변수명}}` syntax) that are auto-detected from template text and rendered as input forms.

### Test Strategy Overview

| Track | Framework | Pattern | Purpose |
|-------|-----------|---------|---------|
| **Unit Tests** | Jest | `backend/test/**/*.spec.ts` | Test entity validation, use cases, services in isolation |
| **Integration Tests** | Jest + Supertest | `backend/test/integration/*.spec.ts` | Test API endpoints with mocked services |
| **E2E Tests** | Playwright | `frontend/tests/*.spec.ts` | Test user flows in real browser |

---

## Phase 1: RED (Write Failing Tests)

> **Goal**: Define the contract through failing tests before implementation

---

### Track 1: Backend Unit Tests

#### Test Suite 1: MessageTemplateEntity

- [ ] **Test File**: `backend/test/domain/message-template.entity.spec.ts`

##### Constructor Tests

- [ ] **Test**: should create a valid message template entity with all properties
  - **Input**: 
    ```typescript
    {
      id: "uuid-123",
      name: "서비스 안내 템플릿",
      content: "안녕하세요 {{고객명}}님, {{서비스일자}}에 방문합니다.",
      variables: [
        { key: "고객명", label: "고객 이름", type: "text", required: true },
        { key: "서비스일자", label: "서비스 일자", type: "text", required: false }
      ],
      createdAt: new Date("2025-01-20T00:00:00Z"),
      updatedAt: new Date("2025-01-20T00:00:00Z")
    }
    ```
  - **Expected Output**: Entity with all properties correctly assigned
  - **Assertions**:
    - `expect(entity.id).toBe("uuid-123")`
    - `expect(entity.name).toBe("서비스 안내 템플릿")`
    - `expect(entity.content).toContain("{{고객명}}")`
    - `expect(entity.variables).toHaveLength(2)`

- [ ] **Test**: should create entity with empty variables array (static template)
  - **Input**: 
    ```typescript
    {
      id: "uuid-456",
      name: "공지사항 템플릿",
      content: "안녕하세요. 공지사항입니다.",
      variables: [],
      createdAt: new Date(),
      updatedAt: new Date()
    }
    ```
  - **Expected Output**: Valid entity with empty variables array
  - **Assertions**:
    - `expect(entity.variables).toEqual([])`
    - `expect(entity.content).not.toContain("{{")`

##### Factory Method: create()

- [ ] **Test**: should create new template with generated UUID and timestamps
  - **Input**: `MessageTemplateEntity.create("테스트 템플릿", "내용 {{변수}}", [{ key: "변수", label: "변수", type: "text", required: true }])`
  - **Expected Output**: Entity with non-empty id and current timestamps
  - **Assertions**:
    - `expect(entity.id).toBeTruthy()`
    - `expect(entity.id).toMatch(/^[0-9a-f-]{36}$/)` (UUID format)
    - `expect(entity.createdAt.getTime()).toBeGreaterThanOrEqual(beforeCreate.getTime())`

##### Factory Method: reconstitute()

- [ ] **Test**: should reconstitute entity from database values
  - **Input**: All properties from database row
  - **Expected Output**: Entity with exact values (no generation)
  - **Assertions**:
    - `expect(entity.id).toBe(inputId)`
    - `expect(entity.createdAt).toEqual(inputCreatedAt)`

##### Variable Extraction: extractVariablesFromContent()

- [ ] **Test**: should extract single variable from content
  - **Input**: `"안녕하세요 {{고객명}}님"`
  - **Expected Output**: `["고객명"]`
  - **Assertions**:
    - `expect(result).toEqual(["고객명"])`

- [ ] **Test**: should extract multiple variables from content
  - **Input**: `"{{고객명}}님, {{서비스일자}}에 {{담당자}}가 방문합니다."`
  - **Expected Output**: `["고객명", "서비스일자", "담당자"]`
  - **Assertions**:
    - `expect(result).toHaveLength(3)`
    - `expect(result).toContain("고객명")`
    - `expect(result).toContain("서비스일자")`
    - `expect(result).toContain("담당자")`

- [ ] **Test**: should return empty array when no variables in content
  - **Input**: `"안녕하세요. 공지사항입니다."`
  - **Expected Output**: `[]`
  - **Assertions**:
    - `expect(result).toEqual([])`

- [ ] **Test**: should deduplicate repeated variables
  - **Input**: `"{{고객명}}님, {{고객명}}님께 안내드립니다."`
  - **Expected Output**: `["고객명"]` (not `["고객명", "고객명"]`)
  - **Assertions**:
    - `expect(result).toHaveLength(1)`

- [ ] **Test**: should trim whitespace from variable names
  - **Input**: `"{{ 고객명 }}님, {{  서비스일자  }}에 방문합니다."`
  - **Expected Output**: `["고객명", "서비스일자"]`
  - **Assertions**:
    - `expect(result).toContain("고객명")`
    - `expect(result).not.toContain(" 고객명 ")`

- [ ] **Test**: should handle Korean variable names
  - **Input**: `"{{이름}}님, {{전화번호}}로 연락드리겠습니다."`
  - **Expected Output**: `["이름", "전화번호"]`
  - **Assertions**:
    - `expect(result).toEqual(["이름", "전화번호"])`

- [ ] **Test**: should handle alphanumeric variable names
  - **Input**: `"Hello {{name}}, your order {{order123}} is ready."`
  - **Expected Output**: `["name", "order123"]`
  - **Assertions**:
    - `expect(result).toContain("name")`
    - `expect(result).toContain("order123")`

- [ ] **Test**: should handle mixed Korean and alphanumeric
  - **Input**: `"{{고객명}} ({{customerID}})"`
  - **Expected Output**: `["고객명", "customerID"]`
  - **Assertions**:
    - `expect(result).toHaveLength(2)`

##### Variable Validation: validateVariables()

- [ ] **Test**: should return valid when content variables match variables array exactly
  - **Input**: 
    - Content: `"안녕하세요 {{고객명}}님, {{서비스일자}}에 방문합니다."`
    - Variables: `[{ key: "고객명", ... }, { key: "서비스일자", ... }]`
  - **Expected Output**: `{ valid: true, errors: [] }`
  - **Assertions**:
    - `expect(result.valid).toBe(true)`
    - `expect(result.errors).toHaveLength(0)`

- [ ] **Test**: should return invalid when variable in content but not in array
  - **Input**: 
    - Content: `"안녕하세요 {{고객명}}님, {{담당자}}입니다."`
    - Variables: `[{ key: "고객명", ... }]`
  - **Expected Output**: `{ valid: false, errors: ["Variable '담당자' found in template but not defined"] }`
  - **Assertions**:
    - `expect(result.valid).toBe(false)`
    - `expect(result.errors).toContain(expect.stringContaining("담당자"))`

- [ ] **Test**: should return invalid when variable in array but not in content
  - **Input**: 
    - Content: `"안녕하세요 {{고객명}}님"`
    - Variables: `[{ key: "고객명", ... }, { key: "서비스일자", ... }]`
  - **Expected Output**: `{ valid: false, errors: ["Variable '서비스일자' defined but not used in template"] }`
  - **Assertions**:
    - `expect(result.valid).toBe(false)`
    - `expect(result.errors).toContain(expect.stringContaining("서비스일자"))`

- [ ] **Test**: should return valid for template with no variables and empty array
  - **Input**: 
    - Content: `"안녕하세요. 공지사항입니다."`
    - Variables: `[]`
  - **Expected Output**: `{ valid: true, errors: [] }`
  - **Assertions**:
    - `expect(result.valid).toBe(true)`

- [ ] **Test**: should return multiple errors when multiple mismatches exist
  - **Input**: 
    - Content: `"{{고객명}}님, {{담당자}}입니다."`
    - Variables: `[{ key: "고객명", ... }, { key: "서비스일자", ... }]`
  - **Expected Output**: `{ valid: false, errors: [/* 2 errors */] }`
  - **Assertions**:
    - `expect(result.valid).toBe(false)`
    - `expect(result.errors.length).toBeGreaterThanOrEqual(2)`

---

#### Test Suite 2: CreateMessageTemplateUseCase

- [ ] **Test File**: `backend/test/usecases/message-template/create-message-template.usecase.spec.ts`

##### Setup

```typescript
// Mock repository
const mockRepository = {
  save: jest.fn(),
  findById: jest.fn(),
  findAll: jest.fn(),
  delete: jest.fn(),
};

let usecase: CreateMessageTemplateUseCase;

beforeEach(() => {
  usecase = new CreateMessageTemplateUseCase(mockRepository);
});

afterEach(() => {
  jest.clearAllMocks();
});
```

##### Success Cases

- [ ] **Test**: should create template when variables match content
  - **Input**: 
    ```typescript
    {
      name: "서비스 안내",
      content: "{{고객명}}님, {{서비스일자}}에 방문합니다.",
      variables: [
        { key: "고객명", label: "고객 이름", type: "text", required: true },
        { key: "서비스일자", label: "서비스 일자", type: "text", required: false }
      ]
    }
    ```
  - **Expected Output**: Created entity returned from repository
  - **Assertions**:
    - `expect(mockRepository.save).toHaveBeenCalledTimes(1)`
    - `expect(result.name).toBe("서비스 안내")`

- [ ] **Test**: should create template with no variables (static template)
  - **Input**: 
    ```typescript
    {
      name: "공지사항",
      content: "안녕하세요. 공지사항입니다.",
      variables: []
    }
    ```
  - **Expected Output**: Created entity with empty variables
  - **Assertions**:
    - `expect(mockRepository.save).toHaveBeenCalled()`
    - `expect(result.variables).toEqual([])`

##### Validation Error Cases

- [ ] **Test**: should throw BadRequestException when variable in content but not defined
  - **Input**: 
    ```typescript
    {
      name: "잘못된 템플릿",
      content: "{{고객명}}님, {{담당자}}입니다.",
      variables: [{ key: "고객명", label: "고객 이름", type: "text", required: true }]
    }
    ```
  - **Expected Output**: BadRequestException thrown
  - **Assertions**:
    - `await expect(usecase.execute(dto)).rejects.toThrow(BadRequestException)`
    - `expect(mockRepository.save).not.toHaveBeenCalled()`

- [ ] **Test**: should throw BadRequestException when variable defined but not in content
  - **Input**: 
    ```typescript
    {
      name: "잘못된 템플릿",
      content: "{{고객명}}님",
      variables: [
        { key: "고객명", label: "고객 이름", type: "text", required: true },
        { key: "서비스일자", label: "서비스 일자", type: "text", required: false }
      ]
    }
    ```
  - **Expected Output**: BadRequestException thrown
  - **Assertions**:
    - `await expect(usecase.execute(dto)).rejects.toThrow(BadRequestException)`

---

#### Test Suite 3: UpdateMessageTemplateUseCase

- [ ] **Test File**: `backend/test/usecases/message-template/update-message-template.usecase.spec.ts`

##### Success Cases

- [ ] **Test**: should update template when variables match content
  - **Input**: 
    ```typescript
    {
      id: "existing-uuid",
      name: "수정된 템플릿",
      content: "{{고객명}}님, 안녕하세요.",
      variables: [{ key: "고객명", label: "고객 이름", type: "text", required: true }]
    }
    ```
  - **Setup**: `mockRepository.findById.mockResolvedValue(existingEntity)`
  - **Expected Output**: Updated entity
  - **Assertions**:
    - `expect(mockRepository.save).toHaveBeenCalled()`
    - `expect(result.name).toBe("수정된 템플릿")`

##### Error Cases

- [ ] **Test**: should throw NotFoundException when template not found
  - **Input**: `{ id: "non-existent-uuid", ... }`
  - **Setup**: `mockRepository.findById.mockResolvedValue(null)`
  - **Expected Output**: NotFoundException thrown
  - **Assertions**:
    - `await expect(usecase.execute(dto)).rejects.toThrow(NotFoundException)`

- [ ] **Test**: should throw BadRequestException when updated variables don't match content
  - **Input**: Updated content with mismatched variables
  - **Expected Output**: BadRequestException thrown
  - **Assertions**:
    - `await expect(usecase.execute(dto)).rejects.toThrow(BadRequestException)`

---

#### Test Suite 4: DeleteMessageTemplateUseCase

- [ ] **Test File**: `backend/test/usecases/message-template/delete-message-template.usecase.spec.ts`

- [ ] **Test**: should delete template when it exists
  - **Input**: `"existing-uuid"`
  - **Setup**: `mockRepository.findById.mockResolvedValue(existingEntity)`
  - **Expected Output**: void (no error)
  - **Assertions**:
    - `expect(mockRepository.delete).toHaveBeenCalledWith("existing-uuid")`

- [ ] **Test**: should throw NotFoundException when template not found
  - **Input**: `"non-existent-uuid"`
  - **Setup**: `mockRepository.findById.mockResolvedValue(null)`
  - **Expected Output**: NotFoundException thrown
  - **Assertions**:
    - `await expect(usecase.execute("non-existent-uuid")).rejects.toThrow(NotFoundException)`

---

#### Test Suite 5: ListMessageTemplatesUseCase

- [ ] **Test File**: `backend/test/usecases/message-template/list-message-templates.usecase.spec.ts`

- [ ] **Test**: should return paginated templates with default values
  - **Input**: No parameters (use defaults)
  - **Setup**: 
    ```typescript
    mockRepository.findAll.mockResolvedValue({
      data: [template1, template2],
      total: 15,
      page: 1,
      limit: 10,
      totalPages: 2
    })
    ```
  - **Expected Output**: PaginatedResult with correct structure
  - **Assertions**:
    - `expect(mockRepository.findAll).toHaveBeenCalledWith(1, 10)`
    - `expect(result.data).toHaveLength(2)`
    - `expect(result.totalPages).toBe(2)`

- [ ] **Test**: should enforce max limit of 100
  - **Input**: `page: 1, limit: 500`
  - **Expected Output**: Repository called with limit 100
  - **Assertions**:
    - `expect(mockRepository.findAll).toHaveBeenCalledWith(1, 100)`

- [ ] **Test**: should return empty array when no templates exist
  - **Input**: `page: 1, limit: 10`
  - **Setup**: `mockRepository.findAll.mockResolvedValue({ data: [], total: 0, page: 1, limit: 10, totalPages: 0 })`
  - **Expected Output**: Empty data array
  - **Assertions**:
    - `expect(result.data).toEqual([])`
    - `expect(result.total).toBe(0)`

---

#### Test Suite 6: GetMessageTemplateUseCase

- [ ] **Test File**: `backend/test/usecases/message-template/get-message-template.usecase.spec.ts`

- [ ] **Test**: should return template when found
  - **Input**: `"existing-uuid"`
  - **Setup**: `mockRepository.findById.mockResolvedValue(existingEntity)`
  - **Expected Output**: The entity
  - **Assertions**:
    - `expect(result).toEqual(existingEntity)`

- [ ] **Test**: should throw NotFoundException when not found
  - **Input**: `"non-existent-uuid"`
  - **Setup**: `mockRepository.findById.mockResolvedValue(null)`
  - **Expected Output**: NotFoundException thrown
  - **Assertions**:
    - `await expect(usecase.execute("non-existent-uuid")).rejects.toThrow(NotFoundException)`

---

#### Test Suite 7: MessageTemplateRepository (Prisma Implementation)

- [ ] **Test File**: `backend/test/repositories/sb.message-template.repository.spec.ts`

##### Setup

```typescript
const createMockPrismaClient = () => ({
  findUnique: jest.fn(),
  findMany: jest.fn(),
  count: jest.fn(),
  create: jest.fn(),
  update: jest.fn(),
  delete: jest.fn(),
});

const createTemplateRow = (overrides = {}) => ({
  id: "uuid-123",
  name: "테스트 템플릿",
  content: "{{고객명}}님 안녕하세요",
  variables: [{ key: "고객명", label: "고객 이름", type: "text", required: true }],
  createdAt: new Date("2025-01-20T00:00:00Z"),
  updatedAt: new Date("2025-01-20T00:00:00Z"),
  ...overrides,
});
```

##### findById Tests

- [ ] **Test**: should return mapped entity when found
  - **Setup**: `prisma.message_template.findUnique.mockResolvedValue(createTemplateRow())`
  - **Expected Output**: MessageTemplateEntity instance
  - **Assertions**:
    - `expect(result).toBeInstanceOf(MessageTemplateEntity)`
    - `expect(result?.name).toBe("테스트 템플릿")`

- [ ] **Test**: should return null when not found
  - **Setup**: `prisma.message_template.findUnique.mockResolvedValue(null)`
  - **Expected Output**: null
  - **Assertions**:
    - `expect(result).toBeNull()`

##### findAll Tests (Pagination)

- [ ] **Test**: should return paginated results
  - **Setup**: 
    ```typescript
    prisma.message_template.findMany.mockResolvedValue([row1, row2]);
    prisma.message_template.count.mockResolvedValue(15);
    ```
  - **Input**: `page: 1, limit: 10`
  - **Expected Output**: PaginatedResult with correct calculations
  - **Assertions**:
    - `expect(result.data).toHaveLength(2)`
    - `expect(result.total).toBe(15)`
    - `expect(result.totalPages).toBe(2)`
    - `expect(prisma.message_template.findMany).toHaveBeenCalledWith({ skip: 0, take: 10, orderBy: { createdAt: 'desc' } })`

- [ ] **Test**: should calculate correct skip for page 2
  - **Input**: `page: 2, limit: 10`
  - **Expected Output**: Skip = 10
  - **Assertions**:
    - `expect(prisma.message_template.findMany).toHaveBeenCalledWith({ skip: 10, take: 10, orderBy: expect.anything() })`

##### save Tests

- [ ] **Test**: should create new template when id is empty
  - **Input**: Entity with empty id (from `create()` factory)
  - **Expected Output**: Created entity with generated id
  - **Assertions**:
    - `expect(prisma.message_template.create).toHaveBeenCalled()`

- [ ] **Test**: should update existing template when id exists
  - **Input**: Entity with existing id
  - **Expected Output**: Updated entity
  - **Assertions**:
    - `expect(prisma.message_template.update).toHaveBeenCalledWith({ where: { id: "existing-id" }, data: expect.anything() })`

##### delete Tests

- [ ] **Test**: should delete template by id
  - **Input**: `"uuid-to-delete"`
  - **Expected Output**: void
  - **Assertions**:
    - `expect(prisma.message_template.delete).toHaveBeenCalledWith({ where: { id: "uuid-to-delete" } })`

---

### Track 2: Backend Integration Tests

#### Test Suite 8: MessageTemplateController (Integration)

- [ ] **Test File**: `backend/test/integration/message-template.controller.integration.spec.ts`

##### Setup

```typescript
import { Test, TestingModule } from "@nestjs/testing";
import { INestApplication, ValidationPipe } from "@nestjs/common";
import request from "supertest";

let app: INestApplication;
let messageTemplateService: jest.Mocked<MessageTemplateService>;

beforeEach(async () => {
  const mockService = {
    create: jest.fn(),
    findById: jest.fn(),
    findAll: jest.fn(),
    update: jest.fn(),
    delete: jest.fn(),
  };

  const moduleFixture: TestingModule = await Test.createTestingModule({
    controllers: [MessageTemplateController],
    providers: [{ provide: MessageTemplateService, useValue: mockService }],
  }).compile();

  app = moduleFixture.createNestApplication();
  app.useGlobalPipes(new ValidationPipe({ transform: true }));
  await app.init();

  messageTemplateService = moduleFixture.get(MessageTemplateService);
});
```

##### POST /message-templates

- [ ] **Test**: should create template and return 201
  - **Input**: 
    ```json
    {
      "name": "서비스 안내",
      "content": "{{고객명}}님, {{서비스일자}}에 방문합니다.",
      "variables": [
        { "key": "고객명", "label": "고객 이름", "type": "text", "required": true },
        { "key": "서비스일자", "label": "서비스 일자", "type": "text", "required": false }
      ]
    }
    ```
  - **Expected Output**: 201 Created with entity body
  - **Assertions**:
    - `expect(response.status).toBe(201)`
    - `expect(messageTemplateService.create).toHaveBeenCalled()`

- [ ] **Test**: should return 400 when name is missing
  - **Input**: `{ "content": "...", "variables": [] }`
  - **Expected Output**: 400 Bad Request
  - **Assertions**:
    - `expect(response.status).toBe(400)`

- [ ] **Test**: should return 400 when variables mismatch content
  - **Input**: Content with `{{고객명}}` but variables array is empty
  - **Setup**: Service throws BadRequestException
  - **Expected Output**: 400 Bad Request
  - **Assertions**:
    - `expect(response.status).toBe(400)`

##### GET /message-templates

- [ ] **Test**: should return paginated list with default params
  - **Setup**: Service returns paginated result
  - **Expected Output**: 200 OK with pagination structure
  - **Assertions**:
    - `expect(response.status).toBe(200)`
    - `expect(response.body).toHaveProperty("data")`
    - `expect(response.body).toHaveProperty("total")`
    - `expect(response.body).toHaveProperty("totalPages")`

- [ ] **Test**: should accept page and limit query params
  - **Input**: `GET /message-templates?page=2&limit=5`
  - **Expected Output**: Service called with correct params
  - **Assertions**:
    - `expect(messageTemplateService.findAll).toHaveBeenCalledWith(2, 5)`

##### GET /message-templates/:id

- [ ] **Test**: should return template when found
  - **Setup**: Service returns entity
  - **Expected Output**: 200 OK with entity
  - **Assertions**:
    - `expect(response.status).toBe(200)`
    - `expect(response.body.id).toBe("uuid-123")`

- [ ] **Test**: should return 404 when not found
  - **Setup**: Service throws NotFoundException
  - **Expected Output**: 404 Not Found
  - **Assertions**:
    - `expect(response.status).toBe(404)`

##### PATCH /message-templates/:id

- [ ] **Test**: should update template and return 200
  - **Input**: `{ "name": "수정된 이름" }`
  - **Setup**: Service returns updated entity
  - **Expected Output**: 200 OK
  - **Assertions**:
    - `expect(response.status).toBe(200)`
    - `expect(messageTemplateService.update).toHaveBeenCalled()`

- [ ] **Test**: should return 404 when template not found
  - **Setup**: Service throws NotFoundException
  - **Expected Output**: 404 Not Found
  - **Assertions**:
    - `expect(response.status).toBe(404)`

- [ ] **Test**: should return 400 when updated variables mismatch
  - **Setup**: Service throws BadRequestException
  - **Expected Output**: 400 Bad Request
  - **Assertions**:
    - `expect(response.status).toBe(400)`

##### DELETE /message-templates/:id

- [ ] **Test**: should delete template and return 204
  - **Setup**: Service returns void
  - **Expected Output**: 204 No Content
  - **Assertions**:
    - `expect(response.status).toBe(204)`

- [ ] **Test**: should return 404 when template not found
  - **Setup**: Service throws NotFoundException
  - **Expected Output**: 404 Not Found
  - **Assertions**:
    - `expect(response.status).toBe(404)`

---

### Track 3: Frontend Unit Tests

#### Test Suite 9: Variable Detection Utility

- [ ] **Test File**: `frontend/src/features/message-templates/__tests__/variable-detection.test.ts`

##### detectVariables Function

- [ ] **Test**: should detect single variable
  - **Input**: `"안녕하세요 {{고객명}}님"`
  - **Expected Output**: `["고객명"]`
  - **Assertions**:
    - `expect(detectVariables(input)).toEqual(["고객명"])`

- [ ] **Test**: should detect multiple variables
  - **Input**: `"{{고객명}}님, {{서비스일자}}에 {{담당자}}가 방문합니다."`
  - **Expected Output**: `["고객명", "서비스일자", "담당자"]`
  - **Assertions**:
    - `expect(result).toHaveLength(3)`

- [ ] **Test**: should return empty array for no variables
  - **Input**: `"안녕하세요. 공지사항입니다."`
  - **Expected Output**: `[]`
  - **Assertions**:
    - `expect(detectVariables(input)).toEqual([])`

- [ ] **Test**: should deduplicate repeated variables
  - **Input**: `"{{고객명}}님, {{고객명}}님께 안내드립니다."`
  - **Expected Output**: `["고객명"]`
  - **Assertions**:
    - `expect(result).toHaveLength(1)`

- [ ] **Test**: should trim whitespace from variable names
  - **Input**: `"{{ 고객명 }}님"`
  - **Expected Output**: `["고객명"]`
  - **Assertions**:
    - `expect(result[0]).toBe("고객명")`

---

#### Test Suite 10: Variable Substitution Utility

- [ ] **Test File**: `frontend/src/features/message-templates/__tests__/variable-substitution.test.ts`

##### substituteVariables Function

- [ ] **Test**: should substitute single variable
  - **Input**: 
    - Content: `"안녕하세요 {{고객명}}님"`
    - Values: `{ "고객명": "홍길동" }`
  - **Expected Output**: `"안녕하세요 홍길동님"`
  - **Assertions**:
    - `expect(result).toBe("안녕하세요 홍길동님")`

- [ ] **Test**: should substitute multiple variables
  - **Input**: 
    - Content: `"{{고객명}}님, {{서비스일자}}에 방문합니다."`
    - Values: `{ "고객명": "홍길동", "서비스일자": "2025-01-20" }`
  - **Expected Output**: `"홍길동님, 2025-01-20에 방문합니다."`
  - **Assertions**:
    - `expect(result).toBe("홍길동님, 2025-01-20에 방문합니다.")`

- [ ] **Test**: should keep placeholder when value not provided
  - **Input**: 
    - Content: `"{{고객명}}님, {{서비스일자}}에 방문합니다."`
    - Values: `{ "고객명": "홍길동" }`
  - **Expected Output**: `"홍길동님, {{서비스일자}}에 방문합니다."`
  - **Assertions**:
    - `expect(result).toContain("{{서비스일자}}")`

- [ ] **Test**: should handle empty values object
  - **Input**: 
    - Content: `"{{고객명}}님"`
    - Values: `{}`
  - **Expected Output**: `"{{고객명}}님"`
  - **Assertions**:
    - `expect(result).toBe("{{고객명}}님")`

- [ ] **Test**: should handle content with no variables
  - **Input**: 
    - Content: `"안녕하세요."`
    - Values: `{ "고객명": "홍길동" }`
  - **Expected Output**: `"안녕하세요."`
  - **Assertions**:
    - `expect(result).toBe("안녕하세요.")`

---

#### Test Suite 11: Variable Validation Utility

- [ ] **Test File**: `frontend/src/features/message-templates/__tests__/variable-validation.test.ts`

##### validateVariables Function

- [ ] **Test**: should return valid when variables match
  - **Input**: 
    - Content: `"{{고객명}}님, {{서비스일자}}에 방문합니다."`
    - Variables: `[{ key: "고객명" }, { key: "서비스일자" }]`
  - **Expected Output**: `{ valid: true, missingInArray: [], unusedInContent: [] }`
  - **Assertions**:
    - `expect(result.valid).toBe(true)`

- [ ] **Test**: should detect missing variable definitions
  - **Input**: 
    - Content: `"{{고객명}}님, {{담당자}}입니다."`
    - Variables: `[{ key: "고객명" }]`
  - **Expected Output**: `{ valid: false, missingInArray: ["담당자"], unusedInContent: [] }`
  - **Assertions**:
    - `expect(result.valid).toBe(false)`
    - `expect(result.missingInArray).toContain("담당자")`

- [ ] **Test**: should detect unused variable definitions
  - **Input**: 
    - Content: `"{{고객명}}님"`
    - Variables: `[{ key: "고객명" }, { key: "서비스일자" }]`
  - **Expected Output**: `{ valid: false, missingInArray: [], unusedInContent: ["서비스일자"] }`
  - **Assertions**:
    - `expect(result.valid).toBe(false)`
    - `expect(result.unusedInContent).toContain("서비스일자")`

---

### Track 4: E2E Tests (Playwright)

#### Test Suite 12: Template List Page

- [ ] **Test File**: `frontend/tests/message-template-list.spec.ts`

##### Page Load

- [ ] **Test**: should display template list page
  - **Steps**:
    1. Navigate to `/messages/templates`
    2. Wait for page load
  - **Assertions**:
    - `await expect(page).toHaveURL('/messages/templates')`
    - `await expect(page.locator('h1, h2').first()).toContainText('템플릿')`

- [ ] **Test**: should show loading skeleton while fetching
  - **Steps**:
    1. Navigate to `/messages/templates`
    2. Check for skeleton before data loads
  - **Assertions**:
    - `await expect(page.locator('[data-testid="skeleton"]').first()).toBeVisible()`

- [ ] **Test**: should display empty state when no templates
  - **Steps**:
    1. Navigate to `/messages/templates` (with empty data)
    2. Wait for load
  - **Assertions**:
    - `await expect(page.locator('text=아직 생성된 템플릿이 없습니다')).toBeVisible()`
    - `await expect(page.locator('button:has-text("새 템플릿 만들기")')).toBeVisible()`

##### Template Table

- [ ] **Test**: should display templates in table
  - **Steps**:
    1. Navigate to `/messages/templates`
    2. Wait for data load
  - **Assertions**:
    - `await expect(page.locator('table')).toBeVisible()`
    - `await expect(page.locator('th:has-text("템플릿 이름")')).toBeVisible()`
    - `await expect(page.locator('th:has-text("변수 개수")')).toBeVisible()`

- [ ] **Test**: should show variable count for each template
  - **Steps**:
    1. Navigate to `/messages/templates`
    2. Find template row
  - **Assertions**:
    - `await expect(page.locator('td').nth(1)).toContainText(/\d+/)`

##### Pagination

- [ ] **Test**: should navigate to next page
  - **Steps**:
    1. Navigate to `/messages/templates`
    2. Click next page button
  - **Assertions**:
    - `await expect(page).toHaveURL(/page=2/)`

- [ ] **Test**: should disable pagination during loading
  - **Steps**:
    1. Navigate to `/messages/templates`
    2. Check pagination buttons during load
  - **Assertions**:
    - `await expect(page.locator('[data-testid="pagination-next"]')).toBeDisabled()`

##### Navigation

- [ ] **Test**: should navigate to create page when clicking new template button
  - **Steps**:
    1. Navigate to `/messages/templates`
    2. Click "새 템플릿 만들기" button
  - **Assertions**:
    - `await expect(page).toHaveURL('/messages/templates/new')`

- [ ] **Test**: should navigate to edit page when clicking edit button
  - **Steps**:
    1. Navigate to `/messages/templates`
    2. Click edit button on first row
  - **Assertions**:
    - `await expect(page).toHaveURL(/\/messages\/templates\/[^/]+\/edit/)`

##### Delete Flow

- [ ] **Test**: should show confirmation dialog when clicking delete
  - **Steps**:
    1. Navigate to `/messages/templates`
    2. Click delete button on first row
  - **Assertions**:
    - `await expect(page.locator('[role="dialog"]')).toBeVisible()`
    - `await expect(page.locator('text=삭제하시겠습니까')).toBeVisible()`

- [ ] **Test**: should close dialog when clicking cancel
  - **Steps**:
    1. Open delete dialog
    2. Click "취소" button
  - **Assertions**:
    - `await expect(page.locator('[role="dialog"]')).not.toBeVisible()`

- [ ] **Test**: should delete template and refresh list when confirming
  - **Steps**:
    1. Open delete dialog
    2. Click "삭제" button
    3. Wait for API response
  - **Assertions**:
    - `await expect(page.locator('[role="dialog"]')).not.toBeVisible()`
    - Template should be removed from list

---

#### Test Suite 13: Template Create/Edit Page

- [ ] **Test File**: `frontend/tests/message-template-form.spec.ts`

##### Create Page Load

- [ ] **Test**: should display create form
  - **Steps**:
    1. Navigate to `/messages/templates/new`
  - **Assertions**:
    - `await expect(page.locator('input[name="name"]')).toBeVisible()`
    - `await expect(page.locator('textarea[name="content"]')).toBeVisible()`

##### Variable Detection (Real-time)

- [ ] **Test**: should detect variables as user types (with debounce)
  - **Steps**:
    1. Navigate to `/messages/templates/new`
    2. Type `"안녕하세요 {{고객명}}님"` in content textarea
    3. Wait 300ms for debounce
  - **Assertions**:
    - `await expect(page.locator('[data-testid="variable-list"]')).toContainText('고객명')`

- [ ] **Test**: should add new variable to list when detected
  - **Steps**:
    1. Type content with `{{고객명}}`
    2. Wait for detection
    3. Type additional `{{서비스일자}}`
    4. Wait for detection
  - **Assertions**:
    - `await expect(page.locator('[data-testid="variable-item"]')).toHaveCount(2)`

- [ ] **Test**: should remove variable from list when removed from content
  - **Steps**:
    1. Type `"{{고객명}}님, {{서비스일자}}에"`
    2. Wait for detection (2 variables)
    3. Remove `{{서비스일자}}` from content
    4. Wait for detection
  - **Assertions**:
    - `await expect(page.locator('[data-testid="variable-item"]')).toHaveCount(1)`

##### Variable Customization

- [ ] **Test**: should allow editing variable label
  - **Steps**:
    1. Type content with `{{고객명}}`
    2. Wait for variable to appear
    3. Edit label input to "고객 이름"
  - **Assertions**:
    - `await expect(page.locator('input[data-testid="variable-label-고객명"]')).toHaveValue('고객 이름')`

- [ ] **Test**: should allow toggling required checkbox
  - **Steps**:
    1. Type content with `{{고객명}}`
    2. Wait for variable to appear
    3. Click required checkbox
  - **Assertions**:
    - `await expect(page.locator('input[data-testid="variable-required-고객명"]')).toBeChecked()`

##### Validation

- [ ] **Test**: should show error when variable in content but not defined
  - **Steps**:
    1. Type content with `{{고객명}}`
    2. Manually remove variable from list (if possible) or simulate mismatch
  - **Assertions**:
    - `await expect(page.locator('[data-testid="validation-error"]')).toBeVisible()`
    - `await expect(page.locator('text=변수 불일치')).toBeVisible()`

- [ ] **Test**: should disable save button when validation fails
  - **Steps**:
    1. Create validation error state
  - **Assertions**:
    - `await expect(page.locator('button:has-text("저장")')).toBeDisabled()`

- [ ] **Test**: should enable save button when validation passes
  - **Steps**:
    1. Fill valid name
    2. Fill content with `{{고객명}}`
    3. Ensure variable is defined
  - **Assertions**:
    - `await expect(page.locator('button:has-text("저장")')).toBeEnabled()`

##### Save Flow

- [ ] **Test**: should show loading spinner on save button during submission
  - **Steps**:
    1. Fill valid form
    2. Click save button
  - **Assertions**:
    - `await expect(page.locator('button:has-text("저장") [data-testid="spinner"]')).toBeVisible()`

- [ ] **Test**: should navigate to list page after successful save
  - **Steps**:
    1. Fill valid form
    2. Click save button
    3. Wait for API response
  - **Assertions**:
    - `await expect(page).toHaveURL('/messages/templates')`

- [ ] **Test**: should show error toast on save failure
  - **Steps**:
    1. Fill form
    2. Mock API to return error
    3. Click save
  - **Assertions**:
    - `await expect(page.locator('[role="alert"]')).toBeVisible()`

##### Edit Page

- [ ] **Test**: should load existing template data
  - **Steps**:
    1. Navigate to `/messages/templates/{id}/edit`
    2. Wait for data load
  - **Assertions**:
    - `await expect(page.locator('input[name="name"]')).not.toHaveValue('')`
    - `await expect(page.locator('textarea[name="content"]')).not.toHaveValue('')`

- [ ] **Test**: should show existing variables
  - **Steps**:
    1. Navigate to edit page for template with variables
  - **Assertions**:
    - `await expect(page.locator('[data-testid="variable-item"]')).toHaveCount(expectedCount)`

##### Cancel Flow

- [ ] **Test**: should navigate back to list when clicking cancel
  - **Steps**:
    1. Navigate to create/edit page
    2. Click "취소" button
  - **Assertions**:
    - `await expect(page).toHaveURL('/messages/templates')`

---

#### Test Suite 14: Messages Page Integration

- [ ] **Test File**: `frontend/tests/message-template-integration.spec.ts`

##### Dropdown Integration

- [ ] **Test**: should show grouped template options in dropdown
  - **Steps**:
    1. Navigate to `/messages`
    2. Click template type dropdown
  - **Assertions**:
    - `await expect(page.locator('text=기본 템플릿')).toBeVisible()`
    - `await expect(page.locator('text=사용자 템플릿')).toBeVisible()`

- [ ] **Test**: should show user templates under "사용자 템플릿" section
  - **Steps**:
    1. Navigate to `/messages`
    2. Open dropdown
  - **Assertions**:
    - User template names should be visible under section header

- [ ] **Test**: should hide "사용자 템플릿" section when no user templates exist
  - **Steps**:
    1. Navigate to `/messages` (with no user templates)
    2. Open dropdown
  - **Assertions**:
    - `await expect(page.locator('text=사용자 템플릿')).not.toBeVisible()`

- [ ] **Test**: should navigate to create page when clicking "+ 새 템플릿 만들기"
  - **Steps**:
    1. Navigate to `/messages`
    2. Open dropdown
    3. Click "+ 새 템플릿 만들기"
  - **Assertions**:
    - `await expect(page).toHaveURL('/messages/templates/new')`

##### Dynamic Form Generation

- [ ] **Test**: should show dynamic form when user template selected
  - **Steps**:
    1. Navigate to `/messages`
    2. Select a user template from dropdown
  - **Assertions**:
    - Form inputs should appear based on template variables

- [ ] **Test**: should show correct labels for variable inputs
  - **Steps**:
    1. Select user template with custom labels
  - **Assertions**:
    - `await expect(page.locator('label:has-text("고객 이름")')).toBeVisible()`

- [ ] **Test**: should mark required fields with asterisk
  - **Steps**:
    1. Select user template with required variables
  - **Assertions**:
    - `await expect(page.locator('label:has-text("*")')).toBeVisible()`

- [ ] **Test**: should validate required fields before generation
  - **Steps**:
    1. Select user template with required variable
    2. Leave required field empty
    3. Click generate
  - **Assertions**:
    - `await expect(page.locator('[data-testid="field-error"]')).toBeVisible()`

##### Message Generation

- [ ] **Test**: should generate message with substituted variables
  - **Steps**:
    1. Select user template
    2. Fill all variable inputs
    3. Click generate button
  - **Assertions**:
    - Generated message should contain filled values, not placeholders

- [ ] **Test**: should display generated message in output area
  - **Steps**:
    1. Generate message
  - **Assertions**:
    - `await expect(page.locator('[data-testid="generated-message"]')).toBeVisible()`
    - `await expect(page.locator('[data-testid="generated-message"]')).toContainText(filledValue)`

- [ ] **Test**: should show copy button after message generation
  - **Steps**:
    1. Generate message
  - **Assertions**:
    - `await expect(page.locator('button:has-text("복사")')).toBeVisible()`

##### Existing Templates Unchanged

- [ ] **Test**: should still show existing 7 hardcoded templates
  - **Steps**:
    1. Navigate to `/messages`
    2. Open dropdown
  - **Assertions**:
    - `await expect(page.locator('text=인사말')).toBeVisible()`
    - `await expect(page.locator('text=서비스 안내')).toBeVisible()`
    - (verify all 7 exist)

- [ ] **Test**: should use existing form when hardcoded template selected
  - **Steps**:
    1. Select "인사말" template
  - **Assertions**:
    - Existing form component should render (not dynamic form)

---

## Phase 2: GREEN (Implement to Pass)

> **Goal**: Write minimum code to make all tests pass

### Backend Implementation Order

1. **Entity** (`backend/domain/entities/message-template.entity.ts`)
   - Tests to Pass: Suite 1 (all entity tests)

2. **Repository Interface** (`backend/domain/repositories/message-template.repository.interface.ts`)
   - No direct tests (interface only)

3. **Repository Implementation** (`backend/infrastructure/database/repositories/sb.message-template.repository.ts`)
   - Tests to Pass: Suite 7

4. **Mapper** (`backend/infrastructure/database/mapper/message-template.mapper.ts`)
   - Tested via repository tests

5. **Use Cases** (`backend/application/usecases/message-template/`)
   - Tests to Pass: Suites 2, 3, 4, 5, 6

6. **Service** (`backend/application/services/message-template.service.ts`)
   - Tested via integration tests

7. **Controller & DTOs** (`backend/interface/controllers/message-template.controller.ts`)
   - Tests to Pass: Suite 8

8. **Module** (`backend/module/message-template.module.ts`)
   - Tested via integration tests

### Frontend Implementation Order

1. **Utility Functions** (`frontend/src/features/message-templates/utils/`)
   - Tests to Pass: Suites 9, 10, 11

2. **API Client** (`frontend/src/features/message-templates/api/`)
   - Tested via E2E tests

3. **TanStack Query Hooks** (`frontend/src/features/message-templates/hooks/`)
   - Tested via E2E tests

4. **Template List Page** (`frontend/src/app/messages/templates/page.tsx`)
   - Tests to Pass: Suite 12

5. **Template Create/Edit Page** (`frontend/src/app/messages/templates/new/page.tsx`, `[id]/edit/page.tsx`)
   - Tests to Pass: Suite 13

6. **Messages Page Integration** (`frontend/src/app/messages/page.tsx`)
   - Tests to Pass: Suite 14

---

## Phase 3: REFACTOR (Keep Tests Green)

> **Goal**: Improve code quality while maintaining passing tests

### Refactoring Checklist

- [ ] Extract common validation logic to shared utility
- [ ] Optimize variable detection regex for performance
- [ ] Add proper TypeScript types for all API responses
- [ ] Improve error messages for better UX
- [ ] Add logging for debugging
- [ ] Ensure consistent error handling patterns

### Verification After Each Refactor

```bash
# Backend
cd backend && npm test

# Frontend unit tests
cd frontend && npm test

# E2E tests
cd frontend && npx playwright test
```

---

## Verification Commands

### Backend Tests

```bash
# Run all backend tests
cd backend && npm test

# Run specific test file
npm test -- message-template.entity.spec.ts

# Run with coverage
npm run test:cov

# Watch mode
npm run test:watch
```

### Frontend Unit Tests

```bash
# Run all frontend unit tests
cd frontend && npm test

# Run specific test file
npm test -- variable-detection.test.ts
```

### E2E Tests

```bash
# Run all E2E tests
cd frontend && npx playwright test

# Run specific test file
npx playwright test message-template-list.spec.ts

# Run with browser visible
npx playwright test --headed

# Run with debug mode
npx playwright test --debug
```

---

## Success Criteria

### RED Phase Complete When:
- [ ] All test files created (14 test suites)
- [ ] `npm test` runs in backend (and FAILS as expected)
- [ ] `npm test` runs in frontend (and FAILS as expected)
- [ ] `npx playwright test` runs (and FAILS as expected)

### GREEN Phase Complete When:
- [ ] Backend: `npm test` → 100% pass
- [ ] Frontend: `npm test` → 100% pass
- [ ] E2E: `npx playwright test` → 100% pass
- [ ] All acceptance criteria from implementation plan met

### REFACTOR Phase Complete When:
- [ ] Code quality improved
- [ ] All tests still pass
- [ ] No regressions introduced

---

## Test Coverage Targets

| Area | Target | Rationale |
|------|--------|-----------|
| Entity validation logic | 100% | Critical business rules |
| Use cases | 100% | Core business logic |
| Repository | 90% | Data access layer |
| Controller | 90% | API contract |
| Frontend utilities | 100% | Shared logic |
| E2E critical paths | 100% | User-facing flows |

---

## Notes for Test Implementers

### Backend Test Patterns
- Follow existing patterns in `backend/test/` directory
- Use `describe` blocks with `given` prefix for context
- Use AAA pattern (Arrange, Act, Assert)
- Mock external dependencies (Prisma, etc.)

### Frontend Test Patterns
- Place unit tests in `__tests__` folders near source
- Use `data-testid` attributes for E2E selectors
- Avoid `waitForTimeout` - use proper waitFor conditions
- Test both success and error states

### E2E Test Considerations
- Tests run against `http://localhost:3000`
- Authentication state stored in `auth.json`
- Use `test.describe.serial` for tests that depend on order
- Clean up test data after each test suite
