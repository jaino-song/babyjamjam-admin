# 통화 인박스 (Call Inbox) Phase 1 — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking. Tasks also carry `Tier/Sandbox/Paths/Depends` headers for the codex-task.sh mechanical dispatch convention.

**Goal:** n8n posts corrected call transcripts to an authenticated backend webhook; the backend classifies + extracts customer info into `client_draft` rows; staff review in a new mobile 통화요약 section and confirm 신규상담 drafts into real clients via the existing create path.

**Architecture:** Per-branch ingest tokens (hashed, DB-backed guard) allocate every call to a tenant. Extraction runs async behind a `CALL_EXTRACTION_PORT` (Gemini 2.5 Flash adapter, env-gated e2e stub) with a retry cron. Staff APIs follow existing `JwtGuard + TenantGuard` + page/limit pagination conventions. Mobile follows the BFF-proxy + React Query + mobile-redesign-primitives idiom.

**Tech Stack:** NestJS + Prisma (backend), Next.js App Router + TanStack Query + Tailwind/redesign.css (mobile), Gemini REST (extraction), jest + supertest (backend tests), jest + RTL (mobile tests).

**Spec:** `docs/superpowers/specs/2026-06-10-call-inbox-design.md` · **API sheet:** `docs/api/call-inbox-api.md` · **Wireframe:** `docs/mockups/call-inbox-wireframe.html`

**Scope notes (deviations none, clarifications two):**
- Phase 1 confirm is **NEW_CLIENT only** (per spec §13). `CLIENT_UPDATE` drafts are created, listed, viewable, linkable, discardable — their confirm endpoint returns **501** and the UI shows a disabled [변경 적용] button labeled "Phase 2". No dead code paths.
- The API sheet specified cursor pagination; the repo convention is **page/limit with `{data,total,page,limit,totalPages}`**. Implementation follows the repo convention; Task 18 syncs the API sheet.

**Working agreements:** All backend commands run from `backend/`, mobile from `mobile/`. Commit after each green task. `mobile-bottom-nav.test.tsx` and several mobile files have uncommitted user WIP — **read current file state before editing; never revert unrelated hunks.** New backend env var: `GEMINI_API_KEY` (reuse the key already used by n8n).

---

### Task 1: Prisma schema — 3 tables

**Tier:** standard · **Sandbox:** local · **Paths:** `backend/prisma/schema.prisma` · **Depends:** none

**Files:** Modify: `backend/prisma/schema.prisma` (append models; add back-relations to `branch`, `client`, `user`)

- [ ] **Step 1: Append models** at the end of `schema.prisma`:

```prisma
model call_ingest_token {
  id         String    @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  branchId   String    @map("branch_id") @db.Uuid
  tokenHash  String    @unique @map("token_hash")
  label      String
  active     Boolean   @default(true)
  lastUsedAt DateTime? @map("last_used_at") @db.Timestamptz(6)
  revokedAt  DateTime? @map("revoked_at") @db.Timestamptz(6)
  createdAt  DateTime  @default(now()) @map("created_at") @db.Timestamptz(6)
  branch     branch    @relation(fields: [branchId], references: [id], onDelete: NoAction, onUpdate: NoAction)

  @@index([branchId], map: "idx_call_ingest_token_branch")
}

model call_record {
  id                   String        @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  branchId             String        @map("branch_id") @db.Uuid
  driveFileId          String        @unique @map("drive_file_id")
  fileName             String        @map("file_name")
  recordedAt           DateTime?     @map("recorded_at") @db.Timestamptz(6)
  transcript           Json
  summary              Json?
  category             String?
  callerName           String?       @map("caller_name")
  callerPhone          String?       @map("caller_phone")
  matchedClientId      Int?          @map("matched_client_id")
  processingStatus     String        @default("RECEIVED") @map("processing_status")
  extractionRetryCount Int           @default(0) @map("extraction_retry_count")
  failureReason        String?       @map("failure_reason")
  createdAt            DateTime      @default(now()) @map("created_at") @db.Timestamptz(6)
  branch               branch        @relation(fields: [branchId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  matchedClient        client?       @relation(fields: [matchedClientId], references: [id], onDelete: SetNull, onUpdate: NoAction)
  draft                client_draft?

  @@index([branchId, createdAt], map: "idx_call_record_branch_created")
  @@index([branchId, category], map: "idx_call_record_branch_category")
  @@index([processingStatus], map: "idx_call_record_processing_status")
}

model client_draft {
  id             String      @id @default(dbgenerated("gen_random_uuid()")) @db.Uuid
  callRecordId   String      @unique @map("call_record_id") @db.Uuid
  branchId       String      @map("branch_id") @db.Uuid
  type           String
  status         String      @default("PENDING")
  clientId       Int?        @map("client_id")
  proposals      Json
  requestSummary String      @map("request_summary")
  extractionMeta Json?       @map("extraction_meta")
  reviewedById   String?     @map("reviewed_by_id") @db.Uuid
  reviewedAt     DateTime?   @map("reviewed_at") @db.Timestamptz(6)
  discardReason  String?     @map("discard_reason")
  createdAt      DateTime    @default(now()) @map("created_at") @db.Timestamptz(6)
  callRecord     call_record @relation(fields: [callRecordId], references: [id], onDelete: Cascade, onUpdate: NoAction)
  branch         branch      @relation(fields: [branchId], references: [id], onDelete: NoAction, onUpdate: NoAction)
  client         client?     @relation(fields: [clientId], references: [id], onDelete: SetNull, onUpdate: NoAction)
  reviewedBy     user?       @relation(fields: [reviewedById], references: [id], onDelete: SetNull, onUpdate: NoAction)

  @@index([branchId, status], map: "idx_client_draft_branch_status")
  @@index([clientId], map: "idx_client_draft_client")
}
```

Status/category/type values are plain strings validated in TypeScript (repo convention — no Prisma enums): `category ∈ NEW_CONSULTATION|CLIENT_SERVICE|OTHER`, `processingStatus ∈ RECEIVED|EXTRACTED|FAILED`, `type ∈ NEW_CLIENT|CLIENT_UPDATE`, `status ∈ PENDING|CONFIRMED|DISCARDED`.

- [ ] **Step 2: Add back-relations** to existing models (one line each, match surrounding style):
  - `model branch`: `callIngestTokens call_ingest_token[]`, `callRecords call_record[]`, `clientDrafts client_draft[]`
  - `model client`: `callRecords call_record[]`, `clientDrafts client_draft[]`
  - `model user`: `reviewedClientDrafts client_draft[]`

- [ ] **Step 3: Migrate + generate.** Run in `backend/`: `npx prisma format && npm run db:migrate -- --name add_call_inbox_tables` → expect new folder `prisma/migrations/<ts>_add_call_inbox_tables/` with `CREATE TABLE` for the 3 tables, no drops (additive-only; if the diff shows ANY drop, STOP — schema drift, ask the operator). Then `npm run type-check` → clean.

- [ ] **Step 4: Commit** `git add backend/prisma && git commit -m "feat(call-inbox): add call_ingest_token, call_record, client_draft tables"`

---

### Task 2: Phone normalization util

**Tier:** trivial · **Sandbox:** local · **Paths:** `backend/application/utils/normalize-phone.ts`, `backend/test/utils/normalize-phone.spec.ts` · **Depends:** none

- [ ] **Step 1: Write failing test** `backend/test/utils/normalize-phone.spec.ts`:

```typescript
import { normalizePhone, extractPhoneCandidates } from "application/utils/normalize-phone";

describe("normalizePhone", () => {
    it.each([
        ["010-1234-5678", "01012345678"],
        ["010 1234 5678", "01012345678"],
        ["+82 10-1234-5678", "01012345678"],
        ["+821012345678", "01012345678"],
        ["0212345678", "0212345678"],
    ])("normalizes %s to %s", (input, expected) => {
        expect(normalizePhone(input)).toBe(expected);
    });

    it("returns null for non-phone strings", () => {
        expect(normalizePhone("21호 2610")).toBeNull();
        expect(normalizePhone("")).toBeNull();
        expect(normalizePhone("1234")).toBeNull();
    });
});

describe("extractPhoneCandidates", () => {
    it("finds phone numbers inside a file name", () => {
        expect(extractPhoneCandidates("통화 녹음 김서연_010-4821-7763_250610_140211.m4a"))
            .toEqual(["01048217763"]);
    });

    it("returns empty array when none found", () => {
        expect(extractPhoneCandidates("recording-001.m4a")).toEqual([]);
    });
});
```

- [ ] **Step 2: Run** `npm test -- test/utils/normalize-phone.spec.ts` → FAIL (module not found).

- [ ] **Step 3: Implement** `backend/application/utils/normalize-phone.ts`:

```typescript
/**
 * Normalize a Korean phone number to bare digits ("01012345678").
 * Returns null when the input cannot plausibly be a KR phone number.
 */
export function normalizePhone(raw: string | null | undefined): string | null {
    if (!raw) return null;
    let digits = raw.replace(/\D/g, "");
    if (digits.startsWith("82")) {
        digits = `0${digits.slice(2)}`;
    }
    // KR numbers: 02-XXXXXXXX (9-10) or 0XX-XXXX-XXXX (10-11)
    if (digits.length < 9 || digits.length > 11 || !digits.startsWith("0")) {
        return null;
    }
    return digits;
}

/** Pull every plausible phone number out of free text (e.g. a recording file name). */
export function extractPhoneCandidates(text: string | null | undefined): string[] {
    if (!text) return [];
    const matches = text.match(/(\+?82[-\s.]?|0)1[0-9][-\s.]?\d{3,4}[-\s.]?\d{4}|0\d{1,2}[-\s.]?\d{3,4}[-\s.]?\d{4}/g) ?? [];
    const seen = new Set<string>();
    for (const m of matches) {
        const normalized = normalizePhone(m);
        if (normalized) seen.add(normalized);
    }
    return [...seen];
}
```

- [ ] **Step 4: Run** same command → PASS. **Commit** `feat(call-inbox): phone normalization util`.

---

### Task 3: Ingest token service + CallIngestGuard

**Tier:** standard · **Sandbox:** local · **Paths:** `backend/application/services/call-ingest-token.service.ts`, `backend/infrastructure/auth/call-ingest.guard.ts`, `backend/test/services/call-ingest-token.service.spec.ts`, `backend/test/infrastructure/auth/call-ingest.guard.spec.ts` · **Depends:** Task 1

- [ ] **Step 1: Write failing service test** `backend/test/services/call-ingest-token.service.spec.ts`:

```typescript
import { createHash } from "crypto";
import { CallIngestTokenService } from "application/services/call-ingest-token.service";

describe("CallIngestTokenService", () => {
    const prisma = {
        call_ingest_token: {
            create: jest.fn(),
            findUnique: jest.fn(),
            update: jest.fn(),
        },
    };
    let service: CallIngestTokenService;

    beforeEach(() => {
        jest.resetAllMocks();
        service = new CallIngestTokenService(prisma as never);
    });

    it("creates a token with cit_ prefix and stores only the sha256 hash", async () => {
        prisma.call_ingest_token.create.mockImplementation(async ({ data }: { data: { tokenHash: string } }) => ({
            id: "tok-1", ...data,
        }));

        const result = await service.createToken("branch-1", "인천본점 n8n");

        expect(result.token).toMatch(/^cit_[A-Za-z0-9_-]{43,}$/);
        const storedHash = prisma.call_ingest_token.create.mock.calls[0][0].data.tokenHash;
        expect(storedHash).toBe(createHash("sha256").update(result.token).digest("hex"));
        expect(prisma.call_ingest_token.create.mock.calls[0][0].data.branchId).toBe("branch-1");
    });

    it("resolves branchId for an active token and touches lastUsedAt", async () => {
        const token = "cit_test-token";
        prisma.call_ingest_token.findUnique.mockResolvedValue({
            id: "tok-1", branchId: "branch-1", active: true,
        });
        prisma.call_ingest_token.update.mockResolvedValue({});

        await expect(service.resolveBranchId(token)).resolves.toBe("branch-1");
        expect(prisma.call_ingest_token.findUnique).toHaveBeenCalledWith({
            where: { tokenHash: createHash("sha256").update(token).digest("hex") },
        });
        expect(prisma.call_ingest_token.update).toHaveBeenCalled();
    });

    it("returns null for revoked or unknown tokens", async () => {
        prisma.call_ingest_token.findUnique.mockResolvedValue({ id: "tok-1", branchId: "b", active: false });
        await expect(service.resolveBranchId("cit_revoked")).resolves.toBeNull();

        prisma.call_ingest_token.findUnique.mockResolvedValue(null);
        await expect(service.resolveBranchId("cit_unknown")).resolves.toBeNull();
    });

    it("revokes a token", async () => {
        prisma.call_ingest_token.update.mockResolvedValue({ id: "tok-1", active: false });
        await service.revoke("tok-1");
        expect(prisma.call_ingest_token.update).toHaveBeenCalledWith({
            where: { id: "tok-1" },
            data: { active: false, revokedAt: expect.any(Date) },
        });
    });
});
```

- [ ] **Step 2: Run** `npm test -- test/services/call-ingest-token.service.spec.ts` → FAIL.

- [ ] **Step 3: Implement** `backend/application/services/call-ingest-token.service.ts`:

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { createHash, randomBytes } from "crypto";
import { PrismaService } from "infrastructure/database/prisma.service";

export interface CreatedIngestToken {
    id: string;
    branchId: string;
    label: string;
    /** Plaintext token — returned exactly once at creation, never stored. */
    token: string;
}

@Injectable()
export class CallIngestTokenService {
    private readonly logger = new Logger(CallIngestTokenService.name);

    constructor(private readonly prismaService: PrismaService) {}

    private hash(token: string): string {
        return createHash("sha256").update(token).digest("hex");
    }

    async createToken(branchId: string, label: string): Promise<CreatedIngestToken> {
        const token = `cit_${randomBytes(32).toString("base64url")}`;
        const record = await this.prismaService.call_ingest_token.create({
            data: { branchId, label, tokenHash: this.hash(token) },
        });
        return { id: record.id, branchId, label, token };
    }

    /** Returns the owning branchId for an active token, else null. */
    async resolveBranchId(token: string): Promise<string | null> {
        const record = await this.prismaService.call_ingest_token.findUnique({
            where: { tokenHash: this.hash(token) },
        });
        if (!record || !record.active) return null;

        this.prismaService.call_ingest_token
            .update({ where: { id: record.id }, data: { lastUsedAt: new Date() } })
            .catch((error) => this.logger.warn(`Failed to touch lastUsedAt: ${error}`));

        return record.branchId;
    }

    async revoke(id: string): Promise<void> {
        await this.prismaService.call_ingest_token.update({
            where: { id },
            data: { active: false, revokedAt: new Date() },
        });
    }
}
```

Note: hash lookup makes timing-safe comparison unnecessary (attacker can't iterate DB rows), matching API-key best practice; `WebhookGuard`'s `timingSafeEqual` is only needed for its env-secret comparison.

- [ ] **Step 4: Run service test** → PASS.

- [ ] **Step 5: Write failing guard test** `backend/test/infrastructure/auth/call-ingest.guard.spec.ts`:

```typescript
import { ExecutionContext, UnauthorizedException } from "@nestjs/common";
import { CallIngestGuard } from "infrastructure/auth/call-ingest.guard";
import { CallIngestTokenService } from "application/services/call-ingest-token.service";

function contextWithAuth(header?: string): ExecutionContext {
    const request: Record<string, unknown> = { headers: header ? { authorization: header } : {} };
    return {
        switchToHttp: () => ({ getRequest: () => request }),
        __request: request,
    } as unknown as ExecutionContext & { __request: Record<string, unknown> };
}

describe("CallIngestGuard", () => {
    let tokenService: jest.Mocked<Pick<CallIngestTokenService, "resolveBranchId">>;
    let guard: CallIngestGuard;

    beforeEach(() => {
        tokenService = { resolveBranchId: jest.fn() };
        guard = new CallIngestGuard(tokenService as unknown as CallIngestTokenService);
    });

    it("attaches branchId from a valid token", async () => {
        tokenService.resolveBranchId.mockResolvedValue("branch-1");
        const context = contextWithAuth("Bearer cit_valid");

        await expect(guard.canActivate(context)).resolves.toBe(true);
        const request = (context as unknown as { __request: { callIngestBranchId?: string } }).__request;
        expect(request.callIngestBranchId).toBe("branch-1");
    });

    it("rejects missing header, malformed header, and unknown token", async () => {
        await expect(guard.canActivate(contextWithAuth())).rejects.toThrow(UnauthorizedException);
        await expect(guard.canActivate(contextWithAuth("Token abc"))).rejects.toThrow(UnauthorizedException);

        tokenService.resolveBranchId.mockResolvedValue(null);
        await expect(guard.canActivate(contextWithAuth("Bearer cit_bad"))).rejects.toThrow(UnauthorizedException);
    });
});
```

- [ ] **Step 6: Run** → FAIL. **Implement** `backend/infrastructure/auth/call-ingest.guard.ts`:

```typescript
import {
    Injectable,
    CanActivate,
    ExecutionContext,
    UnauthorizedException,
    Logger,
} from "@nestjs/common";
import { Request } from "express";
import { CallIngestTokenService } from "application/services/call-ingest-token.service";

/**
 * DB-backed bearer guard for the call-transcript webhook.
 * The token IS the branch allocation: payloads never carry branch identity.
 * Attaches the resolved branchId to request.callIngestBranchId.
 */
@Injectable()
export class CallIngestGuard implements CanActivate {
    private readonly logger = new Logger(CallIngestGuard.name);

    constructor(private readonly tokenService: CallIngestTokenService) {}

    async canActivate(context: ExecutionContext): Promise<boolean> {
        const request = context.switchToHttp().getRequest<Request & { callIngestBranchId?: string }>();
        const authHeader = request.headers.authorization;

        if (!authHeader) {
            this.logger.warn("Call ingest rejected: Missing Authorization header");
            throw new UnauthorizedException("Missing Authorization header");
        }

        const authMatch = authHeader.match(/^Bearer\s+(.+)$/);
        const token = authMatch?.[1]?.trim();
        if (!token) {
            this.logger.warn("Call ingest rejected: Invalid Authorization format");
            throw new UnauthorizedException("Invalid Authorization format");
        }

        const branchId = await this.tokenService.resolveBranchId(token);
        if (!branchId) {
            this.logger.warn("Call ingest rejected: Unknown or revoked token");
            throw new UnauthorizedException("Invalid token");
        }

        request.callIngestBranchId = branchId;
        return true;
    }
}
```

- [ ] **Step 7: Run both specs** → PASS. **Commit** `feat(call-inbox): ingest token service + DB-backed CallIngestGuard`.

---

### Task 4: Token admin endpoints

**Tier:** standard · **Sandbox:** local · **Paths:** `backend/interface/controllers/call-ingest-token.controller.ts`, `backend/interface/dto/call-inbox.dto.ts`, `backend/test/integration/call-ingest-token.controller.integration.spec.ts` · **Depends:** Task 3

- [ ] **Step 1: Create DTO file** `backend/interface/dto/call-inbox.dto.ts` (this file grows in Tasks 5 & 10; start it with):

```typescript
import { IsString, MaxLength } from "class-validator";

export class CreateCallIngestTokenDto {
    @IsString()
    @MaxLength(100)
    label!: string;
}
```

- [ ] **Step 2: Write failing integration test** `backend/test/integration/call-ingest-token.controller.integration.spec.ts` (mirror the eformsign integration-spec structure — `Test.createTestingModule` + supertest; mock `CallIngestTokenService`, override `JwtGuard`/`TenantGuard` with passthroughs that set the tenant context role):

```typescript
import { INestApplication, ExecutionContext } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { CallIngestTokenController } from "interface/controllers/call-ingest-token.controller";
import { CallIngestTokenService } from "application/services/call-ingest-token.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";
import { TenantContext } from "infrastructure/tenant/tenant.context";

describe("CallIngestTokenController (Integration)", () => {
    let app: INestApplication;
    let tokenService: jest.Mocked<Pick<CallIngestTokenService, "createToken" | "revoke">>;
    const tenantContext = { role: "owner", branchId: "branch-1", userId: "user-1", branchRole: "owner" };

    async function bootstrap(role: string) {
        tenantContext.role = role;
        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [CallIngestTokenController],
            providers: [
                { provide: CallIngestTokenService, useValue: tokenService },
                { provide: TenantContext, useValue: tenantContext },
            ],
        })
            .overrideGuard(JwtGuard).useValue({ canActivate: () => true })
            .overrideGuard(TenantGuard).useValue({
                canActivate: (context: ExecutionContext) => {
                    const req = context.switchToHttp().getRequest();
                    req.user = { userId: "user-1", branchId: "branch-1", role };
                    return true;
                },
            })
            .compile();
        app = moduleFixture.createNestApplication();
        await app.init();
    }

    beforeEach(() => {
        tokenService = { createToken: jest.fn(), revoke: jest.fn() };
    });

    afterEach(async () => { await app?.close(); });

    it("owner can create a token and receives plaintext once", async () => {
        await bootstrap("owner");
        tokenService.createToken.mockResolvedValue({
            id: "tok-1", branchId: "branch-1", label: "인천본점 n8n", token: "cit_plain",
        });

        const response = await request(app.getHttpServer())
            .post("/branches/branch-1/call-ingest-tokens")
            .send({ label: "인천본점 n8n" });

        expect(response.status).toBe(201);
        expect(response.body).toEqual({ id: "tok-1", branchId: "branch-1", label: "인천본점 n8n", token: "cit_plain" });
    });

    it("non-owner gets 403", async () => {
        await bootstrap("member");
        const response = await request(app.getHttpServer())
            .post("/branches/branch-1/call-ingest-tokens")
            .send({ label: "x" });
        expect(response.status).toBe(403);
        expect(tokenService.createToken).not.toHaveBeenCalled();
    });

    it("owner can revoke", async () => {
        await bootstrap("owner");
        tokenService.revoke.mockResolvedValue(undefined);
        const response = await request(app.getHttpServer()).post("/call-ingest-tokens/tok-1/revoke");
        expect(response.status).toBe(200);
        expect(tokenService.revoke).toHaveBeenCalledWith("tok-1");
    });
});
```

- [ ] **Step 3: Run** → FAIL. **Implement** `backend/interface/controllers/call-ingest-token.controller.ts`:

```typescript
import {
    Body,
    Controller,
    ForbiddenException,
    Param,
    Post,
    UseGuards,
} from "@nestjs/common";
import { CallIngestTokenService } from "application/services/call-ingest-token.service";
import { CreateCallIngestTokenDto } from "interface/dto/call-inbox.dto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";
import { TenantContext } from "infrastructure/tenant/tenant.context";

/** Phase 1 ops-level provisioning: owner-only (spec §5). */
@Controller()
@UseGuards(JwtGuard, TenantGuard)
export class CallIngestTokenController {
    constructor(
        private readonly tokenService: CallIngestTokenService,
        private readonly tenantContext: TenantContext,
    ) {}

    private assertOwner(): void {
        if (this.tenantContext.role !== "owner") {
            throw new ForbiddenException("Owner role required");
        }
    }

    @Post("branches/:branchId/call-ingest-tokens")
    async create(@Param("branchId") branchId: string, @Body() dto: CreateCallIngestTokenDto) {
        this.assertOwner();
        return this.tokenService.createToken(branchId, dto.label);
    }

    @Post("call-ingest-tokens/:id/revoke")
    async revoke(@Param("id") id: string) {
        this.assertOwner();
        await this.tokenService.revoke(id);
        return { success: true };
    }
}
```

- [ ] **Step 4: Run** → PASS. **Commit** `feat(call-inbox): owner-gated ingest token provisioning endpoints`.

---

### Task 5: Webhook — DTO, ingestion service, controller

**Tier:** standard · **Sandbox:** local · **Paths:** `backend/interface/dto/call-inbox.dto.ts`, `backend/application/services/call-ingestion.service.ts`, `backend/interface/controllers/call-transcript-webhook.controller.ts`, `backend/test/services/call-ingestion.service.spec.ts`, `backend/test/integration/call-transcript-webhook.controller.integration.spec.ts` · **Depends:** Task 3

- [ ] **Step 1: Extend DTO file** `backend/interface/dto/call-inbox.dto.ts` — append:

```typescript
import { Type } from "class-transformer";
import {
    ArrayMaxSize,
    ArrayMinSize,
    IsArray,
    IsDateString,
    IsObject,
    IsOptional,
    ValidateNested,
} from "class-validator";

export class TranscriptTurnDto {
    @IsString()
    @MaxLength(50)
    speaker!: string;

    @IsString()
    @MaxLength(5_000)
    text!: string;
}

export class CallSummaryDto {
    @IsOptional() @IsString() @MaxLength(2_000)
    inquiry_type?: string;

    @IsOptional() @IsString() @MaxLength(2_000)
    customer_info?: string;

    @IsOptional() @IsString() @MaxLength(5_000)
    key_content?: string;

    @IsOptional() @IsString() @MaxLength(2_000)
    result_action?: string;
}

export class CallTranscriptWebhookDto {
    @IsString()
    @MaxLength(200)
    fileId!: string;

    @IsString()
    @MaxLength(500)
    fileName!: string;

    @IsOptional()
    @IsDateString()
    recordedAt?: string;

    @IsArray()
    @ArrayMinSize(1)
    @ArrayMaxSize(2_000) // ~size cap: 2000 turns × 5KB text ≈ well under any sane call
    @ValidateNested({ each: true })
    @Type(() => TranscriptTurnDto)
    transcript!: TranscriptTurnDto[];

    @IsOptional()
    @IsObject()
    @ValidateNested()
    @Type(() => CallSummaryDto)
    summary?: CallSummaryDto;
}
```

(Adjust the top-of-file import list to a single merged `class-validator` import; `@MaxLength` array+string caps ARE the 413-equivalent guard — oversized payloads fail validation with 400, which n8n treats as non-retryable. Note this in the API-sheet sync, Task 18.)

- [ ] **Step 2: Write failing ingestion-service test** `backend/test/services/call-ingestion.service.spec.ts`:

```typescript
import { CallIngestionService } from "application/services/call-ingestion.service";

describe("CallIngestionService", () => {
    const prisma = {
        call_record: { findUnique: jest.fn(), create: jest.fn() },
    };
    const processingService = { processCallRecord: jest.fn() };
    let service: CallIngestionService;

    const payload = {
        fileId: "drive-1",
        fileName: "통화 녹음 김서연_010-4821-7763.m4a",
        recordedAt: "2026-06-10T05:02:11.000Z",
        transcript: [{ speaker: "고객", text: "산후도우미 문의요" }],
        summary: { inquiry_type: "예약 문의", key_content: "..." },
    };

    beforeEach(() => {
        jest.resetAllMocks();
        processingService.processCallRecord.mockResolvedValue(undefined);
        service = new CallIngestionService(prisma as never, processingService as never);
    });

    it("creates a RECEIVED call_record and kicks off processing", async () => {
        prisma.call_record.findUnique.mockResolvedValue(null);
        prisma.call_record.create.mockResolvedValue({ id: "rec-1" });

        const result = await service.ingest("branch-1", payload);

        expect(result).toEqual({ duplicate: false, callRecordId: "rec-1" });
        expect(prisma.call_record.create).toHaveBeenCalledWith({
            data: expect.objectContaining({
                branchId: "branch-1",
                driveFileId: "drive-1",
                fileName: payload.fileName,
                recordedAt: new Date(payload.recordedAt),
                transcript: payload.transcript,
                summary: payload.summary,
                processingStatus: "RECEIVED",
            }),
        });
        expect(processingService.processCallRecord).toHaveBeenCalledWith("rec-1");
    });

    it("is idempotent on driveFileId", async () => {
        prisma.call_record.findUnique.mockResolvedValue({ id: "rec-existing" });

        const result = await service.ingest("branch-1", payload);

        expect(result).toEqual({ duplicate: true, callRecordId: "rec-existing" });
        expect(prisma.call_record.create).not.toHaveBeenCalled();
        expect(processingService.processCallRecord).not.toHaveBeenCalled();
    });

    it("does not fail ingestion when processing kickoff rejects", async () => {
        prisma.call_record.findUnique.mockResolvedValue(null);
        prisma.call_record.create.mockResolvedValue({ id: "rec-1" });
        processingService.processCallRecord.mockRejectedValue(new Error("LLM down"));

        await expect(service.ingest("branch-1", payload)).resolves.toEqual({
            duplicate: false,
            callRecordId: "rec-1",
        });
    });
});
```

- [ ] **Step 3: Run** → FAIL. **Implement** `backend/application/services/call-ingestion.service.ts`:

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "infrastructure/database/prisma.service";
import { CallProcessingService } from "application/services/call-processing.service";
import { CallTranscriptWebhookDto } from "interface/dto/call-inbox.dto";

export interface IngestResult {
    duplicate: boolean;
    callRecordId: string;
}

@Injectable()
export class CallIngestionService {
    private readonly logger = new Logger(CallIngestionService.name);

    constructor(
        private readonly prismaService: PrismaService,
        private readonly processingService: CallProcessingService,
    ) {}

    async ingest(branchId: string, payload: CallTranscriptWebhookDto): Promise<IngestResult> {
        const existing = await this.prismaService.call_record.findUnique({
            where: { driveFileId: payload.fileId },
        });
        if (existing) {
            this.logger.log(`Duplicate webhook for drive file ${payload.fileId}; no-op`);
            return { duplicate: true, callRecordId: existing.id };
        }

        const record = await this.prismaService.call_record.create({
            data: {
                branchId,
                driveFileId: payload.fileId,
                fileName: payload.fileName,
                recordedAt: payload.recordedAt ? new Date(payload.recordedAt) : null,
                transcript: payload.transcript as object[],
                summary: payload.summary ?? undefined,
                processingStatus: "RECEIVED",
            },
        });

        // Fire-and-forget (repo convention): webhook responds immediately,
        // extraction failures land in FAILED status for the retry cron.
        this.processingService.processCallRecord(record.id).catch((error) => {
            this.logger.error(`Extraction kickoff failed for ${record.id}: ${error}`);
        });

        return { duplicate: false, callRecordId: record.id };
    }
}
```

Note: `CallProcessingService` doesn't exist until Task 6. To keep this task green standalone, create a minimal placeholder now — `backend/application/services/call-processing.service.ts`:

```typescript
import { Injectable, Logger } from "@nestjs/common";

@Injectable()
export class CallProcessingService {
    private readonly logger = new Logger(CallProcessingService.name);

    // Implemented in the extraction task; ingestion only needs the contract.
    async processCallRecord(callRecordId: string): Promise<void> {
        this.logger.warn(`processCallRecord(${callRecordId}) placeholder invoked`);
    }
}
```

- [ ] **Step 4: Run** → PASS.

- [ ] **Step 5: Write failing webhook integration test** `backend/test/integration/call-transcript-webhook.controller.integration.spec.ts`:

```typescript
import { INestApplication } from "@nestjs/common";
import { Test, TestingModule } from "@nestjs/testing";
import request from "supertest";
import { CallTranscriptWebhookController } from "interface/controllers/call-transcript-webhook.controller";
import { CallIngestionService } from "application/services/call-ingestion.service";
import { CallIngestTokenService } from "application/services/call-ingest-token.service";
import { CallIngestGuard } from "infrastructure/auth/call-ingest.guard";
import { GlobalValidationPipe } from "infrastructure/pipes/global-validation.pipe";

describe("CallTranscriptWebhookController (Integration)", () => {
    let app: INestApplication;
    let ingestionService: jest.Mocked<Pick<CallIngestionService, "ingest">>;
    let tokenService: jest.Mocked<Pick<CallIngestTokenService, "resolveBranchId">>;

    const payload = {
        fileId: "drive-1",
        fileName: "통화 녹음 김서연_010-4821-7763.m4a",
        transcript: [{ speaker: "고객", text: "산후도우미 문의요" }],
    };

    beforeEach(async () => {
        ingestionService = { ingest: jest.fn() };
        tokenService = { resolveBranchId: jest.fn() };

        const moduleFixture: TestingModule = await Test.createTestingModule({
            controllers: [CallTranscriptWebhookController],
            providers: [
                CallIngestGuard,
                { provide: CallIngestionService, useValue: ingestionService },
                { provide: CallIngestTokenService, useValue: tokenService },
            ],
        }).compile();

        app = moduleFixture.createNestApplication();
        app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        await app.init();
    });

    afterEach(async () => { await app.close(); });

    it("202 + accepted on a fresh file, branch comes from the token", async () => {
        tokenService.resolveBranchId.mockResolvedValue("branch-1");
        ingestionService.ingest.mockResolvedValue({ duplicate: false, callRecordId: "rec-1" });

        const response = await request(app.getHttpServer())
            .post("/webhooks/call-transcripts")
            .set({ Authorization: "Bearer cit_valid" })
            .send(payload);

        expect(response.status).toBe(202);
        expect(response.body).toEqual({ accepted: true, duplicate: false, callRecordId: "rec-1" });
        expect(ingestionService.ingest).toHaveBeenCalledWith("branch-1", expect.objectContaining({ fileId: "drive-1" }));
    });

    it("200 no-op on duplicate", async () => {
        tokenService.resolveBranchId.mockResolvedValue("branch-1");
        ingestionService.ingest.mockResolvedValue({ duplicate: true, callRecordId: "rec-1" });

        const response = await request(app.getHttpServer())
            .post("/webhooks/call-transcripts")
            .set({ Authorization: "Bearer cit_valid" })
            .send(payload);

        expect(response.status).toBe(200);
        expect(response.body).toEqual({ accepted: true, duplicate: true, callRecordId: "rec-1" });
    });

    it("401 without a valid token", async () => {
        tokenService.resolveBranchId.mockResolvedValue(null);
        const response = await request(app.getHttpServer())
            .post("/webhooks/call-transcripts")
            .set({ Authorization: "Bearer cit_bad" })
            .send(payload);
        expect(response.status).toBe(401);
        expect(ingestionService.ingest).not.toHaveBeenCalled();
    });

    it("400 on invalid payload (missing transcript)", async () => {
        tokenService.resolveBranchId.mockResolvedValue("branch-1");
        const response = await request(app.getHttpServer())
            .post("/webhooks/call-transcripts")
            .set({ Authorization: "Bearer cit_valid" })
            .send({ fileId: "drive-1", fileName: "x.m4a" });
        expect(response.status).toBe(400);
    });
});
```

- [ ] **Step 6: Run** → FAIL. **Implement** `backend/interface/controllers/call-transcript-webhook.controller.ts`:

```typescript
import { Body, Controller, Post, Req, Res, UseGuards, Logger } from "@nestjs/common";
import { Request, Response } from "express";
import { CallIngestionService } from "application/services/call-ingestion.service";
import { CallTranscriptWebhookDto } from "interface/dto/call-inbox.dto";
import { CallIngestGuard } from "infrastructure/auth/call-ingest.guard";

/**
 * n8n posts corrected call transcripts here. Branch identity comes ONLY from
 * the ingest token (CallIngestGuard). 202 fresh / 200 duplicate (idempotent).
 */
@Controller("webhooks/call-transcripts")
@UseGuards(CallIngestGuard)
export class CallTranscriptWebhookController {
    private readonly logger = new Logger(CallTranscriptWebhookController.name);

    constructor(private readonly ingestionService: CallIngestionService) {}

    @Post()
    async handleWebhook(
        @Req() request: Request & { callIngestBranchId?: string },
        @Body() payload: CallTranscriptWebhookDto,
        @Res({ passthrough: true }) response: Response,
    ) {
        const branchId = request.callIngestBranchId as string;
        this.logger.log(`Received call transcript ${payload.fileId} for branch ${branchId}`);

        const result = await this.ingestionService.ingest(branchId, payload);
        response.status(result.duplicate ? 200 : 202);
        return { accepted: true, duplicate: result.duplicate, callRecordId: result.callRecordId };
    }
}
```

- [ ] **Step 7: Run both specs** → PASS. **Commit** `feat(call-inbox): authenticated call-transcript webhook with idempotent ingestion`.

---

### Task 6: Extraction port, prompt, Gemini adapter

**Tier:** standard · **Sandbox:** local · **Paths:** `backend/domain/ports/call-extraction.port.ts`, `backend/application/services/call-extraction.prompt.ts`, `backend/infrastructure/api/gemini-call-extraction.adapter.ts`, `backend/infrastructure/vendor-stubs/e2e-vendor-stubs.ts`, `backend/test/infrastructure/api/gemini-call-extraction.adapter.spec.ts` · **Depends:** none (parallel-safe with Tasks 2-5)

- [ ] **Step 1: Define the port** `backend/domain/ports/call-extraction.port.ts`:

```typescript
export const CALL_EXTRACTION_PORT = Symbol("CallExtractionPort");

export type CallCategory = "NEW_CONSULTATION" | "CLIENT_SERVICE" | "OTHER";

export interface TranscriptTurn {
    speaker: string;
    text: string;
}

export interface ExtractionProposal {
    /** client column name, validated against PROPOSAL_FIELDS allowlist */
    field: string;
    value: string | number | boolean | null;
    /** verbatim transcript quote backing the value */
    evidence: string;
    confidence: "high" | "low";
}

export interface CallExtractionInput {
    transcript: TranscriptTurn[];
    summary?: Record<string, unknown> | null;
    fileName: string;
}

export interface CallExtractionResult {
    category: CallCategory;
    callerName: string | null;
    /** phone numbers spoken in the call, raw as heard (normalization happens outside) */
    callerPhoneCandidates: string[];
    /** one-line Korean summary of what the caller asked for */
    requestSummary: string;
    proposals: ExtractionProposal[];
}

export interface CallExtractionPort {
    extract(input: CallExtractionInput): Promise<CallExtractionResult>;
}
```

- [ ] **Step 2: Prompt constant** `backend/application/services/call-extraction.prompt.ts`:

```typescript
export const CALL_EXTRACTION_PROMPT_VERSION = "v1";

/** client fields a proposal may target (spec §6) */
export const PROPOSAL_FIELDS = [
    "name", "phone", "address", "dueDate", "birthday",
    "startDate", "endDate", "duration", "type",
    "careCenter", "voucherClient", "breastPump",
    "serviceStatus", "fullPrice", "grant", "actualPrice",
] as const;

export function buildCallExtractionPrompt(input: {
    transcript: { speaker: string; text: string }[];
    summary?: Record<string, unknown> | null;
    fileName: string;
}): string {
    const transcriptText = input.transcript
        .map((turn) => `[${turn.speaker}] ${turn.text}`)
        .join("\n");

    return `# Role
당신은 '아이미래로'(산후도우미·산모신생아 건강관리 업체)의 통화 분석 전문가입니다.
정제된 통화 스크립트를 읽고 (1) 통화를 분류하고 (2) 고객/서비스 정보를 구조화하여 추출합니다.

# 용어 참고 (STT 잔여 오류 보정)
산우도우미→산후도우미, 구리원/조류원→조리원, 알루사님→관리사님, 재앙절개→제왕절개,
단퇴→단태아, 쌍/쌍둥→쌍둥이, A가/가형→A가형, A라/라형→A라형, A 통합→A-통합형,
나비/라비→납입(결제 문맥). 날짜·금액·전화번호 숫자는 절대 변형 금지.

# 분류 (category)
- NEW_CONSULTATION: 산후도우미 서비스를 새로 시작하려는 문의/상담 (예약, 견적, 정부지원 문의 포함)
- CLIENT_SERVICE: 이미 서비스 이용 중이거나 계약된 고객의 변경/요청
  (출산예정일·시작일·종료일 변경, 관리사 교체, 기간 연장, 서비스 종료, 일정 조정 등)
- OTHER: 그 외 전부 (주차, 제휴/영업, 오배송, 잘못 건 전화, 스팸 등)

# 추출 규칙
- callerName: 고객(산모) 이름. 언급 없으면 null.
- callerPhoneCandidates: 통화에서 "불러준" 전화번호들 (들리는 그대로). 없으면 [].
  파일명에도 번호가 있을 수 있으나 그것은 시스템이 따로 처리하므로 무시.
- requestSummary: 고객 요청을 한국어 한 문장으로.
- proposals: category별로 다음 필드만 사용 (그 외 필드명 금지):
  ${PROPOSAL_FIELDS.join(", ")}
  - NEW_CONSULTATION: 파악된 모든 고객 정보 (name, phone, address, dueDate,
    duration(일수, 숫자), careCenter(조리원 이용, boolean), voucherClient(정부지원, boolean),
    startDate(희망 시작일), type 등)
  - CLIENT_SERVICE: 변경 요청된 필드만. 관리사 교체 요청 → field "serviceStatus",
    value "active_with_replacement_requested". 서비스 종료 요청 → "serviceStatus", "terminated".
  - OTHER: proposals는 [].
- 각 proposal: value(날짜는 YYYY-MM-DD, 기간은 일수 숫자, boolean은 true/false),
  evidence(근거가 된 발화 인용, 원문 그대로), confidence("high" | "low").
- 언급되지 않은 필드는 proposals에 포함하지 마십시오. "해당 없음"도 포함 금지.
- 추측은 confidence "low"로 표시 (예: "부평구청 근처" → address, low).

# 입력
파일명: ${input.fileName}
${input.summary ? `1차 요약: ${JSON.stringify(input.summary)}` : ""}

# 스크립트
${transcriptText}`;
}

/** Gemini structured-output schema for the extraction call */
export const CALL_EXTRACTION_RESPONSE_SCHEMA = {
    type: "OBJECT",
    properties: {
        category: { type: "STRING", enum: ["NEW_CONSULTATION", "CLIENT_SERVICE", "OTHER"] },
        callerName: { type: "STRING", nullable: true },
        callerPhoneCandidates: { type: "ARRAY", items: { type: "STRING" } },
        requestSummary: { type: "STRING" },
        proposals: {
            type: "ARRAY",
            items: {
                type: "OBJECT",
                properties: {
                    field: { type: "STRING" },
                    value: { type: "STRING", nullable: true },
                    evidence: { type: "STRING" },
                    confidence: { type: "STRING", enum: ["high", "low"] },
                },
                required: ["field", "value", "evidence", "confidence"],
            },
        },
    },
    required: ["category", "callerPhoneCandidates", "requestSummary", "proposals"],
} as const;
```

(Gemini structured output can't express union value types — `value` comes back as a string; the processing service coerces `"true"/"false"` to boolean and numeric strings to numbers for `duration`. That coercion is Task 7 code.)

- [ ] **Step 3: Write failing adapter test** `backend/test/infrastructure/api/gemini-call-extraction.adapter.spec.ts`:

```typescript
import { GeminiCallExtractionAdapter } from "infrastructure/api/gemini-call-extraction.adapter";

describe("GeminiCallExtractionAdapter", () => {
    const configService = {
        get: jest.fn((key: string) => (key === "GEMINI_API_KEY" ? "test-key" : undefined)),
    };
    const input = {
        transcript: [{ speaker: "고객", text: "7월 15일이 예정일이에요" }],
        summary: null,
        fileName: "rec.m4a",
    };
    const geminiResult = {
        category: "NEW_CONSULTATION",
        callerName: "김서연",
        callerPhoneCandidates: ["010-4821-7763"],
        requestSummary: "산후도우미 신규 문의",
        proposals: [
            { field: "dueDate", value: "2026-07-15", evidence: "7월 15일이 예정일이에요", confidence: "high" },
        ],
    };

    afterEach(() => {
        jest.restoreAllMocks();
    });

    it("calls Gemini generateContent and parses the structured JSON", async () => {
        const fetchMock = jest.spyOn(global, "fetch" as never).mockResolvedValue({
            ok: true,
            json: async () => ({
                candidates: [{ content: { parts: [{ text: JSON.stringify(geminiResult) }] } }],
            }),
        } as never);

        const adapter = new GeminiCallExtractionAdapter(configService as never);
        const result = await adapter.extract(input);

        expect(result).toEqual(geminiResult);
        const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
        expect(url).toContain("gemini-2.5-flash:generateContent");
        expect((init.headers as Record<string, string>)["x-goog-api-key"]).toBe("test-key");
        const body = JSON.parse(init.body as string);
        expect(body.generationConfig.responseMimeType).toBe("application/json");
    });

    it("throws a descriptive error on non-OK responses", async () => {
        jest.spyOn(global, "fetch" as never).mockResolvedValue({
            ok: false, status: 429, text: async () => "rate limited",
        } as never);

        const adapter = new GeminiCallExtractionAdapter(configService as never);
        await expect(adapter.extract(input)).rejects.toThrow(/Gemini extraction failed \(429\)/);
    });

    it("throws when GEMINI_API_KEY is missing", async () => {
        const emptyConfig = { get: jest.fn(() => undefined) };
        const adapter = new GeminiCallExtractionAdapter(emptyConfig as never);
        await expect(adapter.extract(input)).rejects.toThrow(/GEMINI_API_KEY/);
    });
});
```

- [ ] **Step 4: Run** → FAIL. **Implement** `backend/infrastructure/api/gemini-call-extraction.adapter.ts`:

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { ConfigService } from "@nestjs/config";
import {
    CallExtractionInput,
    CallExtractionPort,
    CallExtractionResult,
} from "domain/ports/call-extraction.port";
import {
    buildCallExtractionPrompt,
    CALL_EXTRACTION_RESPONSE_SCHEMA,
} from "application/services/call-extraction.prompt";

const GEMINI_URL =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent";
const TIMEOUT_MS = 60_000;

@Injectable()
export class GeminiCallExtractionAdapter implements CallExtractionPort {
    private readonly logger = new Logger(GeminiCallExtractionAdapter.name);

    constructor(private readonly configService: ConfigService) {}

    async extract(input: CallExtractionInput): Promise<CallExtractionResult> {
        const apiKey = this.configService.get<string>("GEMINI_API_KEY")?.trim() ?? "";
        if (!apiKey) {
            throw new Error("GEMINI_API_KEY not configured");
        }

        const response = await fetch(GEMINI_URL, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "x-goog-api-key": apiKey,
            },
            body: JSON.stringify({
                contents: [{ parts: [{ text: buildCallExtractionPrompt(input) }] }],
                generationConfig: {
                    responseMimeType: "application/json",
                    responseSchema: CALL_EXTRACTION_RESPONSE_SCHEMA,
                },
            }),
            signal: AbortSignal.timeout(TIMEOUT_MS),
        });

        if (!response.ok) {
            const detail = await response.text().catch(() => "");
            throw new Error(`Gemini extraction failed (${response.status}): ${detail.slice(0, 500)}`);
        }

        const data = (await response.json()) as {
            candidates?: { content?: { parts?: { text?: string }[] } }[];
        };
        const text = data.candidates?.[0]?.content?.parts?.[0]?.text;
        if (!text) {
            throw new Error("Gemini extraction returned no candidates");
        }

        return JSON.parse(text) as CallExtractionResult;
    }
}
```

- [ ] **Step 5: e2e vendor stub.** Open `backend/infrastructure/vendor-stubs/e2e-vendor-stubs.ts`, read how `createEformsignClientRepository(configService)` gates on the e2e env flag, and append a factory following the SAME gating convention (same env var the file already uses):

```typescript
// Append, reusing the file's existing env-flag helper/convention:
import { CallExtractionPort } from "domain/ports/call-extraction.port";
import { GeminiCallExtractionAdapter } from "infrastructure/api/gemini-call-extraction.adapter";

export class StubCallExtractionAdapter implements CallExtractionPort {
    async extract() {
        return {
            category: "NEW_CONSULTATION" as const,
            callerName: "김서연",
            callerPhoneCandidates: ["010-4821-7763"],
            requestSummary: "산후도우미 신규 문의 (E2E stub)",
            proposals: [
                { field: "name", value: "김서연", evidence: "stub", confidence: "high" as const },
                { field: "dueDate", value: "2026-07-15", evidence: "stub", confidence: "high" as const },
            ],
        };
    }
}

export function createCallExtractionAdapter(configService: ConfigService): CallExtractionPort {
    // mirror the exact stub-enable check used by createEformsignClientRepository above
    if (isE2eVendorStubEnabled(configService)) {
        return new StubCallExtractionAdapter();
    }
    return new GeminiCallExtractionAdapter(configService);
}
```

(If the existing file's gate is an inline expression rather than a helper named `isE2eVendorStubEnabled`, replicate that exact expression — do not invent a new flag.)

- [ ] **Step 6: Run adapter spec** → PASS. `npm run type-check` → clean. **Commit** `feat(call-inbox): extraction port, versioned prompt, Gemini adapter + e2e stub`.

---

### Task 7: CallProcessingService — classify, match, draft

**Tier:** standard · **Sandbox:** local · **Paths:** `backend/application/services/call-processing.service.ts`, `backend/test/services/call-processing.service.spec.ts` · **Depends:** Tasks 1, 2, 5, 6

- [ ] **Step 1: Write failing tests** `backend/test/services/call-processing.service.spec.ts`:

```typescript
import { CallProcessingService } from "application/services/call-processing.service";
import { CallExtractionResult } from "domain/ports/call-extraction.port";

describe("CallProcessingService", () => {
    const prisma = {
        call_record: { findUnique: jest.fn(), update: jest.fn() },
        client: { findMany: jest.fn() },
        client_draft: { create: jest.fn() },
    };
    const extractionPort = { extract: jest.fn() };
    let service: CallProcessingService;

    const record = {
        id: "rec-1",
        branchId: "branch-1",
        fileName: "통화 녹음 김서연_010-4821-7763.m4a",
        transcript: [{ speaker: "고객", text: "..." }],
        summary: null,
        processingStatus: "RECEIVED",
        extractionRetryCount: 0,
    };

    function extraction(partial: Partial<CallExtractionResult>): CallExtractionResult {
        return {
            category: "OTHER",
            callerName: null,
            callerPhoneCandidates: [],
            requestSummary: "요약",
            proposals: [],
            ...partial,
        };
    }

    beforeEach(() => {
        jest.resetAllMocks();
        prisma.call_record.findUnique.mockResolvedValue(record);
        prisma.client.findMany.mockResolvedValue([]);
        prisma.call_record.update.mockResolvedValue({});
        prisma.client_draft.create.mockResolvedValue({ id: "draft-1" });
        service = new CallProcessingService(prisma as never, extractionPort as never);
    });

    it("OTHER: updates record, creates no draft (parking-call fixture)", async () => {
        extractionPort.extract.mockResolvedValue(extraction({
            category: "OTHER",
            requestSummary: "주차 정기권 차량 번호 변경 요청",
        }));

        await service.processCallRecord("rec-1");

        expect(prisma.client_draft.create).not.toHaveBeenCalled();
        expect(prisma.call_record.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "rec-1" },
            data: expect.objectContaining({ category: "OTHER", processingStatus: "EXTRACTED" }),
        }));
    });

    it("NEW_CONSULTATION: creates a NEW_CLIENT draft with normalized phone (from transcript or filename)", async () => {
        extractionPort.extract.mockResolvedValue(extraction({
            category: "NEW_CONSULTATION",
            callerName: "김서연",
            callerPhoneCandidates: ["010-4821-7763"],
            requestSummary: "산후도우미 신규 문의",
            proposals: [
                { field: "name", value: "김서연", evidence: "김서연이요", confidence: "high" },
                { field: "duration", value: "10", evidence: "10일이요", confidence: "high" },
                { field: "careCenter", value: "false", evidence: "조리원은 안 가요", confidence: "high" },
                { field: "hairColor", value: "x", evidence: "x", confidence: "low" }, // not allowlisted → dropped
            ],
        }));

        await service.processCallRecord("rec-1");

        const draftData = prisma.client_draft.create.mock.calls[0][0].data;
        expect(draftData.type).toBe("NEW_CLIENT");
        expect(draftData.branchId).toBe("branch-1");
        expect(draftData.callRecordId).toBe("rec-1");
        // value coercion + allowlist filtering
        expect(draftData.proposals).toEqual([
            { field: "name", value: "김서연", evidence: "김서연이요", confidence: "high" },
            { field: "duration", value: 10, evidence: "10일이요", confidence: "high" },
            { field: "careCenter", value: false, evidence: "조리원은 안 가요", confidence: "high" },
        ]);
        expect(draftData.extractionMeta).toEqual(expect.objectContaining({ promptVersion: "v1" }));
        expect(prisma.call_record.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ callerPhone: "01048217763", callerName: "김서연" }),
        }));
    });

    it("CLIENT_SERVICE with phone match: links client on record and draft", async () => {
        prisma.client.findMany.mockResolvedValue([
            { id: 142, name: "박지은", phone: "010-2210-9987" },
        ]);
        extractionPort.extract.mockResolvedValue(extraction({
            category: "CLIENT_SERVICE",
            callerName: "박지은",
            callerPhoneCandidates: ["010 2210 9987"],
            requestSummary: "시작일 6/23 변경 요청",
            proposals: [
                { field: "startDate", value: "2026-06-23", evidence: "23일부터 가능할까요", confidence: "high" },
            ],
        }));

        await service.processCallRecord("rec-1");

        const draftData = prisma.client_draft.create.mock.calls[0][0].data;
        expect(draftData.type).toBe("CLIENT_UPDATE");
        expect(draftData.clientId).toBe(142);
        expect(prisma.call_record.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ matchedClientId: 142 }),
        }));
    });

    it("CLIENT_SERVICE unmatched: draft created with clientId null", async () => {
        extractionPort.extract.mockResolvedValue(extraction({
            category: "CLIENT_SERVICE",
            requestSummary: "관리사 교체 요청",
            proposals: [
                { field: "serviceStatus", value: "active_with_replacement_requested", evidence: "교체해 주세요", confidence: "high" },
            ],
        }));

        await service.processCallRecord("rec-1");

        expect(prisma.client_draft.create.mock.calls[0][0].data.clientId).toBeNull();
    });

    it("marks FAILED with reason when extraction throws", async () => {
        extractionPort.extract.mockRejectedValue(new Error("Gemini extraction failed (429)"));

        await service.processCallRecord("rec-1");

        expect(prisma.call_record.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                processingStatus: "FAILED",
                failureReason: expect.stringContaining("429"),
            }),
        }));
        expect(prisma.client_draft.create).not.toHaveBeenCalled();
    });

    it("skips records that are not RECEIVED/FAILED (already extracted)", async () => {
        prisma.call_record.findUnique.mockResolvedValue({ ...record, processingStatus: "EXTRACTED" });
        await service.processCallRecord("rec-1");
        expect(extractionPort.extract).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run** → FAIL. **Step 3: Replace the Task-5 placeholder** `backend/application/services/call-processing.service.ts` with the real implementation:

```typescript
import { Inject, Injectable, Logger } from "@nestjs/common";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    CALL_EXTRACTION_PORT,
    CallExtractionPort,
    CallExtractionResult,
    ExtractionProposal,
    TranscriptTurn,
} from "domain/ports/call-extraction.port";
import {
    CALL_EXTRACTION_PROMPT_VERSION,
    PROPOSAL_FIELDS,
} from "application/services/call-extraction.prompt";
import { extractPhoneCandidates, normalizePhone } from "application/utils/normalize-phone";

const BOOLEAN_FIELDS = new Set(["careCenter", "voucherClient", "breastPump"]);
const NUMBER_FIELDS = new Set(["duration"]);
const ALLOWED_FIELDS = new Set<string>(PROPOSAL_FIELDS);

@Injectable()
export class CallProcessingService {
    private readonly logger = new Logger(CallProcessingService.name);

    constructor(
        private readonly prismaService: PrismaService,
        @Inject(CALL_EXTRACTION_PORT)
        private readonly extractionPort: CallExtractionPort,
    ) {}

    async processCallRecord(callRecordId: string): Promise<void> {
        const record = await this.prismaService.call_record.findUnique({
            where: { id: callRecordId },
        });
        if (!record) {
            this.logger.warn(`call_record ${callRecordId} not found; skipping`);
            return;
        }
        if (record.processingStatus !== "RECEIVED" && record.processingStatus !== "FAILED") {
            return; // already extracted (idempotency for cron + manual retriggers)
        }

        let extraction: CallExtractionResult;
        try {
            extraction = await this.extractionPort.extract({
                transcript: record.transcript as unknown as TranscriptTurn[],
                summary: record.summary as Record<string, unknown> | null,
                fileName: record.fileName,
            });
        } catch (error) {
            this.logger.error(`Extraction failed for ${callRecordId}: ${error}`);
            await this.prismaService.call_record.update({
                where: { id: callRecordId },
                data: {
                    processingStatus: "FAILED",
                    failureReason: String(error).slice(0, 1_000),
                },
            });
            return;
        }

        const callerPhone = this.resolveCallerPhone(extraction, record.fileName);
        const matchedClientId = await this.matchClient(record.branchId, callerPhone);
        const proposals = this.sanitizeProposals(extraction.proposals);

        await this.prismaService.call_record.update({
            where: { id: callRecordId },
            data: {
                category: extraction.category,
                callerName: extraction.callerName ?? null,
                callerPhone,
                matchedClientId,
                processingStatus: "EXTRACTED",
                failureReason: null,
            },
        });

        if (extraction.category === "NEW_CONSULTATION" || extraction.category === "CLIENT_SERVICE") {
            await this.prismaService.client_draft.create({
                data: {
                    callRecordId,
                    branchId: record.branchId,
                    type: extraction.category === "NEW_CONSULTATION" ? "NEW_CLIENT" : "CLIENT_UPDATE",
                    clientId: matchedClientId,
                    proposals: proposals as unknown as object[],
                    requestSummary: extraction.requestSummary,
                    extractionMeta: {
                        model: "gemini-2.5-flash",
                        promptVersion: CALL_EXTRACTION_PROMPT_VERSION,
                    },
                },
            });
        }
    }

    /** transcript-spoken numbers win over filename-parsed ones */
    private resolveCallerPhone(extraction: CallExtractionResult, fileName: string): string | null {
        for (const candidate of extraction.callerPhoneCandidates) {
            const normalized = normalizePhone(candidate);
            if (normalized) return normalized;
        }
        return extractPhoneCandidates(fileName)[0] ?? null;
    }

    /** exact normalized-phone match within the branch; ambiguity (0 or 2+) → null */
    private async matchClient(branchId: string, callerPhone: string | null): Promise<number | null> {
        if (!callerPhone) return null;
        const clients = await this.prismaService.client.findMany({
            where: { branchId, phone: { not: null } },
            select: { id: true, phone: true },
        });
        const matches = clients.filter((c) => normalizePhone(c.phone) === callerPhone);
        return matches.length === 1 ? matches[0].id : null;
    }

    /** allowlist fields + coerce Gemini string values to their column types */
    private sanitizeProposals(proposals: ExtractionProposal[]): ExtractionProposal[] {
        const sanitized: ExtractionProposal[] = [];
        for (const proposal of proposals) {
            if (!ALLOWED_FIELDS.has(proposal.field)) continue;
            let value: string | number | boolean | null = proposal.value;
            if (typeof value === "string") {
                if (BOOLEAN_FIELDS.has(proposal.field)) {
                    value = value.trim().toLowerCase() === "true";
                } else if (NUMBER_FIELDS.has(proposal.field)) {
                    const parsed = parseInt(value.replace(/\D/g, ""), 10);
                    if (Number.isNaN(parsed)) continue;
                    value = parsed;
                }
            }
            sanitized.push({ ...proposal, value });
        }
        return sanitized;
    }
}
```

- [ ] **Step 4: Run** → PASS. Re-run Task 5's specs too (constructor changed: ingestion spec instantiates with mocks — unaffected; placeholder had no constructor args, real one does: update `new CallIngestionService(prisma, processingService)` usages — already correct in spec). `npm test -- test/services` → PASS. **Commit** `feat(call-inbox): extraction processing — classify, phone-match, draft creation`.

---

### Task 8: Extraction retry cron

**Tier:** standard · **Sandbox:** local · **Paths:** `backend/application/services/call-extraction-retry-scheduler.service.ts`, `backend/test/services/call-extraction-retry-scheduler.service.spec.ts` · **Depends:** Task 7

- [ ] **Step 1: Failing test** `backend/test/services/call-extraction-retry-scheduler.service.spec.ts`:

```typescript
import { CallExtractionRetrySchedulerService } from "application/services/call-extraction-retry-scheduler.service";

describe("CallExtractionRetrySchedulerService", () => {
    const prisma = { call_record: { findMany: jest.fn(), update: jest.fn() } };
    const processingService = { processCallRecord: jest.fn() };
    let scheduler: CallExtractionRetrySchedulerService;

    beforeEach(() => {
        jest.resetAllMocks();
        prisma.call_record.update.mockResolvedValue({});
        processingService.processCallRecord.mockResolvedValue(undefined);
        scheduler = new CallExtractionRetrySchedulerService(prisma as never, processingService as never);
    });

    it("retries FAILED records under the attempt cap and stuck RECEIVED records", async () => {
        prisma.call_record.findMany.mockResolvedValue([
            { id: "rec-1", extractionRetryCount: 1 },
            { id: "rec-2", extractionRetryCount: 0 },
        ]);

        await scheduler.retryFailedExtractions();

        expect(prisma.call_record.update).toHaveBeenCalledWith({
            where: { id: "rec-1" },
            data: { extractionRetryCount: { increment: 1 }, processingStatus: "RECEIVED" },
        });
        expect(processingService.processCallRecord).toHaveBeenCalledWith("rec-1");
        expect(processingService.processCallRecord).toHaveBeenCalledWith("rec-2");
    });

    it("does nothing when no candidates", async () => {
        prisma.call_record.findMany.mockResolvedValue([]);
        await scheduler.retryFailedExtractions();
        expect(processingService.processCallRecord).not.toHaveBeenCalled();
    });
});
```

- [ ] **Step 2: Run** → FAIL. **Implement** `backend/application/services/call-extraction-retry-scheduler.service.ts` (uses the repo's `SchedulerExecutionGuard` like `alimtalk-retry-scheduler.service.ts`):

```typescript
import { Injectable, Logger } from "@nestjs/common";
import { Cron } from "@nestjs/schedule";
import { PrismaService } from "infrastructure/database/prisma.service";
import { CallProcessingService } from "application/services/call-processing.service";
import { SchedulerExecutionGuard } from "./scheduler-execution.guard";

const MAX_ATTEMPTS = 3;
const STUCK_RECEIVED_MS = 10 * 60 * 1000;
const MAX_RUN_MS = 10 * 60 * 1000;
const DB_COOLDOWN_MS = 5 * 60 * 1000;

@Injectable()
export class CallExtractionRetrySchedulerService {
    private readonly logger = new Logger(CallExtractionRetrySchedulerService.name);
    private readonly executionGuard = new SchedulerExecutionGuard({
        logger: this.logger,
        runningWarning: "[CallRetry] Previous cycle still running; skipping tick",
        staleRunError: "[CallRetry] Previous cycle exceeded max runtime",
        cooldownWarning: "[CallRetry] DB connectivity issue during retry cycle",
        maxRunMs: MAX_RUN_MS,
        cooldownMs: DB_COOLDOWN_MS,
    });

    constructor(
        private readonly prismaService: PrismaService,
        private readonly processingService: CallProcessingService,
    ) {}

    @Cron("*/10 * * * *", { timeZone: "Asia/Seoul" })
    async retryFailedExtractions(): Promise<void> {
        const runToken = this.executionGuard.tryStart();
        if (!runToken) return;

        try {
            const candidates = await this.prismaService.call_record.findMany({
                where: {
                    OR: [
                        { processingStatus: "FAILED", extractionRetryCount: { lt: MAX_ATTEMPTS } },
                        // crash recovery: RECEIVED rows whose fire-and-forget kickoff died
                        {
                            processingStatus: "RECEIVED",
                            createdAt: { lt: new Date(Date.now() - STUCK_RECEIVED_MS) },
                        },
                    ],
                },
                select: { id: true, extractionRetryCount: true },
                take: 20,
            });
            if (candidates.length === 0) return;

            this.logger.log(`[CallRetry] Retrying ${candidates.length} call records`);
            for (const candidate of candidates) {
                await this.prismaService.call_record.update({
                    where: { id: candidate.id },
                    data: { extractionRetryCount: { increment: 1 }, processingStatus: "RECEIVED" },
                });
                await this.processingService.processCallRecord(candidate.id);
            }
        } finally {
            this.executionGuard.finish(runToken);
        }
    }
}
```

(Before finalizing, open `backend/application/services/scheduler-execution.guard.ts` and match its real start/finish API — `alimtalk-retry-scheduler.service.ts` is the reference; if its method names differ from `tryStart/finish`, mirror them in both the implementation and the test.)

- [ ] **Step 3: Run** → PASS. **Commit** `feat(call-inbox): extraction retry cron with stuck-record recovery`.

---

### Task 9: Staff API — call records + drafts (service & controllers)

**Tier:** heavy · **Sandbox:** local · **Paths:** `backend/application/services/call-inbox.service.ts`, `backend/interface/controllers/call-record.controller.ts`, `backend/interface/controllers/client-draft.controller.ts`, `backend/interface/dto/call-inbox.dto.ts`, `backend/test/services/call-inbox.service.spec.ts`, `backend/test/integration/client-draft.controller.integration.spec.ts` · **Depends:** Tasks 1, 7

All endpoints: `@UseGuards(JwtGuard, TenantGuard)` + `@CurrentTenant()` branchId scoping + page/limit pagination `{data,total,page,limit,totalPages}` (exact `client.controller.ts` conventions — check `@CurrentTenant()`'s import path there and reuse).

- [ ] **Step 1: Extend DTOs** — append to `backend/interface/dto/call-inbox.dto.ts`:

```typescript
import { IsBoolean, IsIn, IsInt, IsNumber, Min, ValidateIf } from "class-validator";
import { PROPOSAL_FIELDS } from "application/services/call-extraction.prompt";

export class ProposalDto {
    @IsIn([...PROPOSAL_FIELDS])
    field!: string;

    @ValidateIf((_, value) => value !== null)
    value!: string | number | boolean | null;

    @IsString()
    @MaxLength(2_000)
    evidence!: string;

    @IsIn(["high", "low"])
    confidence!: "high" | "low";
}

export class PatchClientDraftDto {
    @IsOptional()
    @IsArray()
    @ValidateNested({ each: true })
    @Type(() => ProposalDto)
    proposals?: ProposalDto[];

    @IsOptional()
    @ValidateIf((_, value) => value !== null)
    @IsInt()
    clientId?: number | null;
}

export class ConfirmNewClientDraftDto {
    /** staff-final values; same shape as CreateClientDto minus employee fields */
    @IsObject()
    fields!: Record<string, unknown>;

    @IsOptional()
    @IsBoolean()
    suppressGreetingSms?: boolean;
}

export class DiscardClientDraftDto {
    @IsOptional()
    @IsString()
    @MaxLength(1_000)
    reason?: string;
}
```

(`fields` is forwarded to `ClientService.create`, whose own validation — `assertAllowedServiceStatus`, `assertAllowedClientArea` — plus the typed signature is authoritative; the controller builds the typed params object explicitly, see service below.)

- [ ] **Step 2: Failing service tests** `backend/test/services/call-inbox.service.spec.ts` — cover the behaviors that carry risk:

```typescript
import { ConflictException, NotFoundException, NotImplementedException } from "@nestjs/common";
import { CallInboxService } from "application/services/call-inbox.service";

describe("CallInboxService", () => {
    const prisma = {
        call_record: { findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(), update: jest.fn() },
        client_draft: {
            findMany: jest.fn(), count: jest.fn(), findFirst: jest.fn(),
            update: jest.fn(), updateMany: jest.fn(),
        },
        client: { findFirst: jest.fn(), findUnique: jest.fn() },
    };
    const clientService = { create: jest.fn() };
    let service: CallInboxService;

    const pendingDraft = {
        id: "draft-1", branchId: "branch-1", type: "NEW_CLIENT", status: "PENDING",
        clientId: null, callRecordId: "rec-1",
        proposals: [{ field: "name", value: "김서연", evidence: "e", confidence: "high" }],
        requestSummary: "신규 문의",
        callRecord: { id: "rec-1", callerPhone: "01048217763", callerName: "김서연" },
    };

    beforeEach(() => {
        jest.resetAllMocks();
        service = new CallInboxService(prisma as never, clientService as never);
    });

    it("confirmNewClient: creates via ClientService, marks CONFIRMED, links call record", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(pendingDraft);
        prisma.client_draft.updateMany.mockResolvedValue({ count: 1 });
        clientService.create.mockResolvedValue({ id: 77 });

        const result = await service.confirmNewClient("branch-1", "user-1", "draft-1", {
            fields: { name: "김서연", careCenter: false, voucherClient: true, breastPump: false },
            suppressGreetingSms: false,
        });

        expect(result).toEqual({ clientId: 77 });
        expect(clientService.create).toHaveBeenCalledWith("branch-1", expect.objectContaining({
            name: "김서연", careCenter: false, voucherClient: true, breastPump: false,
            suppressGreetingSms: false,
        }));
        expect(prisma.client_draft.update).toHaveBeenCalledWith(expect.objectContaining({
            where: { id: "draft-1" },
            data: expect.objectContaining({ status: "CONFIRMED", clientId: 77, reviewedById: "user-1" }),
        }));
        expect(prisma.call_record.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ matchedClientId: 77 }),
        }));
    });

    it("confirmNewClient: 409 when draft is not PENDING (double confirm race)", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(pendingDraft);
        prisma.client_draft.updateMany.mockResolvedValue({ count: 0 }); // lost the race

        await expect(
            service.confirmNewClient("branch-1", "user-1", "draft-1", { fields: { name: "x", careCenter: false, voucherClient: false, breastPump: false } }),
        ).rejects.toThrow(ConflictException);
        expect(clientService.create).not.toHaveBeenCalled();
    });

    it("confirmNewClient: 404 for a draft in another branch", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(null);
        await expect(
            service.confirmNewClient("branch-2", "user-1", "draft-1", { fields: { name: "x", careCenter: false, voucherClient: false, breastPump: false } }),
        ).rejects.toThrow(NotFoundException);
    });

    it("confirmNewClient: 501 for CLIENT_UPDATE drafts (Phase 2)", async () => {
        prisma.client_draft.findFirst.mockResolvedValue({ ...pendingDraft, type: "CLIENT_UPDATE" });
        await expect(
            service.confirmNewClient("branch-1", "user-1", "draft-1", { fields: { name: "x", careCenter: false, voucherClient: false, breastPump: false } }),
        ).rejects.toThrow(NotImplementedException);
    });

    it("discard: PENDING → DISCARDED with reason; 409 otherwise", async () => {
        prisma.client_draft.findFirst.mockResolvedValue(pendingDraft);
        prisma.client_draft.updateMany.mockResolvedValue({ count: 1 });

        await service.discard("branch-1", "user-1", "draft-1", "오인식");
        expect(prisma.client_draft.update).toHaveBeenCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: "DISCARDED", discardReason: "오인식" }),
        }));

        prisma.client_draft.updateMany.mockResolvedValue({ count: 0 });
        await expect(service.discard("branch-1", "user-1", "draft-1", undefined)).rejects.toThrow(ConflictException);
    });

    it("listDrafts: flags possibleDuplicate and phoneMatchesExistingClient", async () => {
        prisma.client_draft.findMany.mockResolvedValue([
            { ...pendingDraft, callRecord: { ...pendingDraft.callRecord }, client: null },
            {
                ...pendingDraft, id: "draft-2", callRecordId: "rec-2",
                callRecord: { id: "rec-2", callerPhone: "01048217763", callerName: "김서연" }, client: null,
            },
        ]);
        prisma.client_draft.count.mockResolvedValue(2);
        prisma.client.findMany = jest.fn().mockResolvedValue([{ id: 9, phone: "010-4821-7763" }]);

        const result = await service.listDrafts("branch-1", "PENDING", 1, 20);

        expect(result.data[0].possibleDuplicate).toBe(true);  // two PENDING drafts share the phone
        expect(result.data[0].phoneMatchesExistingClient).toBe(true);
        expect(result.total).toBe(2);
    });
});
```

- [ ] **Step 3: Run** → FAIL. **Implement** `backend/application/services/call-inbox.service.ts`:

```typescript
import {
    ConflictException,
    Injectable,
    Logger,
    NotFoundException,
    NotImplementedException,
} from "@nestjs/common";
import { PrismaService } from "infrastructure/database/prisma.service";
import { ClientService } from "application/services/client.service";
import { normalizePhone } from "application/utils/normalize-phone";
import {
    ConfirmNewClientDraftDto,
    PatchClientDraftDto,
} from "interface/dto/call-inbox.dto";

const DRAFT_STATUSES = ["PENDING", "CONFIRMED", "DISCARDED"] as const;

@Injectable()
export class CallInboxService {
    private readonly logger = new Logger(CallInboxService.name);

    constructor(
        private readonly prismaService: PrismaService,
        private readonly clientService: ClientService,
    ) {}

    // ── call records ──────────────────────────────────────────────

    async listCallRecords(branchId: string, page: number, limit: number, category?: string, search?: string) {
        const where = {
            branchId,
            ...(category ? { category } : {}),
            ...(search
                ? {
                    OR: [
                        { callerName: { contains: search } },
                        { callerPhone: { contains: search.replace(/\D/g, "") || search } },
                        { fileName: { contains: search } },
                        { draft: { requestSummary: { contains: search } } },
                    ],
                }
                : {}),
        };
        const [rows, total] = await Promise.all([
            this.prismaService.call_record.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    matchedClient: { select: { id: true, name: true, phone: true } },
                    draft: { select: { id: true, type: true, status: true, requestSummary: true } },
                },
            }),
            this.prismaService.call_record.count({ where }),
        ]);
        return {
            data: rows.map((row) => this.toCallRecordListItem(row)),
            total, page, limit, totalPages: Math.ceil(total / limit),
        };
    }

    async getCallRecord(branchId: string, id: string) {
        const record = await this.prismaService.call_record.findFirst({
            where: { id, branchId },
            include: {
                matchedClient: { select: { id: true, name: true, phone: true } },
                draft: true,
            },
        });
        if (!record) throw new NotFoundException("Call record not found");
        return {
            ...this.toCallRecordListItem(record),
            transcript: record.transcript,
            summary: record.summary,
            driveFileId: record.driveFileId,
            driveUrl: `https://drive.google.com/file/d/${record.driveFileId}/view`,
            failureReason: record.failureReason,
            draft: record.draft,
        };
    }

    private toCallRecordListItem(row: {
        id: string; category: string | null; processingStatus: string;
        callerName: string | null; callerPhone: string | null; fileName: string;
        recordedAt: Date | null; createdAt: Date;
        matchedClient: { id: number; name: string; phone: string | null } | null;
        draft: { id: string; type: string; status: string; requestSummary: string } | null;
        summary?: unknown;
    }) {
        const summaryLine =
            row.draft?.requestSummary ??
            ((row.summary as { key_content?: string } | null)?.key_content ?? null);
        return {
            id: row.id,
            category: row.category,
            processingStatus: row.processingStatus,
            callerName: row.callerName,
            callerPhone: row.callerPhone,
            fileName: row.fileName,
            recordedAt: row.recordedAt,
            createdAt: row.createdAt,
            matchedClient: row.matchedClient,
            draft: row.draft
                ? { id: row.draft.id, type: row.draft.type, status: row.draft.status, requestSummary: row.draft.requestSummary }
                : null,
            summaryLine,
        };
    }

    // ── drafts ────────────────────────────────────────────────────

    async listDrafts(branchId: string, status: string, page: number, limit: number) {
        if (!DRAFT_STATUSES.includes(status as never)) {
            status = "PENDING";
        }
        const where = { branchId, status };
        const [rows, total] = await Promise.all([
            this.prismaService.client_draft.findMany({
                where,
                orderBy: { createdAt: "desc" },
                skip: (page - 1) * limit,
                take: limit,
                include: {
                    callRecord: { select: { id: true, callerPhone: true, callerName: true, recordedAt: true } },
                    client: { select: { id: true, name: true, phone: true } },
                },
            }),
            this.prismaService.client_draft.count({ where }),
        ]);

        // duplicate/existing-phone flags (spec §10) — one query each, computed in memory
        const phones = rows.map((r) => r.callRecord.callerPhone).filter(Boolean) as string[];
        const branchClients = phones.length
            ? await this.prismaService.client.findMany({
                where: { branchId, phone: { not: null } },
                select: { id: true, phone: true },
            })
            : [];
        const clientPhoneSet = new Set(branchClients.map((c) => normalizePhone(c.phone)).filter(Boolean));
        const phoneCounts = new Map<string, number>();
        for (const phone of phones) phoneCounts.set(phone, (phoneCounts.get(phone) ?? 0) + 1);

        return {
            data: rows.map((row) => ({
                id: row.id,
                type: row.type,
                status: row.status,
                requestSummary: row.requestSummary,
                callerName: row.callRecord.callerName,
                callerPhone: row.callRecord.callerPhone,
                recordedAt: row.callRecord.recordedAt,
                createdAt: row.createdAt,
                callRecordId: row.callRecordId,
                client: row.client,
                hasLowConfidence: (row.proposals as { confidence?: string }[]).some((p) => p.confidence === "low"),
                possibleDuplicate: row.callRecord.callerPhone
                    ? (phoneCounts.get(row.callRecord.callerPhone) ?? 0) > 1
                    : false,
                phoneMatchesExistingClient:
                    row.type === "NEW_CLIENT" && row.callRecord.callerPhone
                        ? clientPhoneSet.has(row.callRecord.callerPhone)
                        : false,
            })),
            total, page, limit, totalPages: Math.ceil(total / limit),
        };
    }

    async countDrafts(branchId: string, status: string): Promise<{ count: number }> {
        const count = await this.prismaService.client_draft.count({
            where: { branchId, status: DRAFT_STATUSES.includes(status as never) ? status : "PENDING" },
        });
        return { count };
    }

    async getDraft(branchId: string, id: string) {
        const draft = await this.prismaService.client_draft.findFirst({
            where: { id, branchId },
            include: {
                callRecord: { include: { matchedClient: { select: { id: true, name: true, phone: true } } } },
                client: true,
                reviewedBy: { select: { id: true, name: true } },
            },
        });
        if (!draft) throw new NotFoundException("Draft not found");
        return draft;
    }

    async patchDraft(branchId: string, id: string, dto: PatchClientDraftDto) {
        await this.requirePendingDraft(branchId, id);
        if (dto.clientId != null) {
            const client = await this.prismaService.client.findFirst({
                where: { id: dto.clientId, branchId },
                select: { id: true },
            });
            if (!client) throw new NotFoundException("Client not found in this branch");
        }
        await this.prismaService.client_draft.update({
            where: { id },
            data: {
                ...(dto.proposals !== undefined ? { proposals: dto.proposals as unknown as object[] } : {}),
                ...(dto.clientId !== undefined ? { clientId: dto.clientId } : {}),
            },
        });
        return this.getDraft(branchId, id);
    }

    async confirmNewClient(branchId: string, userId: string, id: string, dto: ConfirmNewClientDraftDto) {
        const draft = await this.requirePendingDraft(branchId, id);
        if (draft.type !== "NEW_CLIENT") {
            throw new NotImplementedException("CLIENT_UPDATE confirm ships in Phase 2");
        }

        // optimistic lock BEFORE side effects: only one caller flips PENDING→CONFIRMING
        const locked = await this.prismaService.client_draft.updateMany({
            where: { id, status: "PENDING" },
            data: { status: "CONFIRMING" },
        });
        if (locked.count === 0) {
            throw new ConflictException("Draft already reviewed");
        }

        try {
            const fields = dto.fields as Record<string, never>;
            const client = await this.clientService.create(branchId, {
                name: String(fields.name ?? ""),
                address: fields.address ?? null,
                phone: fields.phone ?? null,
                type: fields.type ?? null,
                duration: fields.duration ?? null,
                fullPrice: fields.fullPrice ?? null,
                grant: fields.grant ?? null,
                actualPrice: fields.actualPrice ?? null,
                startDate: fields.startDate ?? null,
                endDate: fields.endDate ?? null,
                careCenter: Boolean(fields.careCenter),
                voucherClient: Boolean(fields.voucherClient),
                birthday: fields.birthday ?? null,
                dueDate: fields.dueDate ?? null,
                serviceStatus: fields.serviceStatus ?? null,
                breastPump: Boolean(fields.breastPump),
                areaId: fields.areaId ?? null,
                primaryEmployeeId: fields.primaryEmployeeId ?? null,
                secondaryEmployeeId: fields.secondaryEmployeeId ?? null,
                suppressGreetingSms: dto.suppressGreetingSms ?? false,
            });

            await this.prismaService.client_draft.update({
                where: { id },
                data: { status: "CONFIRMED", clientId: client.id, reviewedById: userId, reviewedAt: new Date() },
            });
            await this.prismaService.call_record.update({
                where: { id: draft.callRecordId },
                data: { matchedClientId: client.id },
            });
            return { clientId: client.id };
        } catch (error) {
            // roll the lock back so staff can retry after fixing input
            await this.prismaService.client_draft.update({
                where: { id },
                data: { status: "PENDING" },
            }).catch(() => undefined);
            throw error;
        }
    }

    async discard(branchId: string, userId: string, id: string, reason?: string) {
        await this.requirePendingDraft(branchId, id);
        const locked = await this.prismaService.client_draft.updateMany({
            where: { id, status: "PENDING" },
            data: { status: "DISCARDED" },
        });
        if (locked.count === 0) throw new ConflictException("Draft already reviewed");
        await this.prismaService.client_draft.update({
            where: { id },
            data: { discardReason: reason ?? null, reviewedById: userId, reviewedAt: new Date() },
        });
        return { id, status: "DISCARDED" };
    }

    private async requirePendingDraft(branchId: string, id: string) {
        const draft = await this.prismaService.client_draft.findFirst({
            where: { id, branchId },
            include: { callRecord: { select: { id: true, callerPhone: true, callerName: true } } },
        });
        if (!draft) throw new NotFoundException("Draft not found");
        if (draft.status !== "PENDING") throw new ConflictException("Draft already reviewed");
        return draft;
    }
}
```

Note the transient `CONFIRMING` status used as the optimistic lock during client creation — it's internal (rolled back to PENDING on failure, CONFIRMED on success). Add it to the spec's status list during Task 18 doc sync.

- [ ] **Step 4: Run service tests** → PASS.

- [ ] **Step 5: Controllers.** `backend/interface/controllers/call-record.controller.ts`:

```typescript
import { Controller, Get, Param, Query, UseGuards } from "@nestjs/common";
import { CallInboxService } from "application/services/call-inbox.service";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";
import { CurrentTenant } from "infrastructure/tenant/current-tenant.decorator"; // ← verify path against client.controller.ts imports
import { parseInteger } from "interface/utils/parse-integer"; // ← verify path against client.controller.ts imports

@Controller("call-records")
@UseGuards(JwtGuard, TenantGuard)
export class CallRecordController {
    constructor(private readonly callInboxService: CallInboxService) {}

    @Get()
    list(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("page") page?: string,
        @Query("limit") limit?: string,
        @Query("category") category?: string,
        @Query("search") search?: string,
    ) {
        return this.callInboxService.listCallRecords(
            tenant.branchId ?? "",
            parseInteger(page, "page", { defaultValue: 1, min: 1 }),
            parseInteger(limit, "limit", { defaultValue: 20, min: 1, max: 100 }),
            category,
            search,
        );
    }

    @Get(":id")
    detail(@CurrentTenant() tenant: { branchId?: string }, @Param("id") id: string) {
        return this.callInboxService.getCallRecord(tenant.branchId ?? "", id);
    }
}
```

`backend/interface/controllers/client-draft.controller.ts`:

```typescript
import { Body, Controller, Get, Param, Patch, Post, Query, Req, UseGuards } from "@nestjs/common";
import { Request } from "express";
import { CallInboxService } from "application/services/call-inbox.service";
import {
    ConfirmNewClientDraftDto,
    DiscardClientDraftDto,
    PatchClientDraftDto,
} from "interface/dto/call-inbox.dto";
import { JwtGuard } from "infrastructure/auth/jwt.guard";
import { TenantGuard } from "infrastructure/tenant/tenant.guard";
import { CurrentTenant } from "infrastructure/tenant/current-tenant.decorator"; // ← same import-path verification
import { parseInteger } from "interface/utils/parse-integer";

@Controller("client-drafts")
@UseGuards(JwtGuard, TenantGuard)
export class ClientDraftController {
    constructor(private readonly callInboxService: CallInboxService) {}

    @Get()
    list(
        @CurrentTenant() tenant: { branchId?: string },
        @Query("status") status?: string,
        @Query("page") page?: string,
        @Query("limit") limit?: string,
    ) {
        return this.callInboxService.listDrafts(
            tenant.branchId ?? "",
            status ?? "PENDING",
            parseInteger(page, "page", { defaultValue: 1, min: 1 }),
            parseInteger(limit, "limit", { defaultValue: 20, min: 1, max: 100 }),
        );
    }

    @Get("count")
    count(@CurrentTenant() tenant: { branchId?: string }, @Query("status") status?: string) {
        return this.callInboxService.countDrafts(tenant.branchId ?? "", status ?? "PENDING");
    }

    @Get(":id")
    detail(@CurrentTenant() tenant: { branchId?: string }, @Param("id") id: string) {
        return this.callInboxService.getDraft(tenant.branchId ?? "", id);
    }

    @Patch(":id")
    patch(
        @CurrentTenant() tenant: { branchId?: string },
        @Param("id") id: string,
        @Body() dto: PatchClientDraftDto,
    ) {
        return this.callInboxService.patchDraft(tenant.branchId ?? "", id, dto);
    }

    @Post(":id/confirm")
    confirm(
        @CurrentTenant() tenant: { branchId?: string },
        @Req() request: Request & { user?: { userId?: string } },
        @Param("id") id: string,
        @Body() dto: ConfirmNewClientDraftDto,
    ) {
        return this.callInboxService.confirmNewClient(
            tenant.branchId ?? "",
            request.user?.userId ?? "",
            id,
            dto,
        );
    }

    @Post(":id/discard")
    discard(
        @CurrentTenant() tenant: { branchId?: string },
        @Req() request: Request & { user?: { userId?: string } },
        @Param("id") id: string,
        @Body() dto: DiscardClientDraftDto,
    ) {
        return this.callInboxService.discard(tenant.branchId ?? "", request.user?.userId ?? "", id, dto.reason);
    }
}
```

(`@Get("count")` MUST be declared before `@Get(":id")` — Nest route order. The two `// ← verify` imports: open `client.controller.ts`, copy its exact `CurrentTenant`/`parseInteger` import paths.)

- [ ] **Step 6: Integration test** `backend/test/integration/client-draft.controller.integration.spec.ts` — mirror the Task 4 bootstrap (override `JwtGuard`/`TenantGuard`, mock `CallInboxService`); assert: list passes branch + parsed paging; `GET /client-drafts/count` hits `countDrafts` (not `getDraft("count")`); confirm passes `userId` from `request.user`; discard forwards reason. Run → PASS.

- [ ] **Step 7:** `npm run type-check && npm test -- test/services/call-inbox test/integration/client-draft` → green. **Commit** `feat(call-inbox): staff call-record + client-draft APIs with confirm/discard`.

---

### Task 10: Module wiring

**Tier:** trivial · **Sandbox:** local · **Paths:** `backend/module/call-inbox.module.ts`, `backend/app.module.ts` · **Depends:** Tasks 3-9

- [ ] **Step 1: Create** `backend/module/call-inbox.module.ts`:

```typescript
import { Module } from "@nestjs/common";
import { ConfigModule, ConfigService } from "@nestjs/config";
import { DatabaseModule } from "infrastructure/database/database.module";
import { CALL_EXTRACTION_PORT } from "domain/ports/call-extraction.port";
import { createCallExtractionAdapter } from "infrastructure/vendor-stubs/e2e-vendor-stubs";
import { CallIngestGuard } from "infrastructure/auth/call-ingest.guard";
import { CallIngestTokenService } from "application/services/call-ingest-token.service";
import { CallIngestionService } from "application/services/call-ingestion.service";
import { CallProcessingService } from "application/services/call-processing.service";
import { CallExtractionRetrySchedulerService } from "application/services/call-extraction-retry-scheduler.service";
import { CallInboxService } from "application/services/call-inbox.service";
import { CallTranscriptWebhookController } from "interface/controllers/call-transcript-webhook.controller";
import { CallIngestTokenController } from "interface/controllers/call-ingest-token.controller";
import { CallRecordController } from "interface/controllers/call-record.controller";
import { ClientDraftController } from "interface/controllers/client-draft.controller";
import { ClientModule } from "./client.module"; // ← verify actual module name/file exporting ClientService

@Module({
    imports: [DatabaseModule, ConfigModule, ClientModule],
    controllers: [
        CallTranscriptWebhookController,
        CallIngestTokenController,
        CallRecordController,
        ClientDraftController,
    ],
    providers: [
        CallIngestGuard,
        CallIngestTokenService,
        CallIngestionService,
        CallProcessingService,
        CallExtractionRetrySchedulerService,
        CallInboxService,
        {
            provide: CALL_EXTRACTION_PORT,
            inject: [ConfigService],
            useFactory: createCallExtractionAdapter,
        },
    ],
})
export class CallInboxModule {}
```

Verify two things against the real tree before committing: (a) which module exports `ClientService` (open `module/client.module.ts` — if `ClientService` isn't exported, add it to that module's `exports` array); (b) whether `TenantContext` needs providing here or comes from a shared tenant module (copy whatever `client.controller`'s module does).

- [ ] **Step 2: Register** in `backend/app.module.ts` imports array: `CallInboxModule` (one line, alphabetical-ish placement matching neighbors).

- [ ] **Step 3:** `npm run type-check && npm test` (full suite) → green; `npm run start:dev` boots without DI errors (Ctrl-C after "Nest application successfully started"). **Commit** `feat(call-inbox): module wiring`.

---

### Task 11: Backend e2e spec

**Tier:** standard · **Sandbox:** local · **Paths:** `backend/test/e2e/call-inbox.e2e.spec.ts` · **Depends:** Task 10

- [ ] **Step 1:** Read one existing spec in `backend/test/e2e/` end-to-end (app bootstrap, seeding helpers, auth helper for staff JWT, how the gated runner is invoked in CI) and `test/e2e-env/seed-e2e.ts`.

- [ ] **Step 2:** Write `backend/test/e2e/call-inbox.e2e.spec.ts` following that bootstrap exactly. Flow (vendor stub active per e2e env, so extraction returns the Task 6 stub):

```typescript
// Outline — bootstrap/auth helpers copied from the neighboring e2e spec:
// 1. POST /branches/:branchId/call-ingest-tokens as owner → capture plaintext token (201).
// 2. POST /webhooks/call-transcripts with that token + sample payload
//    { fileId: `e2e-${Date.now()}`, fileName: "통화 녹음 김서연_010-4821-7763.m4a",
//      transcript: [{speaker:"고객", text:"산후도우미 문의요"}] }
//    → 202 { accepted: true, duplicate: false, callRecordId }.
// 3. Re-POST same payload → 200 { duplicate: true }.
// 4. Poll GET /client-drafts?status=PENDING (staff JWT) until the draft appears (≤10s)
//    → item has type NEW_CLIENT, requestSummary from stub, hasLowConfidence false.
// 5. POST /client-drafts/:id/confirm { fields: { name:"김서연", careCenter:false,
//    voucherClient:false, breastPump:false, dueDate:"2026-07-15" }, suppressGreetingSms: true }
//    → 200 { clientId }.
// 6. GET /clients/:clientId → name 김서연. Draft re-fetch → status CONFIRMED.
// 7. Second confirm attempt → 409.
```

Write it as real code against the discovered helpers — every assertion above is required. `suppressGreetingSms: true` keeps e2e from sending SMS (aligo is vendor-stubbed anyway per CI policy, but be explicit).

- [ ] **Step 3:** Run via the repo's gated e2e runner (same command CI uses — find it in `.github/workflows/` or `package.json`; do NOT add a new runner). → PASS. **Commit** `test(call-inbox): e2e webhook→draft→confirm flow`.

---

### Task 12: Mobile BFF proxy routes

**Tier:** standard · **Sandbox:** local · **Paths:** `mobile/src/app/api/call-records/route.ts`, `mobile/src/app/api/call-records/[id]/route.ts`, `mobile/src/app/api/client-drafts/route.ts`, `mobile/src/app/api/client-drafts/count/route.ts`, `mobile/src/app/api/client-drafts/[id]/route.ts`, `mobile/src/app/api/client-drafts/[id]/confirm/route.ts`, `mobile/src/app/api/client-drafts/[id]/discard/route.ts` · **Depends:** none (contract known)

All seven files follow `mobile/src/app/api/clients/route.ts` verbatim conventions (`getAuthToken` → 401, `serverAPIClient` with `getAuthHeaders`, `withNoStore(backendJsonResponse(...))` for GETs, `errorResponse(error, "<verb> <noun>")`). Representative implementations — the rest are mechanical clones:

- [ ] **Step 1:** `mobile/src/app/api/call-records/route.ts`:

```typescript
import { NextRequest } from "next/server";
import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    unauthorizedResponse,
    withNoStore,
} from "@/lib/api/route-utils";

// GET /api/call-records — call log (page/limit/category/search)
export async function GET(request: NextRequest) {
    try {
        const token = getAuthToken(request);
        if (!token) return unauthorizedResponse("Unauthorized");

        const searchParams = request.nextUrl.searchParams;
        const params: Record<string, string> = {};
        for (const key of ["page", "limit", "category", "search"]) {
            const value = searchParams.get(key);
            if (value) params[key] = value;
        }

        const response = await serverAPIClient.get("/call-records", {
            params,
            headers: getAuthHeaders(token),
        });
        return withNoStore(backendJsonResponse(response));
    } catch (error) {
        return errorResponse(error, "fetch call records");
    }
}
```

- [ ] **Step 2:** `mobile/src/app/api/client-drafts/[id]/confirm/route.ts` (the only one with a body schema):

```typescript
import { NextRequest } from "next/server";
import { z } from "zod";
import { serverAPIClient } from "@/lib/api/server";
import {
    backendJsonResponse,
    errorResponse,
    getAuthHeaders,
    getAuthToken,
    parseBody,
    unauthorizedResponse,
} from "@/lib/api/route-utils";

// Mirrors backend ConfirmNewClientDraftDto: fields object validated authoritatively
// by the backend's ValidationPipe + ClientService; BFF checks shape only.
const confirmDraftSchema = z
    .object({
        fields: z.object({
            name: z.string().min(1).max(10_000),
            careCenter: z.boolean(),
            voucherClient: z.boolean(),
            breastPump: z.boolean(),
        }).passthrough(),
        suppressGreetingSms: z.boolean().optional(),
    });

export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
    const token = getAuthToken(request);
    if (!token) return unauthorizedResponse("Unauthorized");

    const { data, response } = await parseBody(confirmDraftSchema, request);
    if (response) return response;

    const { id } = await params;
    try {
        const backendResponse = await serverAPIClient.post(
            `/client-drafts/${encodeURIComponent(id)}/confirm`,
            data,
            { headers: getAuthHeaders(token) },
        );
        return backendJsonResponse(backendResponse);
    } catch (error) {
        return errorResponse(error, "confirm client draft");
    }
}
```

(Check a neighboring dynamic BFF route, e.g. an existing `[id]/route.ts` under `src/app/api/`, for whether this Next version types `params` as a Promise or plain object — copy that signature.)

- [ ] **Step 3:** Remaining five files, mechanical: `call-records/[id]` GET → `/call-records/:id`; `client-drafts` GET (params: status/page/limit) → `/client-drafts`; `client-drafts/count` GET (params: status) → `/client-drafts/count`; `client-drafts/[id]` GET + PATCH (PATCH body schema: `z.object({ proposals: z.array(z.object({ field: z.string(), value: z.union([z.string(), z.number(), z.boolean(), z.null()]), evidence: z.string(), confidence: z.enum(["high","low"]) })).optional(), clientId: z.number().int().nullable().optional() })`) → `/client-drafts/:id`; `client-drafts/[id]/discard` POST (body `z.object({ reason: z.string().max(1000).optional() })`) → `/client-drafts/:id/discard`.

- [ ] **Step 4:** `npm run type-check` in `mobile/` → clean. **Commit** `feat(call-inbox): mobile BFF proxy routes`.

---

### Task 13: Mobile types + React Query hooks

**Tier:** standard · **Sandbox:** local · **Paths:** `mobile/src/lib/call-inbox/types.ts`, `mobile/src/lib/call-inbox/format.ts`, `mobile/src/hooks/useCallInbox.ts` · **Depends:** Task 12 (contract only — parallel-safe)

- [ ] **Step 1:** `mobile/src/lib/call-inbox/types.ts`:

```typescript
export type CallCategory = "NEW_CONSULTATION" | "CLIENT_SERVICE" | "OTHER";
export type ProcessingStatus = "RECEIVED" | "EXTRACTED" | "FAILED";
export type DraftType = "NEW_CLIENT" | "CLIENT_UPDATE";
export type DraftStatus = "PENDING" | "CONFIRMED" | "DISCARDED";
export type Confidence = "high" | "low";

export interface TranscriptTurn {
    speaker: string;
    text: string;
}

export interface Proposal {
    field: string;
    value: string | number | boolean | null;
    evidence: string;
    confidence: Confidence;
}

export interface ClientRef {
    id: number;
    name: string;
    phone: string | null;
}

export interface Paginated<T> {
    data: T[];
    total: number;
    page: number;
    limit: number;
    totalPages: number;
}

export interface CallRecordListItem {
    id: string;
    category: CallCategory | null;
    processingStatus: ProcessingStatus;
    callerName: string | null;
    callerPhone: string | null;
    fileName: string;
    recordedAt: string | null;
    createdAt: string;
    matchedClient: ClientRef | null;
    draft: { id: string; type: DraftType; status: DraftStatus; requestSummary: string } | null;
    summaryLine: string | null;
}

export interface CallRecordDetail extends CallRecordListItem {
    transcript: TranscriptTurn[];
    summary: Record<string, string> | null;
    driveFileId: string;
    driveUrl: string;
    failureReason: string | null;
}

export interface ClientDraftListItem {
    id: string;
    type: DraftType;
    status: DraftStatus;
    requestSummary: string;
    callerName: string | null;
    callerPhone: string | null;
    recordedAt: string | null;
    createdAt: string;
    callRecordId: string;
    client: ClientRef | null;
    hasLowConfidence: boolean;
    possibleDuplicate: boolean;
    phoneMatchesExistingClient: boolean;
}

export interface ClientDraftDetail {
    id: string;
    type: DraftType;
    status: DraftStatus;
    clientId: number | null;
    proposals: Proposal[];
    requestSummary: string;
    callRecord: CallRecordDetail;
    client: (ClientRef & Record<string, unknown>) | null;
    reviewedBy: { id: string; name: string } | null;
    reviewedAt: string | null;
    discardReason: string | null;
}

export interface ConfirmDraftBody {
    fields: {
        name: string;
        careCenter: boolean;
        voucherClient: boolean;
        breastPump: boolean;
        [key: string]: unknown;
    };
    suppressGreetingSms?: boolean;
}
```

- [ ] **Step 2:** `mobile/src/lib/call-inbox/format.ts` (same logic as ClientFormDialog's local helpers — they aren't exported; keep these three tiny copies here rather than refactoring user WIP):

```typescript
export const formatPhoneNumber = (value: string): string => {
    const digits = value.replace(/\D/g, "");
    if (digits.length <= 3) return digits;
    if (digits.length <= 7) return `${digits.slice(0, 3)}-${digits.slice(3)}`;
    return `${digits.slice(0, 3)}-${digits.slice(3, 7)}-${digits.slice(7, 11)}`;
};

export const formatDateForInput = (dateString: string | null | undefined): string => {
    if (!dateString) return "";
    const date = new Date(dateString);
    if (isNaN(date.getTime())) return "";
    return date.toISOString().split("T")[0];
};

export const formatCallTime = (iso: string | null): string => {
    if (!iso) return "";
    const date = new Date(iso);
    if (isNaN(date.getTime())) return "";
    return date.toLocaleString("ko-KR", {
        month: "numeric", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false,
        timeZone: "Asia/Seoul",
    });
};
```

- [ ] **Step 3:** `mobile/src/hooks/useCallInbox.ts` (conventions from `useClients.ts`: `api` client, query-key factory, invalidation on mutation):

```typescript
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { api } from "@/lib/api/client";
import type {
    CallCategory,
    CallRecordDetail,
    CallRecordListItem,
    ClientDraftDetail,
    ClientDraftListItem,
    ConfirmDraftBody,
    Paginated,
    Proposal,
} from "@/lib/call-inbox/types";

export const callInboxKeys = {
    all: ["call-inbox"] as const,
    records: (page: number, category?: string, search?: string) =>
        [...callInboxKeys.all, "records", page, category ?? "", search ?? ""] as const,
    record: (id: string) => [...callInboxKeys.all, "record", id] as const,
    drafts: (status: string, page: number) => [...callInboxKeys.all, "drafts", status, page] as const,
    draft: (id: string) => [...callInboxKeys.all, "draft", id] as const,
    count: () => [...callInboxKeys.all, "count"] as const,
};

export function useCallRecords(page: number, category?: CallCategory, search?: string) {
    return useQuery<Paginated<CallRecordListItem>>({
        queryKey: callInboxKeys.records(page, category, search),
        queryFn: async () => {
            const params = new URLSearchParams({ page: String(page), limit: "20" });
            if (category) params.set("category", category);
            if (search) params.set("search", search);
            const { data } = await api.get(`/call-records?${params.toString()}`);
            return data;
        },
        staleTime: 1000 * 30,
    });
}

export function useCallRecord(id: string | null) {
    return useQuery<CallRecordDetail>({
        queryKey: callInboxKeys.record(id ?? ""),
        queryFn: async () => {
            const { data } = await api.get(`/call-records/${id}`);
            return data;
        },
        enabled: id !== null,
    });
}

export function useClientDrafts(status: string = "PENDING", page: number = 1) {
    return useQuery<Paginated<ClientDraftListItem>>({
        queryKey: callInboxKeys.drafts(status, page),
        queryFn: async () => {
            const { data } = await api.get(`/client-drafts?status=${status}&page=${page}&limit=20`);
            return data;
        },
        staleTime: 1000 * 30,
    });
}

export function usePendingDraftCount() {
    return useQuery<{ count: number }>({
        queryKey: callInboxKeys.count(),
        queryFn: async () => {
            const { data } = await api.get("/client-drafts/count?status=PENDING");
            return data;
        },
        staleTime: 1000 * 60,
        refetchInterval: 1000 * 60,
    });
}

export function useClientDraft(id: string | null) {
    return useQuery<ClientDraftDetail>({
        queryKey: callInboxKeys.draft(id ?? ""),
        queryFn: async () => {
            const { data } = await api.get(`/client-drafts/${id}`);
            return data;
        },
        enabled: id !== null,
    });
}

export function usePatchDraft(id: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (body: { proposals?: Proposal[]; clientId?: number | null }) => {
            const { data } = await api.patch(`/client-drafts/${id}`, body);
            return data as ClientDraftDetail;
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: callInboxKeys.all }),
    });
}

export function useConfirmDraft(id: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (body: ConfirmDraftBody) => {
            const { data } = await api.post(`/client-drafts/${id}/confirm`, body);
            return data as { clientId: number };
        },
        onSuccess: () => {
            queryClient.invalidateQueries({ queryKey: callInboxKeys.all });
            queryClient.invalidateQueries({ queryKey: ["clients"] });
        },
    });
}

export function useDiscardDraft(id: string) {
    const queryClient = useQueryClient();
    return useMutation({
        mutationFn: async (body: { reason?: string }) => {
            const { data } = await api.post(`/client-drafts/${id}/discard`, body);
            return data as { id: string; status: "DISCARDED" };
        },
        onSuccess: () => queryClient.invalidateQueries({ queryKey: callInboxKeys.all }),
    });
}
```

(Before committing, open `useClients.ts` and copy its exact `clientQueryKeys.all` value into the confirm hook's second invalidation instead of the literal `["clients"]` if it differs.)

- [ ] **Step 4:** `npm run type-check` → clean. **Commit** `feat(call-inbox): mobile types + react-query hooks`.

---

### Task 14: Bottom-nav swap — 어시스턴트 → 통화요약

**Tier:** standard · **Sandbox:** local · **Paths:** `mobile/src/components/app/root/mobile-bottom-nav.tsx`, `mobile/src/components/app/root/__tests__/mobile-bottom-nav.test.tsx` · **Depends:** none

⚠ Both files carry uncommitted user WIP. `git diff` them first; edit on top of current state; touch only the lines below.

- [ ] **Step 1: Update test first.** In `__tests__/mobile-bottom-nav.test.tsx`: anywhere the suite references the `/chat`/어시스턴트 item, update to `/calls`/통화요약, and add:

```typescript
it("marks 통화요약 active on /calls and not elsewhere", () => {
    mockUsePathname.mockReturnValue("/calls");
    render(<MobileBottomNav />);
    expect(screen.getByRole("link", { name: /통화요약/ })).toHaveAttribute("aria-current", "page");
});

it("renders the pending badge when the count endpoint returns > 0", async () => {
    (global.fetch as jest.Mock).mockResolvedValue({
        ok: true,
        json: async () => ({ count: 3 }),
    });
    mockUsePathname.mockReturnValue("/dashboard");
    render(<MobileBottomNav />);
    expect(await screen.findByText("3")).toBeInTheDocument();
});
```

and in the suite's `beforeEach`, stub fetch so existing tests stay green:

```typescript
global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({ count: 0 }) }) as unknown as typeof fetch;
```

- [ ] **Step 2: Run** `npm test -- mobile-bottom-nav` → FAIL (new assertions).

- [ ] **Step 3: Edit `mobile-bottom-nav.tsx`** — three surgical changes:

(a) imports: replace `Sparkles` with `Phone` in the lucide import; add `useEffect` to the react import.

(b) NAV_ITEMS line 19 and the active-route special case:

```typescript
  { href: "/calls", label: "통화요약", icon: Phone, kind: "chat" },
```
```typescript
  if (href === "/calls") return pathname.startsWith("/calls");
```
(replacing the `{ href: "/chat", ... }` item and the `if (href === "/chat") return pathname === "/chat";` line; `kind: "chat"` is kept so the center-slot styling/indicator logic is untouched — restyling is a fine-tuning decision per spec.)

(c) pending badge — inside the component add a self-contained count (plain fetch; no react-query provider dependency in this global component):

```typescript
  const [pendingCount, setPendingCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      try {
        const response = await fetch("/api/client-drafts/count?status=PENDING");
        if (!response.ok) return;
        const data = (await response.json()) as { count?: number };
        if (!cancelled) setPendingCount(data.count ?? 0);
      } catch {
        /* nav badge is best-effort */
      }
    };
    void load();
    const timer = setInterval(load, 60_000);
    return () => { cancelled = true; clearInterval(timer); };
  }, []);
```

and in the JSX where the `/calls` item's icon renders (locate the per-item render; add inside its icon wrapper, matching existing class idiom):

```tsx
  {item.href === "/calls" && pendingCount > 0 && (
    <span
      data-component="mobile-bottom-nav-calls-badge"
      className="absolute -top-1 -right-2 min-w-[16px] rounded-full bg-red-500 px-1 text-center text-[10px] font-bold leading-4 text-white"
    >
      {pendingCount > 9 ? "9+" : pendingCount}
    </span>
  )}
```

(The icon wrapper may need `relative` added to its className — check the existing markup.)

- [ ] **Step 4: Run** `npm test -- mobile-bottom-nav` → PASS. **Commit** `feat(call-inbox): nav — 통화요약 replaces 어시스턴트 with pending badge`.

---

### Task 15: 통화요약 page — queue, log, review sheets

**Tier:** heavy · **Sandbox:** local · **Paths:** `mobile/src/app/calls/layout.tsx`, `mobile/src/app/calls/page.tsx`, `mobile/src/components/app/call-inbox/CallInboxPage.tsx`, `mobile/src/components/app/call-inbox/CallReviewSheet.tsx`, `mobile/src/components/app/call-inbox/CallLogSheet.tsx`, `mobile/src/components/app/call-inbox/TranscriptView.tsx` · **Depends:** Tasks 13, 14

Wireframe: `docs/mockups/call-inbox-wireframe.html`. Reuse mobile-redesign primitives (`ListCard`, `ListItemRow`, `Badge`, `ListRowsSkeleton`, `MobileDetailSheet`, `MobileSearchBar`, `DetailTabPills`) — open `clients/page.tsx` + `MessagesAutomationPage.tsx` as live references for exact prop shapes before writing. The user will fine-tune visuals; build clean structure with the API sheet's data, not pixel-perfection.

- [ ] **Step 1: Route shell.** `mobile/src/app/calls/layout.tsx`:

```typescript
import { Metadata } from "next";

export const metadata: Metadata = {
  title: "통화요약 - 아가잼잼 관리자",
  description: "통화요약 - 아가잼잼 관리자",
};

export default function CallsLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

`mobile/src/app/calls/page.tsx`:

```typescript
import { CallInboxPage } from "@/components/app/call-inbox/CallInboxPage";

export default function CallsPage() {
  return <CallInboxPage />;
}
```

- [ ] **Step 2: TranscriptView** `mobile/src/components/app/call-inbox/TranscriptView.tsx`:

```tsx
"use client";

import { cn } from "@/lib/utils";
import type { TranscriptTurn } from "@/lib/call-inbox/types";

const STAFF_SPEAKERS = new Set(["아이미래로", "상담원"]);

export function transcriptTurnId(index: number): string {
  return `transcript-turn-${index}`;
}

/** Find the first turn containing an evidence quote (used for evidence-chip scroll). */
export function findEvidenceTurnIndex(transcript: TranscriptTurn[], evidence: string): number {
  const needle = evidence.replace(/\s/g, "").slice(0, 20);
  return transcript.findIndex((turn) => turn.text.replace(/\s/g, "").includes(needle));
}

export function TranscriptView({
  transcript,
  highlightIndex,
}: {
  transcript: TranscriptTurn[];
  highlightIndex?: number | null;
}) {
  return (
    <div data-component="call-transcript" className="flex flex-col gap-2 rounded-xl bg-gray-50 p-3">
      {transcript.map((turn, index) => {
        const isStaff = STAFF_SPEAKERS.has(turn.speaker);
        return (
          <div
            key={index}
            id={transcriptTurnId(index)}
            className={cn(
              "max-w-[80%] rounded-xl px-3 py-2 text-sm leading-relaxed",
              isStaff ? "self-start bg-gray-200" : "self-end bg-blue-100",
              highlightIndex === index && "ring-2 ring-amber-400",
            )}
          >
            <span className="mb-0.5 block text-[10px] text-gray-500">{turn.speaker}</span>
            {turn.text}
          </div>
        );
      })}
    </div>
  );
}
```

- [ ] **Step 3: CallInboxPage** `mobile/src/components/app/call-inbox/CallInboxPage.tsx` — structure (write fully, modeling list/skeleton/empty-state markup on `clients/page.tsx`):

```tsx
"use client";

import { useState } from "react";
import { Phone } from "lucide-react";

import { useCallRecords, useClientDrafts, usePendingDraftCount } from "@/hooks/useCallInbox";
import { formatCallTime } from "@/lib/call-inbox/format";
import type { CallCategory, CallRecordListItem, ClientDraftListItem } from "@/lib/call-inbox/types";
import { CallReviewSheet } from "./CallReviewSheet";
import { CallLogSheet } from "./CallLogSheet";
import "@/components/app/mobile-redesign/redesign.css";

const CATEGORY_LABEL: Record<string, string> = {
  NEW_CONSULTATION: "신규 상담",
  CLIENT_SERVICE: "변경 요청",
  OTHER: "기타",
};

export function CallInboxPage() {
  const [tab, setTab] = useState<"queue" | "log">("queue");
  const [queuePage, setQueuePage] = useState(1);
  const [logPage, setLogPage] = useState(1);
  const [categoryFilter, setCategoryFilter] = useState<CallCategory | undefined>(undefined);
  const [search, setSearch] = useState("");
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);
  const [openRecordId, setOpenRecordId] = useState<string | null>(null);

  const { data: pendingCount } = usePendingDraftCount();
  const drafts = useClientDrafts("PENDING", queuePage);
  const records = useCallRecords(logPage, categoryFilter, search || undefined);

  return (
    <main data-component="call-inbox-page" className="pb-24 pt-16">
      {/* tabs */}
      <div className="flex border-b border-gray-200">
        <button
          type="button"
          onClick={() => setTab("queue")}
          className={tab === "queue" ? "flex-1 border-b-2 border-blue-600 py-3 text-sm font-bold text-blue-600" : "flex-1 py-3 text-sm text-gray-500"}
        >
          검토 대기 {pendingCount?.count ? `${pendingCount.count}` : ""}
        </button>
        <button
          type="button"
          onClick={() => setTab("log")}
          className={tab === "log" ? "flex-1 border-b-2 border-blue-600 py-3 text-sm font-bold text-blue-600" : "flex-1 py-3 text-sm text-gray-500"}
        >
          통화 기록
        </button>
      </div>

      {tab === "queue" ? (
        <DraftQueue
          drafts={drafts.data?.data ?? []}
          isLoading={drafts.isLoading}
          totalPages={drafts.data?.totalPages ?? 1}
          page={queuePage}
          onPageChange={setQueuePage}
          onOpen={setOpenDraftId}
        />
      ) : (
        <CallLog
          records={records.data?.data ?? []}
          isLoading={records.isLoading}
          totalPages={records.data?.totalPages ?? 1}
          page={logPage}
          onPageChange={setLogPage}
          category={categoryFilter}
          onCategoryChange={(next) => { setCategoryFilter(next); setLogPage(1); }}
          search={search}
          onSearchChange={(next) => { setSearch(next); setLogPage(1); }}
          onOpen={setOpenRecordId}
        />
      )}

      <CallReviewSheet draftId={openDraftId} onClose={() => setOpenDraftId(null)} />
      <CallLogSheet recordId={openRecordId} onClose={() => setOpenRecordId(null)} />
    </main>
  );
}
```

…followed in the same file by `DraftQueue` and `CallLog` presentational components: card rows showing the type `Badge` (신규 상담 teal / 변경 요청 orange / 기타 gray via existing Badge tones), caller `name · phone`, `requestSummary`/`summaryLine` line, `formatCallTime(recordedAt ?? createdAt)`, warning row when `hasLowConfidence` (⚠ 확신도 낮음), `possibleDuplicate` (중복 가능), unlinked CLIENT_UPDATE (고객 연결 필요), matched-client chip; `ListRowsSkeleton` while loading; empty states ("검토할 통화가 없습니다" / "통화 기록이 없습니다"); simple 이전/다음 pager buttons when `totalPages > 1`; CallLog additionally renders the category chip row (전체/신규상담/고객 변경/기타) and `MobileSearchBar`. Copy concrete row markup from `clients/page.tsx` list rows.

- [ ] **Step 4: CallReviewSheet** `mobile/src/components/app/call-inbox/CallReviewSheet.tsx` — full component with this exact behavior:

```tsx
"use client";

import { useEffect, useMemo, useState } from "react";

import { useClientDraft, useConfirmDraft, useDiscardDraft, usePatchDraft } from "@/hooks/useCallInbox";
import { formatDateForInput, formatPhoneNumber } from "@/lib/call-inbox/format";
import type { Proposal } from "@/lib/call-inbox/types";
import { ClientAutocomplete } from "@/components/app/clients/ClientAutocomplete";
import { TranscriptView, findEvidenceTurnIndex, transcriptTurnId } from "./TranscriptView";
import { toast } from "@/hooks/use-toast";

// Form fields for NEW_CLIENT confirm, in ClientFormDialog order.
const TEXT_FIELDS: { key: string; label: string; type: "text" | "date" | "number" }[] = [
  { key: "name", label: "산모명", type: "text" },
  { key: "phone", label: "연락처", type: "text" },
  { key: "address", label: "주소", type: "text" },
  { key: "dueDate", label: "출산예정일", type: "date" },
  { key: "birthday", label: "생년월일 (YYMMDD)", type: "text" },
  { key: "startDate", label: "시작일", type: "date" },
  { key: "endDate", label: "종료일", type: "date" },
  { key: "duration", label: "기간(일)", type: "number" },
];
const BOOL_FIELDS: { key: string; label: string }[] = [
  { key: "careCenter", label: "조리원 이용" },
  { key: "voucherClient", label: "정부지원" },
  { key: "breastPump", label: "유축기" },
];

export function CallReviewSheet({ draftId, onClose }: { draftId: string | null; onClose: () => void }) {
  const { data: draft } = useClientDraft(draftId);
  const confirmDraft = useConfirmDraft(draftId ?? "");
  const discardDraft = useDiscardDraft(draftId ?? "");
  const patchDraft = usePatchDraft(draftId ?? "");

  const [formValues, setFormValues] = useState<Record<string, string | boolean>>({});
  const [suppressGreetingSms, setSuppressGreetingSms] = useState(false);
  const [highlightTurn, setHighlightTurn] = useState<number | null>(null);

  // seed the form from proposals whenever a draft loads
  useEffect(() => {
    if (!draft) return;
    const seeded: Record<string, string | boolean> = {
      careCenter: false, voucherClient: false, breastPump: false,
    };
    for (const proposal of draft.proposals) {
      if (typeof proposal.value === "boolean") seeded[proposal.field] = proposal.value;
      else if (proposal.value !== null) {
        seeded[proposal.field] =
          proposal.field === "phone" ? formatPhoneNumber(String(proposal.value))
          : proposal.field.endsWith("Date") || proposal.field === "dueDate" ? formatDateForInput(String(proposal.value))
          : String(proposal.value);
      }
    }
    if (!seeded.phone && draft.callRecord.callerPhone) {
      seeded.phone = formatPhoneNumber(draft.callRecord.callerPhone);
    }
    setFormValues(seeded);
  }, [draft]);

  const proposalByField = useMemo(() => {
    const map = new Map<string, Proposal>();
    for (const p of draft?.proposals ?? []) map.set(p.field, p);
    return map;
  }, [draft]);

  if (!draftId) return null;
  // render guard + sheet shell: use MobileDetailSheet (copy open/onClose wiring from ClientDetailModal usage)
  // …

  const scrollToEvidence = (evidence: string) => {
    const index = findEvidenceTurnIndex(draft?.callRecord.transcript ?? [], evidence);
    if (index < 0) return;
    setHighlightTurn(index);
    document.getElementById(transcriptTurnId(index))?.scrollIntoView({ behavior: "smooth", block: "center" });
  };

  const handleConfirm = async () => {
    if (!draft) return;
    if (!formValues.name) {
      toast({ title: "산모명은 필수입니다", variant: "destructive" });
      return;
    }
    try {
      const { clientId } = await confirmDraft.mutateAsync({
        fields: {
          name: String(formValues.name),
          phone: formValues.phone ? String(formValues.phone) : null,
          address: formValues.address ? String(formValues.address) : null,
          dueDate: formValues.dueDate ? String(formValues.dueDate) : null,
          birthday: formValues.birthday ? String(formValues.birthday) : null,
          startDate: formValues.startDate ? String(formValues.startDate) : null,
          endDate: formValues.endDate ? String(formValues.endDate) : null,
          duration: formValues.duration ? parseInt(String(formValues.duration), 10) : null,
          careCenter: Boolean(formValues.careCenter),
          voucherClient: Boolean(formValues.voucherClient),
          breastPump: Boolean(formValues.breastPump),
        },
        suppressGreetingSms,
      });
      toast({ title: `고객 등록 완료 (#${clientId})` });
      onClose();
    } catch {
      toast({ title: "등록에 실패했습니다. 입력값을 확인해 주세요.", variant: "destructive" });
    }
  };
  // …
}
```

Complete the JSX: NEW_CLIENT → editable form (Input/Switch from `@/components/ui/*`), each field followed by its evidence chip (`🎙 {evidence}` button → `scrollToEvidence`; amber border via `confidence === "low"`); duplicate-phone warning banner when `draft` flags it; greeting-SMS Switch (label "등록 인사 문자 발송", checked = !suppressGreetingSms); footer buttons [폐기]( → `discardDraft.mutateAsync({})`, toast, close) and [고객 등록]( → `handleConfirm`, disabled while pending). CLIENT_UPDATE → client card (linked) or `ClientAutocomplete` (unlinked → `patchDraft.mutateAsync({ clientId })`); proposals as diff rows (`필드라벨: 제안값` + evidence chip); [변경 적용] rendered `disabled` with caption "Phase 2에서 제공"; [폐기] active. Both types end with `<TranscriptView transcript={draft.callRecord.transcript} highlightIndex={highlightTurn} />` and a `driveUrl` link ("▶ 원본 듣기", `target="_blank"`).

- [ ] **Step 5: CallLogSheet** `mobile/src/components/app/call-inbox/CallLogSheet.tsx` — read-only record detail: header (category badge, caller, time, file name), summary block (`summary.key_content`, `result_action`), FAILED banner with `failureReason`, linked client/draft chips, `TranscriptView`, drive link. Same `MobileDetailSheet` shell; ~80 lines.

- [ ] **Step 6:** `npm run type-check` → clean; manual smoke `npm run dev` → `/calls` renders both tabs against the dev backend. **Commit** `feat(call-inbox): 통화요약 mobile UI — queue, log, review sheets`.

---

### Task 16: Mobile component tests

**Tier:** standard · **Sandbox:** local · **Paths:** `mobile/src/components/app/call-inbox/__tests__/CallInboxPage.test.tsx`, `mobile/src/components/app/call-inbox/__tests__/CallReviewSheet.test.tsx` · **Depends:** Task 15

- [ ] **Step 1:** `CallInboxPage.test.tsx` — mock the hooks module (same idiom as existing __tests__: `jest.mock` + per-test return values):

```tsx
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

import { CallInboxPage } from "../CallInboxPage";

const mockUseClientDrafts = jest.fn();
const mockUseCallRecords = jest.fn();
const mockUsePendingDraftCount = jest.fn();

jest.mock("@/hooks/useCallInbox", () => ({
  useClientDrafts: (...args: unknown[]) => mockUseClientDrafts(...args),
  useCallRecords: (...args: unknown[]) => mockUseCallRecords(...args),
  usePendingDraftCount: () => mockUsePendingDraftCount(),
  useClientDraft: () => ({ data: undefined }),
  useCallRecord: () => ({ data: undefined }),
  useConfirmDraft: () => ({ mutateAsync: jest.fn(), isPending: false }),
  useDiscardDraft: () => ({ mutateAsync: jest.fn(), isPending: false }),
  usePatchDraft: () => ({ mutateAsync: jest.fn(), isPending: false }),
}));

const draft = {
  id: "draft-1", type: "NEW_CLIENT", status: "PENDING",
  requestSummary: "산후도우미 신규 문의", callerName: "김서연", callerPhone: "01048217763",
  recordedAt: "2026-06-10T05:02:11.000Z", createdAt: "2026-06-10T05:10:00.000Z",
  callRecordId: "rec-1", client: null,
  hasLowConfidence: true, possibleDuplicate: false, phoneMatchesExistingClient: false,
};

describe("CallInboxPage", () => {
  beforeEach(() => {
    mockUsePendingDraftCount.mockReturnValue({ data: { count: 1 } });
    mockUseClientDrafts.mockReturnValue({
      data: { data: [draft], total: 1, page: 1, limit: 20, totalPages: 1 },
      isLoading: false,
    });
    mockUseCallRecords.mockReturnValue({ data: undefined, isLoading: true });
  });

  it("renders the queue with type badge, caller, and low-confidence flag", () => {
    render(<CallInboxPage />);
    expect(screen.getByText("신규 상담")).toBeInTheDocument();
    expect(screen.getByText(/김서연/)).toBeInTheDocument();
    expect(screen.getByText(/확신도 낮음/)).toBeInTheDocument();
    expect(screen.getByText(/검토 대기 1/)).toBeInTheDocument();
  });

  it("switches to the call-log tab", async () => {
    const user = userEvent.setup();
    mockUseCallRecords.mockReturnValue({
      data: { data: [], total: 0, page: 1, limit: 20, totalPages: 1 },
      isLoading: false,
    });
    render(<CallInboxPage />);
    await user.click(screen.getByRole("button", { name: "통화 기록" }));
    expect(screen.getByText("통화 기록이 없습니다")).toBeInTheDocument();
  });
});
```

- [ ] **Step 2:** `CallReviewSheet.test.tsx` — same mocking idiom; `useClientDraft` returns a full NEW_CLIENT detail (proposals for name/dueDate with one `confidence: "low"`, transcript of 2 turns); assert: form inputs pre-filled ("김서연", "2026-07-15"), evidence chip rendered, [고객 등록] click calls `mutateAsync` with `fields.name === "김서연"` and `suppressGreetingSms === false`; a CLIENT_UPDATE case asserts [변경 적용] is disabled and [폐기] enabled. (Mock `ClientAutocomplete` with `jest.mock` returning a stub div — it pulls client hooks.)

- [ ] **Step 3: Screenshot/E2E-mode coverage (spec §12).** Read `mobile/tests/screenshots/` and `mobile/src/mocks/` to see how existing routes register E2E-mode mock data; add call-inbox entries (one PENDING NEW_CLIENT draft + one OTHER call record, payloads copied from the fixtures in this plan's Task 7 test) in the same registration point, then add a `/calls` screenshot spec following the neighboring specs' structure. Run `npm run test:screenshots -- calls` → snapshot produced.

- [ ] **Step 4:** `npm test -- call-inbox` → PASS. `npm test` (full mobile suite) → green. **Commit** `test(call-inbox): mobile component tests + /calls screenshots`.

---

### Task 17: n8n workflow template (per-branch)

**Tier:** standard · **Sandbox:** local · **Paths:** `docs/n8n/call-transcription-branch-template.json`, `docs/n8n/README.md` · **Depends:** none (deliverable file; backend contract from Task 5)

- [ ] **Step 1:** Copy the current export as the base: `cp "/Users/jaino/Downloads/Call Transcription (1).json" docs/n8n/call-transcription-branch-template.json` (nodes `Google Drive Trigger`, `Download file`, `Initialize Upload Session`, `Merge Upload URL + Binary`, `Upload File to Gemini`, `Code in JavaScript` (transcribe request builder), `Gemini Transcribe Audio` stay **unchanged** — including the existing Korean transcription/correction prompt and its `responseSchema`).

- [ ] **Step 2:** In the copied file, **delete** nodes `AI Agent - STT Correction`, `Google Gemini Chat Model`, `Code in JavaScript1`, `Send to Backend` (and their `connections` entries), then **add** these four nodes + connections (full JSON to merge into the `nodes` array; positions continue the existing x-spacing):

```json
{
  "parameters": {
    "jsCode": "const pass1 = JSON.parse($json.candidates[0].content.parts[0].text);\nconst requestBody = {\n  contents: [{\n    parts: [{\n      text: `# Role\\n당신은 산후도우미 업체 '아이미래로' 통화 스크립트의 최종 교정자입니다.\\n아래 JSON(1차 전사 결과)의 transcript 발화들에서 남아있는 STT 오인식을 교정하여, 입력과 동일한 JSON 구조로 반환하십시오.\\n# 교정 사전 (좌측 발견 시 우측으로 수정)\\n산우도우미/산우→산후도우미, 구리원/조류원→조리원, 알루사님/이모님(호칭 문맥)→관리사님,\\n재앙절개/재앙→제왕절개, 단퇴/단태→단태아, 쌍/쌍둥→쌍둥이,\\nA가/가형→A가형, A라/라형→A라형, A 통합/A형→A-통합형, 나비/라비→납입(결제 문맥),\\n아이미레로/아이미레/이미래로/아미래로→아이미래로\\n# 규칙\\n- 날짜·금액·기간·전화번호 숫자는 절대 변경 금지\\n- speaker 값과 turn 개수·순서 유지\\n- summary 필드들도 같은 사전으로 교정\\n# 입력 JSON\\n${JSON.stringify(pass1)}`\n    }]\n  }],\n  generationConfig: {\n    responseMimeType: \"application/json\",\n    responseSchema: {\n      type: \"OBJECT\",\n      properties: {\n        summary: { type: \"OBJECT\", properties: {\n          inquiry_type: { type: \"STRING\" }, customer_info: { type: \"STRING\" },\n          key_content: { type: \"STRING\" }, result_action: { type: \"STRING\" } },\n          required: [\"inquiry_type\", \"key_content\"] },\n        transcript: { type: \"ARRAY\", items: { type: \"OBJECT\", properties: {\n          speaker: { type: \"STRING\", \"enum\": [\"아이미래로\", \"고객\", \"산모\", \"남편\"] },\n          text: { type: \"STRING\" } }, required: [\"speaker\", \"text\"] } }\n      },\n      required: [\"summary\", \"transcript\"]\n    }\n  }\n};\nreturn [{ json: { requestBody: JSON.stringify(requestBody) } }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [1568, 0],
  "id": "build-correction-001",
  "name": "Build Correction Request"
},
{
  "parameters": {
    "method": "POST",
    "url": "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent",
    "authentication": "genericCredentialType",
    "genericAuthType": "httpHeaderAuth",
    "sendHeaders": true,
    "headerParameters": { "parameters": [{ "name": "Content-Type", "value": "application/json" }] },
    "sendBody": true,
    "contentType": "raw",
    "rawContentType": "application/json",
    "body": "={{ $json.requestBody }}",
    "options": {}
  },
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [1792, 0],
  "id": "gemini-correct-001",
  "name": "Gemini Correct Transcript",
  "retryOnFail": true,
  "waitBetweenTries": 5000,
  "credentials": { "httpHeaderAuth": { "id": "REPLACE_GEMINI_CREDENTIAL_ID", "name": "Gemini API KEY" } }
},
{
  "parameters": {
    "jsCode": "const corrected = JSON.parse($json.candidates[0].content.parts[0].text);\nconst trigger = $('Google Drive Trigger').item.json;\nreturn [{ json: {\n  fileId: trigger.id,\n  fileName: trigger.name,\n  recordedAt: trigger.createdTime || undefined,\n  transcript: corrected.transcript,\n  summary: corrected.summary\n} }];"
  },
  "type": "n8n-nodes-base.code",
  "typeVersion": 2,
  "position": [2016, 0],
  "id": "build-webhook-payload-001",
  "name": "Build Webhook Payload"
},
{
  "parameters": {
    "method": "POST",
    "url": "https://api.babyjamjam.com/webhooks/call-transcripts",
    "sendHeaders": true,
    "headerParameters": { "parameters": [
      { "name": "Content-Type", "value": "application/json" },
      { "name": "Authorization", "value": "Bearer REPLACE_CALL_INGEST_TOKEN" }
    ] },
    "sendBody": true,
    "specifyBody": "json",
    "jsonBody": "={{ JSON.stringify($json) }}",
    "options": {}
  },
  "type": "n8n-nodes-base.httpRequest",
  "typeVersion": 4.2,
  "position": [2240, 0],
  "id": "post-backend-001",
  "name": "Send to Backend",
  "retryOnFail": true,
  "waitBetweenTries": 10000
}
```

and replace the tail of `connections` so the chain reads: `Gemini Transcribe Audio → Build Correction Request → Gemini Correct Transcript → Build Webhook Payload → Send to Backend`:

```json
"Gemini Transcribe Audio": { "main": [[{ "node": "Build Correction Request", "type": "main", "index": 0 }]] },
"Build Correction Request": { "main": [[{ "node": "Gemini Correct Transcript", "type": "main", "index": 0 }]] },
"Gemini Correct Transcript": { "main": [[{ "node": "Build Webhook Payload", "type": "main", "index": 0 }]] },
"Build Webhook Payload": { "main": [[{ "node": "Send to Backend", "type": "main", "index": 0 }]] }
```

Also set `"name": "Call Transcription — BRANCH_NAME"` and keep `"active": false` in the template.

- [ ] **Step 2b: Merge pass-2 dictionary into pass 1 (spec §4).** In the kept `Code in JavaScript` node (transcribe request builder), extend its terminology list with the entries only the old second pass had — append to the prompt's correction-dictionary section:

```
   - 쌍, 쌍둥 → **쌍둥이** (다태아)
   - A 통합, A형 → **A-통합형**
   - 바우처, 보건소 등록 → **바우처/정부 지원** 문맥 확인
   - 본인 부담금, 자부담 → **본인 부담금**
   - 목적이 홍철, 국적이 → **국적** (다문화 가정 문맥 시)
   - 11월 → 문맥에 따라 **10일(기간)** 또는 **11월(날짜)** 구분
```

- [ ] **Step 3:** `docs/n8n/README.md` — the per-branch import runbook (4 blanks): ① duplicate template in n8n (import JSON), ② set Drive trigger `folderToWatch` to the branch folder, ③ select the operator's existing Drive + Gemini credentials on their nodes, ④ paste the branch's `cit_…` token into `Send to Backend`'s Authorization header; activate; drop a test file; confirm it appears in that branch's 통화요약. Link spec §5.1.

- [ ] **Step 4:** Validate JSON (`node -e "JSON.parse(require('fs').readFileSync('docs/n8n/call-transcription-branch-template.json','utf8')); console.log('valid')"`) → `valid`. **Commit** `docs(call-inbox): per-branch n8n workflow template + onboarding runbook`.

---

### Task 18: Docs sync + full verification

**Tier:** trivial · **Sandbox:** local · **Paths:** `docs/api/call-inbox-api.md`, `docs/superpowers/specs/2026-06-10-call-inbox-design.md` · **Depends:** all

- [ ] **Step 1: API sheet sync** (`docs/api/call-inbox-api.md`): pagination → page/limit with `{data,total,page,limit,totalPages}` (replace `{items,nextCursor}` everywhere); oversized webhook payloads → `400` validation error (not 413); draft statuses gain transient `CONFIRMING`; CLIENT_UPDATE confirm → documented as `501` until Phase 2; count endpoint path confirmed `/client-drafts/count`; `extractionMeta` → `{ model, promptVersion }` (rawResponse not stored — the transcript itself is the re-extraction input). Same corrections in spec §6/§8 status lists.

- [ ] **Step 2: Full verification.**
  - `backend/`: `npm run type-check && npm run lint && npm test` → all green.
  - `mobile/`: `npm run type-check && npm run lint && npm test` → all green. (If type-check trips on `.next/types/validator.ts` TS2307 after merges: `rm -rf mobile/.next` and re-run — known stale-cache false error.)
  - e2e: run the gated backend e2e suite once more.
- [ ] **Step 3: Commit** `docs(call-inbox): sync API sheet + spec with implementation`. Then review `git log --oneline` — the branch should read as a clean feature series.

---

## Execution batching (mechanical, from Depends)

| Batch | Tasks (parallel within batch) |
|---|---|
| 1 | T1 (schema), T2 (phone util), T6 (port+adapter), T12 (BFF), T14 (nav), T17 (n8n) |
| 2 | T3 (tokens+guard), T13 (hooks) |
| 3 | T4 (admin endpoints), T5 (webhook) |
| 4 | T7 (processing) |
| 5 | T8 (retry cron), T9 (staff APIs) |
| 6 | T10 (wiring), T15 (UI) |
| 7 | T11 (e2e), T16 (mobile tests) |
| 8 | T18 (docs sync + verify) |

Path-intersection caveats for parallel dispatch: T4 and T5 both append to `interface/dto/call-inbox.dto.ts` — run sequentially or in one worktree. T13 nominally depends on T12 only for the contract; both are parallel-safe (disjoint paths).

## Env & ops checklist (operator, not code)

- Railway backend: set `GEMINI_API_KEY` (same key n8n uses).
- After deploy: create the first ingest token for your branch via `POST /branches/:branchId/call-ingest-tokens`, wire it into the imported n8n workflow, activate, drop a test recording into the Drive folder.
