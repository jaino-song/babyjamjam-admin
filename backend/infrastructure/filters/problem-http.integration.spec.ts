import { BadRequestException, Body, ConflictException, Controller, INestApplication, Post } from "@nestjs/common";
import { HttpAdapterHost } from "@nestjs/core";
import { Test } from "@nestjs/testing";
import { IsDefined, IsString } from "class-validator";
import request from "supertest";

import { codeOnlyProblemBody, problemBody } from "../../application/utils/problem-bodies";
import { PROBLEM_CATALOG } from "@babyjamjam/shared/errors/problem-details";
import { ServiceRecordSentryExceptionFilter } from "../observability/service-record-sentry-exception.filter";
import { GlobalValidationPipe } from "../pipes/global-validation.pipe";

jest.mock("../observability/service-record-sentry", () => ({
    captureBackendError: jest.fn(), captureServiceRecordError: jest.fn(),
    isServiceRecordSignal: () => false, getServiceRecordOperation: () => "context",
}));

class Input {
    @IsDefined() @IsString() name!: string;
    @IsDefined() @IsString() phone!: string;
}
let changes = 0;

@Controller("problem-probe")
class ProbeController {
    @Post()
    create(@Body() input: Input) {
        changes += 1;
        return { accepted: true, name: input.name };
    }

    @Post("uncertain")
    uncertain() {
        changes += 1;
        throw new Error("private database diagnostic");
    }

    // 아래 프루브 본문들은 admin-service-record-edit.service.ts의 실제 충돌 응답
    // 모양을 그대로 재현해요. 문제 본문 옆의 호환 확장 키가 와이어까지 살아
    // 있는지(409 복구 UX)와 경계가 소유한 멤버가 위조되지 않는지를 검증해요.
    @Post("draft-conflict")
    draftConflict() {
        // throwConflictWithLatest (admin-service-record-edit.service.ts:1112-1118)
        throw new ConflictException({
            ...codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"),
            latestDraft: { id: "draft-9", status: "ACTIVE", changes: { header: { momName: "최신" } }, draftVersion: 4 },
            sourceChanged: true,
            sourceCaseVersion: 7,
            sourceFingerprint: "fingerprint-latest",
        });
    }

    @Post("source-changed")
    sourceChanged() {
        // previewDraft 원본 변경 충돌 (admin-service-record-edit.service.ts:552-558)
        throw new ConflictException({
            ...codeOnlyProblemBody("SERVICE_RECORD_WRITE_TARGET_CHANGED"),
            sourceChanged: true,
            sourceCaseVersion: 7,
            sourceFingerprint: "fingerprint-latest",
            draft: { id: "draft-9", status: "ACTIVE", changes: {}, draftVersion: 4 },
        });
    }

    @Post("preview-stale")
    previewStale() {
        // buildConfirmPlan 미리보기 불일치 (admin-service-record-edit.service.ts:688-693)
        throw new ConflictException({
            ...codeOnlyProblemBody("REQUEST_STALE"),
            previewId: "srp_" + "a".repeat(64),
            sourceCaseVersion: 7,
            sourceFingerprint: "fingerprint-latest",
        });
    }

    @Post("preview-blocked")
    previewBlocked() {
        // buildConfirmPlan 차간 사유 (admin-service-record-edit.service.ts:696-699)
        throw new ConflictException({
            ...codeOnlyProblemBody("REQUEST_CONFLICT"),
            blockingReasons: [{ code: "UNSUPPORTED_SESSION_COUNT", message: "회차 수를 확인할 수 없습니다." }],
        });
    }

    @Post("schedule-validation")
    scheduleValidation() {
        // updateDraft 일정 벡터 검증 (admin-service-record-edit.service.ts:498-507)
        throw new BadRequestException({
            ...problemBody("VALIDATION_FAILED", {
                pointer: "/changes",
                code: "INVALID_VALUE",
                detail: "제공기록 일정 변경을 적용할 수 없어요.",
                location: "body",
            }),
            message: "2회차 날짜가 다른 회차와 겹칩니다.",
            sessionIndex: 2,
        });
    }

    @Post("spoofed-members")
    spoofedMembers() {
        // 경계가 소유한 멤버는 던진 본문으로 바꿀 수 없어야 해요.
        // (잘못된 type 위조는 invalid producer 계약에서 이미 500 fail-closed로 검증돼요.)
        throw new ConflictException({
            ...codeOnlyProblemBody("REQUEST_CONFLICT"),
            detail: "내부 진단 텍스트 유출",
            title: "위조된 제목",
            requestId: "spoofed-request-id",
            statusCode: 200,
            error: "위조된 오류",
            latestDraft: { id: "draft-9" },
        });
    }
}

describe("problem contract over HTTP", () => {
    let app: INestApplication;
    beforeAll(async () => {
        const module = await Test.createTestingModule({ controllers: [ProbeController] }).compile();
        app = module.createNestApplication();
        app.useGlobalPipes(new GlobalValidationPipe({ whitelist: true, forbidNonWhitelisted: true, transform: true }));
        app.useGlobalFilters(new ServiceRecordSentryExceptionFilter(app.get(HttpAdapterHost)));
        await app.init();
    });
    beforeEach(() => { changes = 0; });
    afterAll(async () => { await app.close(); });

    it("returns both missing fields and leaves the operation unapplied", async () => {
        const response = await request(app.getHttpServer()).post("/problem-probe").send({}).expect(400);
        expect(response.headers["content-type"]).toContain("application/problem+json");
        expect(response.headers["cache-control"]).toBe("no-store");
        expect(response.body.requestId).toBe(response.headers["x-request-id"]);
        expect(response.body).toMatchObject({ code: "VALIDATION_FAILED", outcome: "NOT_APPLIED" });
        expect(new Set(response.body.errors.map((field: { pointer: string }) => field.pointer))).toEqual(new Set(["/name", "/phone"]));
        expect(changes).toBe(0);
        await request(app.getHttpServer()).post("/problem-probe").send({ name: "test", phone: "test" }).expect(201);
        expect(changes).toBe(1);
    });

    it("does not claim rollback when an error follows a completed change", async () => {
        const response = await request(app.getHttpServer()).post("/problem-probe/uncertain").send({}).expect(500);
        expect(response.body.outcome).toBe("UNKNOWN");
        expect(JSON.stringify(response.body)).not.toContain("private database");
        expect(changes).toBe(1);
    });

    // B1 회귀: 변환된 409 본문이 관리자 편집기 복구 UX가 읽는 호환 확장 키를
    // 잃지 않는지 확인해요. 던진 본문의 확장 키가 그대로 와이어에 나와야 해요.
    it("keeps draft-recovery extras on a SERVICE_RECORD_WRITE_TARGET_CHANGED conflict", async () => {
        const response = await request(app.getHttpServer()).post("/problem-probe/draft-conflict").expect(409);
        expect(response.headers["content-type"]).toContain("application/problem+json");
        expect(response.body).toMatchObject({
            code: "SERVICE_RECORD_WRITE_TARGET_CHANGED",
            outcome: "NOT_APPLIED",
            latestDraft: { id: "draft-9", status: "ACTIVE", draftVersion: 4 },
            sourceChanged: true,
            sourceCaseVersion: 7,
            sourceFingerprint: "fingerprint-latest",
        });
    });

    it("keeps the draft alias extra on the preview source-changed conflict", async () => {
        const response = await request(app.getHttpServer()).post("/problem-probe/source-changed").expect(409);
        expect(response.body).toMatchObject({
            code: "SERVICE_RECORD_WRITE_TARGET_CHANGED",
            sourceChanged: true,
            sourceCaseVersion: 7,
            sourceFingerprint: "fingerprint-latest",
            draft: { id: "draft-9", status: "ACTIVE", draftVersion: 4 },
        });
    });

    it("keeps the recomputed previewId extra on a REQUEST_STALE conflict", async () => {
        const response = await request(app.getHttpServer()).post("/problem-probe/preview-stale").expect(409);
        expect(response.body).toMatchObject({
            code: "REQUEST_STALE",
            previewId: `srp_${"a".repeat(64)}`,
            sourceCaseVersion: 7,
            sourceFingerprint: "fingerprint-latest",
        });
    });

    it("keeps blockingReasons extra on a REQUEST_CONFLICT conflict", async () => {
        const response = await request(app.getHttpServer()).post("/problem-probe/preview-blocked").expect(409);
        expect(response.body).toMatchObject({
            code: "REQUEST_CONFLICT",
            blockingReasons: [{ code: "UNSUPPORTED_SESSION_COUNT", message: "회차 수를 확인할 수 없습니다." }],
        });
    });

    it("keeps the schedule sessionIndex extra on a schedule-validation rejection", async () => {
        const response = await request(app.getHttpServer()).post("/problem-probe/schedule-validation").expect(400);
        expect(response.body).toMatchObject({
            code: "VALIDATION_FAILED",
            sessionIndex: 2,
        });
        // 던진 본문의 message는 경계가 소유한 별칭이라 카탈로그 문안으로만
        // 나가요(생산자 message 텍스트는 와이어로 나가지 않는 기존 불변식).
        expect(response.body.message).toBe(PROBLEM_CATALOG.VALIDATION_FAILED.detail["ko-KR"]);
        expect(response.body.message).not.toBe("2회차 날짜가 다른 회차와 겹칩니다.");
    });

    it("never lets a thrown body override boundary-owned members or leak producer texts", async () => {
        const response = await request(app.getHttpServer()).post("/problem-probe/spoofed-members").expect(409);
        expect(response.body).toMatchObject({
            code: "REQUEST_CONFLICT",
            status: 409,
            statusCode: 409,
            type: PROBLEM_CATALOG.REQUEST_CONFLICT.type,
            title: PROBLEM_CATALOG.REQUEST_CONFLICT.title["ko-KR"],
            detail: PROBLEM_CATALOG.REQUEST_CONFLICT.detail["ko-KR"],
            latestDraft: { id: "draft-9" },
        });
        expect(response.body.requestId).toBe(response.headers["x-request-id"]);
        expect(JSON.stringify(response.body)).not.toContain("내부 진단 텍스트 유출");
        expect(JSON.stringify(response.body)).not.toContain("spoofed-request-id");
        expect(JSON.stringify(response.body)).not.toContain("위조된 제목");
    });
});
