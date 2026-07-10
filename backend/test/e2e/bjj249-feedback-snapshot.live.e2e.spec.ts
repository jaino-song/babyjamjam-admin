import { Test } from "@nestjs/testing";
import { ConfigModule } from "@nestjs/config";
import { TenantModule } from "infrastructure/tenant/tenant.module";
import { ServiceFeedbackModule } from "module/service-feedback.module";
import { EformsignWebhookModule } from "module/eformsign-webhook.module";
import { ServiceFeedbackService } from "application/services/service-feedback.service";
import { EformsignWebhookService } from "application/services/eformsign-webhook.service";
import { PrismaService } from "infrastructure/database/prisma.service";
import {
    EFORMSIGN_CLIENT_REPOSITORY,
    IEformsignClientRepository,
} from "domain/repositories/eformsign.client.interface";

/**
 * LIVE E2E for BJJ-249 (Task 6.2): runs the REAL finalize path against the shared dev DB and the
 * REAL eformsign tenant — creates and then deletes actual documents. Gated behind LIVE_E2E=1 and
 * excluded from the default unit run (test/e2e/ is in testPathIgnorePatterns).
 *
 * Run:
 *   LIVE_E2E=1 pnpm exec jest test/e2e/bjj249-feedback-snapshot.live.e2e.spec.ts \
 *     --testPathIgnorePatterns=/node_modules/ --runInBand
 *
 * Covers: 7 sessions → 2 chunked documents at the 제공업체 확인 step, full field prefill
 * (marks/dates/texts), finalize idempotency, and the webhook contract-isolation gate — all
 * with real vendors (E2E_VENDOR_STUBS must NOT be set).
 */
const LIVE = process.env["LIVE_E2E"] === "1";

const TEST_TAG = "E2E-BJJ249-삭제예정";
const SESSION_COUNT = 7;

const d = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

(LIVE ? describe : describe.skip)("BJJ-249 live E2E — feedback snapshot finalize", () => {
    jest.setTimeout(180_000);

    let moduleRef: Awaited<ReturnType<ReturnType<typeof Test.createTestingModule>["compile"]>>;
    let prisma: PrismaService;
    let feedbackService: ServiceFeedbackService;
    let webhookService: EformsignWebhookService;
    let eformsignClient: IEformsignClientRepository;

    let branchId: string;
    let branchName: string;
    let clientId: number;
    let employeeId: number;
    let scheduleId: number;
    let createdDocumentIds: string[] = [];

    beforeAll(async () => {
        expect(process.env["E2E_VENDOR_STUBS"]).not.toBe("1"); // must run against real vendors

        moduleRef = await Test.createTestingModule({
            // TenantModule is @Global in the real app — imported here so guards on
            // transitively-imported controllers (SystemSettingModule etc.) resolve.
            imports: [ConfigModule.forRoot({ isGlobal: true }), TenantModule, ServiceFeedbackModule, EformsignWebhookModule],
        }).compile();

        prisma = moduleRef.get(PrismaService, { strict: false });
        feedbackService = moduleRef.get(ServiceFeedbackService, { strict: false });
        webhookService = moduleRef.get(EformsignWebhookService, { strict: false });
        eformsignClient = moduleRef.get(EFORMSIGN_CLIENT_REPOSITORY, { strict: false });

        const branch = await prisma.branch.findFirst();
        if (!branch) throw new Error("no branch row in dev DB");
        branchId = branch.id;
        branchName = branch.name;

        // employee.id is a manually-assigned smallint — grab a free id near the top of the range.
        const maxEmployee = await prisma.employee.aggregate({ _max: { id: true } });
        employeeId = Math.min((maxEmployee._max.id ?? 0) + 101, 32700);
        await prisma.employee.create({
            data: {
                id: employeeId,
                name: `테스트인력-${TEST_TAG}`,
                workArea: ["E2E"],
                phone: `010-0000-${String(Date.now()).slice(-4)}`,
                grade: "E2E",
                branchId,
            },
        });

        const client = await prisma.client.create({
            data: {
                name: `테스트고객-${TEST_TAG}`,
                duration: SESSION_COUNT,
                voucherClient: false,
                branchId,
            } as never,
        });
        clientId = client.id;

        const schedule = await prisma.employee_schedule.create({
            data: {
                primaryEmployeeId: employeeId,
                clientId,
                branchId,
                workAddress: "E2E 테스트 주소",
                startDate: d("2026-07-01"),
                endDate: d("2026-07-31"),
            },
        });
        scheduleId = schedule.id;

        await prisma.service_record.create({
            data: {
                branchId,
                scheduleId,
                momName: "김산모",
                momBirth: "900101",
                babyName: "김아기",
                babyBirth: "260615",
                deliveryType: "자연분만",
                babyWeight: "3.2",
            },
        });

        const fullAnswers = {
            perineum: ["열상"],
            breast: ["이상없음"],
            excretion: ["이상없음"],
            sitzBath: "실시",
            meals_meal: "3",
            meals_snack: "2",
            temperature_temp: "36.8",
            sleep: "잘 잠",
            breastFeeding_count: "5",
            formulaFeeding_count: "2",
            formulaFeeding_ml: "60",
            stool: "이상변",
            stool_color: "녹색",
            bath: "실시",
        };
        const lightAnswers = { sitzBath: "미실시", sleep: "잘 못 잠", stool: "정상변" };

        for (let i = 1; i <= SESSION_COUNT; i++) {
            await prisma.service_record_day.create({
                data: {
                    branchId,
                    scheduleId,
                    sessionIndex: i,
                    serviceDate: d(`2026-07-0${i}`), // sessions 1..7 → 07-01..07-07
                    answers: i === 1 ? fullAnswers : lightAnswers,
                    etcService: i === 1 ? "예방접종 안내" : null,
                    notes: i === 1 ? "E2E 특이사항" : null,
                    paymentConfirmed: i % 2 === 1, // odd sessions confirmed
                    momApproval: "approved",
                    locked: true,
                    submittedAt: new Date(),
                },
            });
        }
    });

    afterAll(async () => {
        // Best-effort cleanup — remote documents first, then DB rows (FK order).
        try {
            if (createdDocumentIds.length && eformsignClient) {
                const token = await eformsignClient.getAccessToken(Date.now());
                const access = token.oauth_token.access_token;
                const base = process.env["EFORMSIGN_DOC_API_URL"];
                const res = await fetch(`${base}/v2.0/api/documents`, {
                    method: "DELETE",
                    headers: { "Content-Type": "application/json", Authorization: `Bearer ${access}` },
                    body: JSON.stringify({ document_ids: createdDocumentIds }),
                });
                // eslint-disable-next-line no-console
                console.log(`[cleanup] eformsign DELETE -> ${res.status} ${(await res.text()).slice(0, 160)}`);
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.log(`[cleanup] eformsign delete failed: ${e} — void manually: ${createdDocumentIds.join(", ")}`);
        }
        try {
            if (prisma && scheduleId) {
                await prisma.eformsign_doc.deleteMany({ where: { documentId: { in: createdDocumentIds } } });
                await prisma.service_record_day.deleteMany({ where: { scheduleId } });
                await prisma.service_record.deleteMany({ where: { scheduleId } });
                await prisma.employee_schedule.deleteMany({ where: { id: scheduleId } });
                await prisma.client.deleteMany({ where: { id: clientId } });
                await prisma.employee.deleteMany({ where: { id: employeeId } });
            }
        } catch (e) {
            // eslint-disable-next-line no-console
            console.log(`[cleanup] DB cleanup failed: ${e} — rows tagged ${TEST_TAG} need manual removal`);
        }
        await moduleRef?.close();
    });

    it("finalize creates ceil(7/5)=2 fully prefilled documents at the 제공업체 확인 step", async () => {
        const result = await feedbackService.finalize({
            tokenId: "live-e2e",
            branchId,
            scheduleId,
            employeeId,
        });

        expect(result.chunkCount).toBe(2);
        expect(result.documentIds).toHaveLength(2);
        expect(new Set(result.documentIds).size).toBe(2);
        createdDocumentIds = result.documentIds;

        const token = await eformsignClient.getAccessToken(Date.now());
        const access = token.oauth_token.access_token;

        const fieldsOf = async (docId: string) => {
            const doc = await eformsignClient.getDocument(access, docId);
            const map = new Map<string, string>();
            for (const f of doc.fields ?? []) map.set(f.id, f.value);
            return { doc, map };
        };

        // ── Document 1: sessions 1–5 ──
        const { doc: doc1, map: m1 } = await fieldsOf(result.documentIds[0]!);
        expect(doc1.current_status?.step_name).toBe("제공업체 확인");
        expect(m1.get("산모 이름")).toBe("김산모");
        expect(m1.get("산모 생년월일")).toBe("1990-01-01");
        expect(m1.get("신생아 출생일자")).toBe("2026-06-15");
        expect(m1.get("제공기관 이름")).toBe(branchName);
        expect(m1.get("자연분만")).toBe("체크1");
        expect(m1.get("월 1")).toBe("07");
        expect(m1.get("일 1")).toBe("01");
        expect(m1.get("일 5")).toBe("05");
        // session 1 detail
        expect(m1.get("회음절개부위 열상 1")).toBe("체크1");
        expect(m1.get("좌욕 실시 1")).toBe("체크1");
        expect(m1.get("이상변 1")).toBe("체크1");
        expect(m1.get("색깔 1")).toBe("녹색");
        expect(m1.get("체온 1")).toBe("36.8");
        expect(m1.get("식사 1")).toBe("3");
        expect(m1.get("기타서비스 1")).toBe("예방접종 안내");
        // session 2 (light answers, payment unconfirmed)
        expect(m1.get("좌욕 미실시 2")).toBe("체크1");
        expect(m1.get("정상변 2")).toBe("체크1");
        expect(m1.get("결제 확인 2") ?? "").toBe(""); // unchecked
        // payment pattern: odd sessions checked
        expect(m1.get("결제 확인 1")).toBe("체크1");
        expect(m1.get("결제 확인 3")).toBe("체크1");
        // mom approval everywhere
        for (let n = 1; n <= 5; n++) expect(m1.get(`산모확인서명 ${n}`)).toBe("체크1");

        // ── Document 2: sessions 6–7 in slots 1–2; slots 3–5 unused ──
        const { doc: doc2, map: m2 } = await fieldsOf(result.documentIds[1]!);
        expect(doc2.current_status?.step_name).toBe("제공업체 확인");
        expect(m2.get("월 1")).toBe("07");
        expect(m2.get("일 1")).toBe("06"); // session 6 lands in slot 1
        expect(m2.get("일 2")).toBe("07");
        expect(m2.get("월 3") ?? "").toBe(""); // unused slot: no date
        expect(m2.get("산모확인서명 1")).toBe("체크1");
        expect(m2.get("산모확인서명 3") ?? "").toBe(""); // unused slot mark unchecked
        expect(m2.get("결제 확인 5") ?? "").toBe("");
    });

    it("re-running finalize is idempotent — same documents, no duplicates", async () => {
        const again = await feedbackService.finalize({
            tokenId: "live-e2e",
            branchId,
            scheduleId,
            employeeId,
        });
        expect(again.chunkCount).toBe(2);
        expect([...again.documentIds].sort()).toEqual([...createdDocumentIds].sort());

        const rows = await prisma.eformsign_doc.findMany({
            where: { stepName: { startsWith: `제공기록지 S${scheduleId} ` } },
        });
        expect(rows).toHaveLength(2);
    });

    it("webhook completion for a feedback document does NOT touch the client contract", async () => {
        const before = await prisma.client.findUnique({ where: { id: clientId } });
        expect(before?.eDocId).toBeNull();

        await (webhookService as never as {
            handleDocumentEvent(branchId: string, ev: Record<string, unknown>): Promise<void>;
        }).handleDocumentEvent(branchId, {
            id: createdDocumentIds[0],
            status: "doc_complete",
            document_title: `서비스 제공기록지 - 테스트고객-${TEST_TAG} (1/2)`,
            template_id: process.env["EFORMSIGN_FEEDBACK_TEMPLATE_ID"],
            workflow_seq: 1,
            workflow_name: "wf",
        });

        const after = await prisma.client.findUnique({ where: { id: clientId } });
        expect(after?.eDocId).toBeNull(); // BJJ-247 invariant: feedback docs never link eDocId
        expect(after?.endDate).toEqual(before?.endDate ?? null);
    });
});
