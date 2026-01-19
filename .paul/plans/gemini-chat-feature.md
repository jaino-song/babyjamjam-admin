# Gemini Chat Feature for Contract Automation

## Context

### Original Request
Implement a Gemini-powered AI chat interface in the Dashboard to automate contract creation and sending via eFormSign, while maintaining the existing manual creation flow. The implementation will follow Clean Architecture principles and TDD methodology.

GitHub Issue: https://github.com/jaino-song/imirae-incheon-back-office/issues/34

### Interview Summary
**Key Discussions**:
- **Functions to expose**: All CRUD operations for all entities + eFormSign contract creation/sending
- **CRUD Safety**: All mutating operations (Create/Update/Delete) MUST ask user for confirmation before executing
- **eFormSign**: Keep existing iframe feature untouched, ADD new API-based creation for Gemini
- **Contract sending**: Via phone number (SMS), not email
- **Templates**: Multiple templates, hardcoded list (area-based)
- **Chat persistence**: Session-based, lasts 1 day (not 5 minutes as originally stated)
- **Language**: Match user input language (Korean/English)
- **RBAC**: No restrictions - all authenticated users can use all functions
- **Model**: gemini-3-flash-lite

**Research Findings**:
- **Existing Gemini integration**: `gemini-api.client.ts` exists for image parsing (uses gemini-2.5-flash)
- **eFormSign service**: Has token management, signature generation, document listing - missing `createDocument` API method
- **Frontend**: Next.js 16 with App Router, MUI v7, TanStack Query, Zustand
- **Gemini SDK**: `@google/genai` supports function calling with `FunctionDeclaration`, streaming with `sendMessageStream()`
- **Existing contract flow**: Multi-step form → eformsign SDK iframe → SMS to client

---

## Work Objectives

### Core Objective
Build a Gemini-powered chat interface that allows users to perform all system operations (CRUD + contract creation) through natural language conversation, with streaming responses and confirmation prompts for destructive actions.

### Concrete Deliverables
1. **Backend**: GeminiChatGateway, AIChatService, AIChatController with SSE streaming
2. **Backend**: eFormSign `createAndSendContract` API method (no iframe)
3. **Backend**: Tool definitions for all CRUD operations + contract creation
4. **Frontend**: Chat UI component with expandable fullscreen (ChatGPT/Gemini-like)
5. **Frontend**: `useChatStream` hook for SSE handling
6. **Database**: Chat session table for 1-day persistence

### Definition of Done
- [ ] User can chat with Gemini on dashboard page
- [ ] Chat expands to fullscreen with smooth animation
- [ ] Gemini can search/create/update/delete all entities with confirmation
- [ ] Gemini can create and send contracts via eFormSign API
- [ ] Responses stream in real-time via SSE
- [ ] Chat history persists for 1 day per session
- [ ] Existing iframe-based contract creation still works
- [ ] All tests pass (unit + E2E)

### Must Have
- Streaming responses (SSE)
- Confirmation prompts for CUD operations
- Session-based chat with 1-day expiry
- ChatGPT/Gemini-like UI with animation
- All CRUD tools for: Client, Employee, EmployeeSchedule, BankAccountInfo, VoucherPriceInfo, Message
- Contract creation tool via eFormSign API

### Must NOT Have (Guardrails)
- DO NOT modify existing iframe-based eFormSign flow (`ContractCreationForm.tsx`)
- DO NOT use WebSocket (use SSE instead)
- DO NOT implement role-based restrictions for Gemini functions
- DO NOT auto-execute CUD operations without user confirmation
- DO NOT use gemini-2.5-flash for chat (use gemini-3-flash-lite)

---

## Task Flow

```
Phase 1: Backend Foundation
├── Task 1: Extend eFormSign API (createAndSendContract)
├── Task 2: Create GeminiChatGateway
├── Task 3: Create ChatSession entity + repository
└── Task 4: Define all Gemini tool schemas (parallel with 1-3)

Phase 2: Chat Service & Tools
├── Task 5: Implement tool executor with confirmation logic
└── Task 6: Create AIChatService

Phase 3: API Layer
└── Task 7: Create AIChatController with SSE

Phase 4: Frontend
├── Task 8: Create useChatStream hook
├── Task 9: Create ChatInput component (dashboard)
├── Task 10: Create ChatFullscreen component
└── Task 11: Integrate into Dashboard page

Phase 5: Integration & Polish
├── Task 12: Add chat session persistence
└── Task 13: E2E testing and verification
```

## Parallelization

| Group | Tasks | Reason |
|-------|-------|--------|
| A | 1, 2, 3, 4 | Independent backend components (tool schemas are just JSON definitions) |
| B | 8, 9, 10 | Independent frontend components (after backend API ready) |

| Task | Depends On | Reason |
|------|------------|--------|
| 5 | 4 | Executor needs tool schemas |
| 6 | 2, 5 | Service needs gateway + executor |
| 7 | 6 | Controller needs service |
| 8-11 | 7 | Frontend needs backend API |
| 12 | 3, 6 | Persistence needs session entity + service |
| 13 | All | E2E needs everything |

---

## TODOs

### Phase 1: Backend Foundation

- [ ] 1. Extend eFormSign Service with `createAndSendContract` method

  **What to do**:
  - Add `createAndSendContract(clientId: number, areaId: string)` method to `EformsignService`
  - **Architecture Pattern** (follows existing codebase structure):
    - `EformsignService` = **Orchestrator** (coordinates multiple services)
    - `EformsignApiClient` = **Infrastructure adapter** (calls eFormSign REST API)
    - `EformsignDocService` = **DB operations** (creates eformsign_doc records)
    - `ClientService` = **Client data** (fetches client info)
    - `AreaTemplateService` = **Template lookup** (maps areaId → templateId)
  - **Inject dependencies** (avoid circular dependency by using forwardRef if needed):
    - `ClientService` - to fetch client data
    - `AreaTemplateService` - to lookup templateId from areaId
    - `EformsignDocService` - to create DB record
    - `EformsignApiClient` - already injected via IEformsignClientRepository
  - This method should:
    1. Lookup templateId via `AreaTemplateService.findByAreaId(areaId)`:
       - Returns `{ id, areaId, templateId, templateName }`
       - **Error if area template not found**
    2. Fetch client data via `ClientService.findById(clientId)`:
       - Required fields: name, phone (for SMS)
       - Optional fields: address, birthday, primaryEmployee, voucher info
       - **Error if client not found or missing phone**
    3. Call existing `getAccessToken()` to authenticate (same pattern as existing code)
    4. Build document payload mapping client fields to ContractDataDto:
       ```typescript
       const contractData: ContractDataDto = {
         customerName: client.name,
         customerContact: client.phone,  // Required for SMS
         customerDOB: client.birthday || '',
         customerAddress: client.address || '',
         caretaker1Name: client.primaryEmployee?.name || '',
         caretaker1Contact: client.primaryEmployee?.phone || '',
         type: client.type || '',
         days: client.duration?.toString() || '',
         // ... map remaining fields with defaults for missing data
       };
       ```
    5. Call eFormSign API via `EformsignApiClient.createDocument(payload)`:
       - **Endpoint**: `POST ${EFORMSIGN_DOC_API_URL}/v2.0/api/new_document`
       - Headers: `Authorization: Bearer ${accessToken}`, `Content-Type: application/json`
       - Body: Document payload with prefill fields and recipient SMS
    6. Create `eformsign_doc` record via `EformsignDocService.create()` (NOT directly in this service)
    7. Return `{ documentId: string, status: string, message: string }`
  - Add `IEformsignClientRepository.createDocument(payload)` interface method
  - Implement in `EformsignApiClient`

  **Error Handling**:
  - Client not found → return `{ success: false, error: "고객을 찾을 수 없습니다" }`
  - Client missing phone → return `{ success: false, error: "고객 연락처가 없습니다" }`
  - eFormSign API error → log full error, return user-friendly message
  - **Idempotency**: Check if document already exists for this client before creating

  **Must NOT do**:
  - DO NOT modify existing `generateDocumentOptions()` method (it's for iframe SDK)
  - DO NOT touch iframe-related code
  - DO NOT change existing authentication flow
  - DO NOT hardcode template IDs in this file
  - DO NOT create eformsign_doc directly (use EformsignDocService)

  **Parallelizable**: YES (with 2, 3, 4)

  **References**:
  - `backend/application/services/eformsign.service.ts:119-184` - generateDocumentOptions pattern for payload structure
  - `backend/application/services/eformsign.service.ts:67-93` - getAccessToken pattern
  - `backend/application/services/eformsign-doc.service.ts` - For creating eformsign_doc records (orchestrates DB operations)
  - `backend/infrastructure/api/eformsign-api.client.ts` - EformsignApiClient (calls eFormSign REST API)
  - `backend/application/dto/contract.dto.ts` - ContractDataDto structure
  - `backend/domain/repositories/eformsign.client.interface.ts` - Interface to extend
  - `backend/application/services/area-template.service.ts` - AreaTemplateService for template lookup
  - eFormSign API docs: https://app.swaggerhub.com/apis/eformsign_api/eformsign_API/2.0

  **Acceptance Criteria**:
  - [ ] `createAndSendContract(clientId, areaId)` creates document via API
  - [ ] Uses same auth pattern as existing eFormSign methods
  - [ ] Looks up templateId from areaId via AreaTemplateService
  - [ ] Maps client fields to ContractDataDto with sensible defaults
  - [ ] Document is sent to client's phone via SMS
  - [ ] `eformsign_doc` record is created via EformsignDocService
  - [ ] Returns document ID for tracking
  - [ ] Handles missing client/phone/template gracefully with user-friendly errors

---

- [ ] 2. Create GeminiChatGateway

  **What to do**:
  - **IMPORTANT**: `@google/genai` is NOT installed in backend. Two options:
    - **Option A (Recommended)**: Use REST API directly via fetch (same pattern as existing `gemini-api.client.ts`)
    - **Option B**: Add `@google/genai` to package.json (requires user approval per CLAUDE.md "Ask Before")
  - Create `backend/infrastructure/api/gemini-chat.gateway.ts`
  - Add `GEMINI_CHAT_MODEL=gemini-3-flash-lite` to `.env` and `.env.example`
  - **Use REST API directly** (consistent with existing `gemini-api.client.ts` pattern):
    - Endpoint: `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`
    - For streaming: `https://generativelanguage.googleapis.com/v1beta/models/${model}:streamGenerateContent?alt=sse`
    - Auth: `x-goog-api-key: ${GEMINI_API_KEY}` header
    - **Why REST over SDK**: Existing codebase uses fetch for Gemini (see `gemini-api.client.ts`), maintaining consistency
  - Implement `chat(messages: ChatMessage[], tools: FunctionDeclaration[])` method
  - Implement `chatStream(messages: ChatMessage[], tools: FunctionDeclaration[])` method returning AsyncIterable
  - Handle function call responses from Gemini
  - Read model name from `ConfigService.get('GEMINI_CHAT_MODEL')`
  
  **ChatMessage Type**:
  ```typescript
  interface ChatMessage {
    role: 'user' | 'assistant' | 'system';
    content: string;
    timestamp?: string;
  }
  ```

  **Must NOT do**:
  - DO NOT modify existing `gemini-api.client.ts` (used for image parsing)
  - DO NOT hardcode model name (use env var)
  - DO NOT use gemini-2.5-flash for chat

  **Parallelizable**: YES (with 1, 3, 4)

  **References**:
  - `backend/infrastructure/api/gemini-api.client.ts` - Existing Gemini client pattern (uses fetch, not SDK)
  - Gemini REST API docs: https://ai.google.dev/gemini-api/docs
  - Context7 docs: Function calling format

  **Acceptance Criteria**:
  - [ ] Can send chat messages with tools
  - [ ] Returns streaming response chunks
  - [ ] Correctly parses function call requests from Gemini
  - [ ] Model name read from GEMINI_CHAT_MODEL env var
  - [ ] Uses gemini-3-flash-lite model by default
  - [ ] Uses fetch (not SDK) OR gets approval to add @google/genai

---

- [ ] 3. Create ChatSession entity and repository

  **What to do**:
  - Create `backend/domain/entities/chat-session.entity.ts`
    - Properties: id (String), userId (String - UUID), messages (JSON), createdAt, expiresAt
  - Create `backend/domain/repositories/chat-session.repository.interface.ts`
  - Add `chat_session` table to Prisma schema:
    ```prisma
    model chat_session {
      id         String   @id @default(cuid())
      user_id    String   @db.Uuid  // IMPORTANT: user.id is String @db.Uuid, NOT Int
      messages   Json     // Array of {role: 'user'|'assistant', content: string, timestamp: string}
      created_at DateTime @default(now())
      expires_at DateTime
      
      user       user     @relation(fields: [user_id], references: [id])
      
      @@index([user_id])
      @@index([expires_at])
    }
    ```
  - Add relation to `user` model: `chat_sessions chat_session[]`
  - Implement `SbChatSessionRepository` in infrastructure
  - Create mapper for ChatSession entity
  - Session expiry logic: On load, check `expiresAt < now()` → return null (expired)
  - Set `expiresAt = now() + 24 hours` on session creation
  - Add message size limit: max 100 messages per session (prevent runaway rows)
  - Create `backend/module/chat-session.module.ts` with DI bindings

  **Must NOT do**:
  - DO NOT store messages permanently (1-day expiry)
  - DO NOT create complex message threading
  - DO NOT use Int for user_id (user.id is String @db.Uuid)

  **Parallelizable**: YES (with 1, 2, 4)

  **References**:
  - `backend/domain/entities/client.entity.ts` - Entity pattern
  - `backend/domain/repositories/client.repository.interface.ts` - Repository interface pattern
  - `backend/prisma/schema.prisma:144-154` - user model (id is String @db.Uuid)

  **Acceptance Criteria**:
  - [ ] ChatSession entity with messages JSON field
  - [ ] user_id is String type matching user.id
  - [ ] Repository can create/find/update sessions
  - [ ] Sessions have 1-day expiry (expiresAt field)
  - [ ] Expired sessions return null on load
  - [ ] Max 100 messages per session enforced
  - [ ] Prisma migration runs successfully
  - [ ] Module with DI bindings created

---

### Phase 2: Chat Service & Tools

- [ ] 4. Define Gemini tool schemas

  **What to do**:
  - Create `backend/application/ai-chat/tools/` directory
  - Create tool schema files:
    - `client.tools.ts` - searchClients, getClient, createClient, updateClient, deleteClient
    - `employee.tools.ts` - searchEmployees, getEmployee, createEmployee, updateEmployee, deleteEmployee
    - `employee-schedule.tools.ts` - getSchedules, createSchedule, updateSchedule, deleteSchedule
    - `bank-account.tools.ts` - getBankAccounts, createBankAccount, updateBankAccount, deleteBankAccount
    - `voucher-price.tools.ts` - getVoucherPrices, createVoucherPrice, updateVoucherPrice, deleteVoucherPrice
    - `message.tools.ts` - getMessages, createMessage, updateMessage, deleteMessage
    - `contract.tools.ts` - listAvailableTemplates, createAndSendContract, getContractStatus
    - `dashboard.tools.ts` - getDashboardStats
  - Each tool should have: name, description, parameters (JSON schema)
  - All CUD tools must include `confirmed: boolean` parameter
  - Export all tools from `index.ts`
  
  **Template Source (Use Existing API - NOT Hardcoded)**:
  - `listAvailableTemplates` tool calls existing `/area-templates` API via AreaTemplateService
  - AreaTemplate structure: `{ id, areaId, templateId, templateName }`
  - `createAndSendContract` accepts `areaId` (e.g., "incheon") which maps to `templateId` via AreaTemplate lookup
  - **DO NOT create hardcoded constants** - use the existing area-templates CRUD system

  **Must NOT do**:
  - DO NOT implement execution logic here (just schemas)
  - DO NOT include sensitive operations without confirmation flag
  - DO NOT create hardcoded template constants (use existing AreaTemplate API)

  **Parallelizable**: YES (with 1, 2, 3) - tool schemas are just JSON definitions

  **References**:
  - Context7 docs: `FunctionDeclaration` schema format
  - `backend/interface/dto/client.dto.ts` - DTO structures for parameters
  - `frontend/src/app/hooks/useVoucherData.ts:77-87` - useAreaTemplates hook showing AreaTemplate structure
  - `backend/interface/controllers/area-template.controller.ts` - Existing AreaTemplate API

  **Acceptance Criteria**:
  - [ ] All CRUD tools defined for each entity
  - [ ] All CUD tools have `confirmed` parameter
  - [ ] Contract creation tool uses areaId parameter (not hardcoded templateId)
  - [ ] listAvailableTemplates tool queries existing AreaTemplate API
  - [ ] Dashboard stats tool defined
  - [ ] All tools have proper descriptions and parameter schemas

---

- [ ] 5. Implement tool executor with confirmation logic

  **What to do**:
  - Create `backend/application/ai-chat/tool-executor.service.ts`
  - Inject all required services (ClientService, EmployeeService, etc.)
  - Implement `executeTool(toolName: string, args: any)` method
  - For READ operations: execute immediately, return data
  - For CUD operations:
    - Check `args.confirmed` flag
    - If `confirmed=false` or missing: return `{requiresConfirmation: true, message: "확인 메시지..."}`
    - If `confirmed=true`: execute the operation, return `{success: true, data: ...}`
  - Return structured result for Gemini to process
  
  **Confirmation Flow**:
  ```
  1. User: "김철수 고객 삭제해줘"
  2. Gemini calls deleteClient(id=123, confirmed=false)
  3. Executor returns: {requiresConfirmation: true, message: "김철수 고객을 삭제하시겠습니까?"}
  4. Service sends this back to Gemini as function result
  5. Gemini responds to user: "김철수 고객을 삭제하시겠습니까? (확인/취소)"
  6. User: "확인" or "네"
  7. Gemini calls deleteClient(id=123, confirmed=true)
  8. Executor executes deletion, returns: {success: true, message: "삭제되었습니다."}
  ```

  **Error Handling**:
  - Catch all errors and return `{success: false, error: "user-friendly message"}`
  - Log full error details server-side with logger
  - Never expose stack traces or internal errors to Gemini
  - For validation errors, return specific field errors

  **Must NOT do**:
  - DO NOT execute CUD operations without `confirmed=true`
  - DO NOT expose internal error details to user

  **Parallelizable**: NO (depends on 4)

  **References**:
  - `backend/application/services/client.service.ts` - Service injection pattern
  - `backend/application/services/eformsign.service.ts` - For contract execution

  **Acceptance Criteria**:
  - [ ] READ tools execute immediately
  - [ ] CUD tools require `confirmed=true` to execute
  - [ ] Returns `{requiresConfirmation: true, message}` when confirmation needed
  - [ ] Returns user-friendly messages in Korean/English
  - [ ] Handles errors gracefully with structured response

---

- [ ] 6. Create AIChatService

  **What to do**:
  - Create `backend/application/services/ai-chat.service.ts`
  - Inject GeminiChatGateway, ToolExecutor, ChatSessionRepository
  - Implement `chat(sessionId: string, userId: string, message: string)` method:
    - **IMPORTANT**: userId is `string` (UUID), NOT `number` - matches JWT payload.sub type
    1. Load or create session (check expiry: `expiresAt < now()` → create new)
    2. Add user message to history
    3. Call Gemini with history + tools + system prompt
    4. If Gemini returns function call → execute via ToolExecutor → send result back to Gemini
    5. Loop until Gemini returns text response (max 5 tool calls per turn)
    6. Save updated session
    7. Return final response (or stream)
  - Implement `chatStream(...)` for SSE streaming
  - Handle session expiry (1 day)
  
  **System Prompt** (prepend to every conversation):
  ```
  You are an AI assistant for Imirae Incheon care service management system.
  
  RULES:
  1. Respond in the SAME LANGUAGE as the user (Korean or English)
  2. For CREATE, UPDATE, DELETE operations: ALWAYS call the tool with confirmed=false first
  3. When user confirms (says "yes", "확인", "네", etc.), call the tool again with confirmed=true
  4. Be concise and professional
  5. Format data in readable tables when showing lists
  6. When searching, show relevant details (name, phone, status)
  7. For contract creation, always confirm client name and template before proceeding
  
  AVAILABLE OPERATIONS:
  - Search/view clients, employees, schedules, messages, voucher prices, bank accounts
  - Create/update/delete any of the above (requires confirmation)
  - Create and send contracts via eFormSign (requires confirmation)
  - View dashboard statistics
  ```

  **Must NOT do**:
  - DO NOT store messages beyond 1 day
  - DO NOT skip confirmation for CUD operations
  - DO NOT allow more than 5 tool calls per user message (prevent infinite loops)

  **Parallelizable**: NO (depends on 2, 5)

  **References**:
  - `backend/application/services/client.service.ts` - Service pattern
  - Context7 docs: Multi-turn chat with function calling

  **Acceptance Criteria**:
  - [ ] Maintains conversation history per session
  - [ ] Handles function calls and sends results back to Gemini
  - [ ] Limits tool calls to 5 per turn
  - [ ] Streams responses for real-time UI
  - [ ] Sessions expire after 1 day
  - [ ] Gemini responds in user's language
  - [ ] System prompt enforces confirmation behavior

---

### Phase 3: API Layer

- [ ] 7. Create AIChatController with SSE

  **What to do**:
  - Create `backend/interface/controllers/ai-chat.controller.ts`
  - Create `backend/interface/dto/ai-chat.dto.ts` with request/response DTOs
  - Create `backend/module/ai-chat.module.ts` with DI bindings for all AI chat services
  
  **IMPORTANT: SSE Transport Decision**
  Since browser `EventSource` only supports GET, but we need to send message payload:
  - **Use POST with fetch streaming** (NOT EventSource)
  - Frontend will use `fetch()` with `response.body.getReader()` to read SSE stream
  - This allows POST with JSON body while still streaming response
  
  **NestJS POST Streaming Implementation**:
  Use `@Res()` decorator with manual response writing (NOT `@Sse()` which only works with GET):
  ```typescript
  @Post('stream')
  @UseGuards(JwtGuard)
  async streamChat(
    @Body() dto: ChatStreamDto,
    @Req() req: Request,
    @Res() res: Response,
  ) {
    const userId = req.user.sub; // from JWT
    
    // Set SSE headers
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders();
    
    try {
      // Get async iterator from service
      const stream = this.aiChatService.chatStream(dto.sessionId, userId, dto.message);
      
      for await (const chunk of stream) {
        // Write SSE format: "event: message\ndata: {...}\n\n"
        res.write(`event: message\ndata: ${JSON.stringify(chunk)}\n\n`);
      }
      
      res.end();
    } catch (error) {
      res.write(`event: error\ndata: ${JSON.stringify({ message: error.message })}\n\n`);
      res.end();
    }
  }
  ```
  
  - Implement `POST /api/ai/chat/stream` endpoint:
    - Accept: `{ sessionId?: string, message: string }` in request body
    - Return: SSE stream with chunks via `text/event-stream`
    - Headers: `Content-Type: text/event-stream`, `Cache-Control: no-cache`, `Connection: keep-alive`
    - Auth: Standard JWT from `Authorization: Bearer` header (works with fetch, not EventSource)
  - Implement `GET /api/ai/chat/sessions/:id` to get session history
  - Implement `DELETE /api/ai/chat/sessions/:id` to clear session
  - Add JwtGuard for authentication (standard header-based, NOT query param)
  
  **SSE Event Format**:
  ```typescript
  // Text chunk event
  event: message
  data: {"type": "chunk", "content": "partial text here"}
  
  // Function call notification (for UI feedback)
  event: message
  data: {"type": "tool_call", "name": "searchClients", "status": "executing"}
  
  // Confirmation required event
  event: message
  data: {"type": "confirmation", "message": "김철수 고객을 삭제하시겠습니까?"}
  
  // Completion event
  event: message
  data: {"type": "done", "sessionId": "cuid_xxx"}
  
  // Error event
  event: error
  data: {"message": "Error description"}
  ```

  **Must NOT do**:
  - DO NOT use WebSocket
  - DO NOT use EventSource (use fetch streaming instead)
  - DO NOT allow unauthenticated access
  - DO NOT expose internal errors in SSE events

  **Parallelizable**: NO (depends on 6)

  **References**:
  - `backend/interface/controllers/client.controller.ts` - Controller pattern
  - `backend/module/client.module.ts` - Module pattern
  - NestJS SSE documentation for streaming responses

  **Acceptance Criteria**:
  - [ ] POST endpoint accepts message in body and streams SSE response
  - [ ] SSE events follow defined format
  - [ ] Session ID returned in "done" event
  - [ ] JWT authentication via Authorization header (standard)
  - [ ] Module with DI bindings created
  - [ ] Proper error handling with appropriate status codes

---

### Phase 4: Frontend

- [ ] 8. Create useChatStream hook

  **What to do**:
  - Create `frontend/src/app/hooks/useChatStream.ts`
  - **Use fetch streaming (NOT EventSource)** to support POST with body:
    ```typescript
    const response = await fetch('/api/ai/chat/stream', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        // Auth handled by httpOnly cookie automatically
      },
      body: JSON.stringify({ sessionId, message }),
      credentials: 'include', // Include cookies
    });
    
    const reader = response.body?.getReader();
    const decoder = new TextDecoder();
    
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = decoder.decode(value);
      // Parse SSE format: "event: message\ndata: {...}\n\n"
      parseSSEChunk(chunk);
    }
    ```
  - Handle streaming chunks and accumulate response
  - Manage connection state (idle, connecting, streaming, complete, error)
  - Handle session ID persistence (localStorage key: `ai_chat_session_id`)
  - Parse SSE event format and dispatch to appropriate handlers
  - **Route through Next.js API proxy** (follows project pattern)

  **Must NOT do**:
  - DO NOT use EventSource (doesn't support POST)
  - DO NOT use WebSocket
  - DO NOT block UI during streaming
  - DO NOT call backend directly (use Next.js API proxy)

  **Parallelizable**: YES (with 9, 10) - after backend API ready

  **References**:
  - `frontend/src/app/hooks/useClients.ts` - Hook pattern
  - `frontend/src/app/lib/axios/client.ts` - API client pattern
  - MDN: ReadableStream for fetch streaming

  **Acceptance Criteria**:
  - [ ] Uses fetch with ReadableStream (not EventSource)
  - [ ] Streams response chunks to UI
  - [ ] Parses SSE event format correctly
  - [ ] Handles errors gracefully
  - [ ] Persists session ID in localStorage
  - [ ] Routes through Next.js API proxy

---

- [ ] 9. Create ChatInput component

  **What to do**:
  - Create `frontend/src/app/(components)/chat/ChatInput.tsx`
  - Design: Input box with send button, placed under hero on dashboard
  - On focus/click: trigger expansion animation to fullscreen
  - Use MUI components (TextField, IconButton)
  - Add placeholder text: "무엇을 도와드릴까요?" / "How can I help you?"

  **Must NOT do**:
  - DO NOT handle chat logic here (delegate to ChatFullscreen)
  - DO NOT make it too prominent (subtle design)

  **Parallelizable**: YES (with 8, 10)

  **References**:
  - `frontend/src/app/(components)/messages/forms/` - Form component patterns
  - ChatGPT/Gemini UI for design inspiration

  **Acceptance Criteria**:
  - [ ] Input box renders on dashboard
  - [ ] Click/focus triggers expansion
  - [ ] Smooth animation to fullscreen
  - [ ] Matches app design language

---

- [ ] 10. Create ChatFullscreen component

  **What to do**:
  - Create `frontend/src/app/(components)/chat/ChatFullscreen.tsx`
  - Design: Full-page chat interface (ChatGPT/Gemini-like)
    - Header with close button and title
    - Message list (scrollable, auto-scroll to bottom)
    - Input at bottom (fixed position)
    - Loading spinner while waiting for first chunk
  - Use `useChatStream` hook for communication
  - Render messages with proper styling:
    - User messages: right-aligned, primary color background
    - Assistant messages: left-aligned, neutral background
    - Streaming text: show with typing indicator
  - Handle SSE event types:
    - `chunk`: Append to current assistant message
    - `tool_call`: Show "Searching..." or "Processing..." indicator
    - `confirmation`: Show confirm/cancel buttons inline
    - `done`: Mark message complete
    - `error`: Show error alert
  - Add animation for entry/exit (Fade/Slide from bottom)
  - Mobile responsive: fullscreen should work on small screens

  **Must NOT do**:
  - DO NOT use complex state management (keep it simple with hook)
  - DO NOT persist messages in component state (use session from hook)

  **Parallelizable**: YES (with 8, 9)

  **References**:
  - `frontend/src/app/(components)/messages/forms/ContractCreationForm.tsx:1093-1127` - Dialog pattern
  - ChatGPT/Gemini UI for design

  **Acceptance Criteria**:
  - [ ] Full-page chat interface
  - [ ] Messages render correctly (user/assistant)
  - [ ] Streaming indicator shows during response
  - [ ] Loading spinner while waiting for first chunk
  - [ ] Confirmation buttons for CUD operations
  - [ ] Smooth animations
  - [ ] Mobile responsive

---

- [ ] 11. Integrate chat into Dashboard page

  **What to do**:
  - **IMPORTANT**: `dashboard/page.tsx` is an async Server Component (uses `await getLocale()`, `await getCurrentUser()`)
  - Cannot add `useState` directly to Server Component
  - **Solution**: Create a Client Component wrapper for chat functionality:
    1. Create `frontend/src/app/(components)/chat/ChatWidget.tsx` as a Client Component (`'use client'`)
    2. This component contains:
       - ChatInput component
       - State for fullscreen visibility: `const [isChatOpen, setIsChatOpen] = useState(false)`
       - ChatFullscreen component (rendered when open)
    3. Import and render `<ChatWidget />` in `dashboard/page.tsx` below hero section
  - Ensure existing dashboard functionality unchanged

  **Must NOT do**:
  - DO NOT add useState to dashboard/page.tsx (it's a Server Component)
  - DO NOT break existing dashboard layout
  - DO NOT make chat too intrusive
  - DO NOT use Zustand for chat visibility (local state in ChatWidget is sufficient)

  **Parallelizable**: NO (depends on 9, 10)

  **References**:
  - `frontend/src/app/dashboard/page.tsx` - Current dashboard structure (Server Component)
  - Next.js docs: Client Components vs Server Components

  **Acceptance Criteria**:
  - [ ] ChatWidget is a Client Component with 'use client' directive
  - [ ] ChatInput visible on dashboard below hero
  - [ ] Expands to ChatFullscreen on click
  - [ ] Can close and return to dashboard
  - [ ] Existing dashboard features work (server-side data fetching unchanged)
  - [ ] No layout shift when chat opens/closes

---

### Phase 5: Integration & Polish

- [ ] 12. Add chat session persistence via Next.js API proxy

  **What to do**:
  - **Follow project pattern**: All API calls go through Next.js API routes (not direct to backend)
  - Create `frontend/src/app/api/ai/chat/stream/route.ts`:
    - POST handler that proxies to backend and streams response back
    - **API URL pattern** (from `frontend/src/app/lib/axios/server.ts`):
      ```typescript
      const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'preview';
      const BACKEND_URL = isProduction
        ? process.env.NEXT_PUBLIC_API_BASE_URL
        : process.env.DEVELOPMENT_API_BASE_URL;
      ```
    - Use auth token from cookies (httpOnly cookie read server-side)
    - Stream response using `ReadableStream`:
      ```typescript
      import { cookies } from 'next/headers';
      
      export async function POST(request: Request) {
        const isProduction = process.env.NODE_ENV === 'production' || process.env.VERCEL_ENV === 'preview';
        const BACKEND_URL = isProduction
          ? process.env.NEXT_PUBLIC_API_BASE_URL
          : process.env.DEVELOPMENT_API_BASE_URL;
        
        const cookieStore = await cookies();
        const authToken = cookieStore.get('auth_token');
        const body = await request.json();
        
        const backendResponse = await fetch(`${BACKEND_URL}/api/ai/chat/stream`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${authToken?.value}`,
          },
          body: JSON.stringify(body),
        });
        
        // Stream the response back to client
        return new Response(backendResponse.body, {
          headers: {
            'Content-Type': 'text/event-stream',
            'Cache-Control': 'no-cache',
            'Connection': 'keep-alive',
          },
        });
      }
      ```
  - Create `frontend/src/app/api/ai/chat/session/[id]/route.ts`:
    - GET: Fetch session history (proxy to backend)
    - DELETE: Clear session (proxy to backend)
  - Store session ID in localStorage: `ai_chat_session_id`
  - On page load: Check localStorage for session ID → fetch session history → display messages
  - Session expiry handled by backend (returns empty/404 if expired)

  **Must NOT do**:
  - DO NOT call backend directly from client (use Next.js API proxy)
  - DO NOT store messages in localStorage (only session ID)
  - DO NOT expose backend URL to client

  **Parallelizable**: NO (depends on 3, 6, 7)

  **References**:
  - `frontend/src/app/api/clients/route.ts` - API route pattern
  - `frontend/src/app/lib/axios/server.ts` - serverAPIClient pattern
  - `frontend/src/app/lib/auth/cookies.ts` - Auth token access pattern

  **Acceptance Criteria**:
  - [ ] Next.js API route proxies SSE stream from backend
  - [ ] Session ID persists in localStorage
  - [ ] Previous messages load on return via GET endpoint
  - [ ] Auth token read from httpOnly cookie server-side
  - [ ] Session clears when backend returns expired
  - [ ] Follows project's API proxy pattern

---

- [ ] 13. E2E testing and verification

  **What to do**:
  - **IMPORTANT**: Playwright testDir is `./tests` (not `./tests/e2e`)
  - Create Playwright E2E tests in `frontend/tests/dashboard-chat.spec.ts`
  - Test scenarios:
    1. Open chat from dashboard - verify expansion animation
    2. Send message and receive streaming response
    3. Search for client via chat - verify results displayed
    4. Create client with confirmation flow - verify confirm/cancel buttons
    5. Create contract with confirmation flow
    6. Close chat and verify dashboard state restored
  - Create regression test `frontend/tests/contract-creation-regression.spec.ts`:
    - Verify existing /contracts/creation page still works
    - Complete full contract creation flow via iframe
  - Create backend unit tests:
    - `backend/test/ai-chat/gemini-chat.gateway.spec.ts`
    - `backend/test/ai-chat/tool-executor.service.spec.ts`
    - `backend/test/ai-chat/ai-chat.service.spec.ts`
  - **For E2E tests with Gemini**: Use recorded responses or mock server to avoid flaky tests
    - Option A: Use Playwright's route interception to mock Gemini responses
    - Option B: Create a test mode flag that uses canned responses
  - Manual verification in eFormSign sandbox environment

  **Must NOT do**:
  - DO NOT skip regression tests for existing features
  - DO NOT test with production eFormSign
  - DO NOT rely on live Gemini API in CI (will be flaky)
  - DO NOT put tests in `tests/e2e/` (Playwright config uses `tests/`)

  **Parallelizable**: NO (depends on all previous tasks)

  **References**:
  - `frontend/tests/` - Test directory (Playwright testDir)
  - `frontend/playwright.config.ts:7` - testDir: './tests'
  - `backend/test/` - Backend test directory
  - Playwright documentation

  **Acceptance Criteria**:
  - [ ] All E2E tests pass (with mocked Gemini responses)
  - [ ] All backend unit tests pass
  - [ ] Regression test confirms existing contract creation works
  - [ ] Manual verification in eFormSign sandbox successful
  - [ ] No console errors during E2E tests
  - [ ] Tests are in correct directory (`frontend/tests/`, not `frontend/tests/e2e/`)

---

## Success Criteria

### Final Checklist
- [ ] All "Must Have" features implemented
- [ ] All "Must NOT Have" guardrails respected
- [ ] Existing iframe-based contract creation unchanged
- [ ] Chat UI matches ChatGPT/Gemini design
- [ ] Streaming responses work smoothly
- [ ] Confirmation prompts for all CUD operations
- [ ] Session persists for 1 day
- [ ] All tests pass
- [ ] Code follows Clean Architecture patterns
