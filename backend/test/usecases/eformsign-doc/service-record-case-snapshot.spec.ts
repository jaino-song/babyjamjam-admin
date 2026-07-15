import { CreateAndSendFeedbackSnapshotUsecase } from "application/usecases/eformsign-doc/create-and-send-feedback-snapshot.usecase";

const dbDate = (day: number) => new Date(`2026-07-${String(day).padStart(2, "0")}T00:00:00.000Z`);

function makeRecord() {
    return {
        id: "11111111-2222-3333-4444-555555555555",
        branchId: "branch-1",
        clientId: 10,
        status: "FINALIZING",
        startDate: dbDate(1),
        endDate: dbDate(12),
        requiredSessionCount: 7,
        formVersion: 1,
        momName: "김산모",
        momBirth: "900101",
        babyName: "김아기",
        babyBirth: "260701",
        deliveryType: "자연분만",
        babyWeight: "3.2",
        completedAt: new Date(),
        finalizationDueAt: new Date("2026-07-12T11:00:00.000Z"),
        finalizationStartedAt: new Date(),
        finalizedAt: null,
        documentsCompletedAt: null,
        finalizationAttempts: 1,
        nextAttemptAt: null,
        lastError: null,
        version: 1,
        createdAt: new Date(),
        updatedAt: new Date(),
        branch: { name: "인천 아이미래로" },
        client: { name: "김고객" },
        assignments: [
            {
                id: "assignment-a",
                scheduleId: 101,
                employeeId: 1,
                employeeNameSnapshot: "제공A",
                startDate: dbDate(1),
                endDate: dbDate(6),
            },
            {
                id: "assignment-b",
                scheduleId: 102,
                employeeId: 2,
                employeeNameSnapshot: "제공B",
                startDate: dbDate(7),
                endDate: dbDate(12),
            },
        ],
        days: Array.from({ length: 7 }, (_, index) => {
            const sessionIndex = index + 1;
            const secondProvider = sessionIndex === 7;
            return {
                scheduleId: secondProvider ? 102 : 101,
                caseSessionIndex: sessionIndex,
                employeeId: secondProvider ? 2 : 1,
                employeeNameSnapshot: secondProvider ? "제공B" : "제공A",
                serviceDate: dbDate(sessionIndex),
                answers: {},
                etcService: null,
                notes: null,
                paymentConfirmed: true,
                momApproval: "approved",
                clientSignature: null as string | null,
                locked: true,
            };
        }),
    };
}

function setup() {
    const snapshotChunk = {
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
        update: jest.fn().mockResolvedValue({}),
    };
    const eformsignDoc = {
        upsert: jest.fn().mockResolvedValue({}),
    };
    const prisma = {
        service_record_snapshot_chunk: snapshotChunk,
        eformsign_doc: eformsignDoc,
    };
    const prismaWithTransaction = Object.assign(prisma, {
        $transaction: jest.fn(async (callback: (tx: typeof prisma) => Promise<unknown>) => callback(prisma)),
    });
    const remoteDocument = {
        id: "remote-doc-1",
        document_number: "SR-1",
        template: { id: "template-1", name: "제공기록지" },
        document_name: "서비스 제공기록지 - 김고객 (1/1) [SR-11111111-v1]",
        creator: { recipient_type: "01", id: "reviewer@example.com", name: "검토자" },
        created_date: Date.now(),
        updated_date: Date.now(),
        current_status: {
            status_type: "070",
            status_doc_type: "진행중",
            status_doc_detail: "검토 요청",
            step_type: "06",
            step_index: "2",
            step_name: "제공업체 확인",
            step_recipients: [{ recipient_type: "01", id: "reviewer@example.com", name: "검토자" }],
            step_group: 0,
            expired_date: Date.now() + 86_400_000,
            _expired: false,
        },
    };
    const eformsignClient = {
        createDocument: jest.fn().mockRejectedValue(new TypeError("fetch failed")),
        findDocumentsByTitle: jest.fn().mockResolvedValue([remoteDocument]),
    };
    const usecase = new CreateAndSendFeedbackSnapshotUsecase(
        eformsignClient as never,
        {} as never,
        prismaWithTransaction as never,
        {} as never,
        {} as never,
        {} as never,
    );
    return { usecase, prisma: prismaWithTransaction, eformsignClient, remoteDocument };
}

describe("client-owned service record snapshot", () => {
    it("splits at provider boundaries as well as the five-session template limit", () => {
        const { usecase } = setup();
        const chunks = (usecase as unknown as {
            buildCaseChunks(record: ReturnType<typeof makeRecord>): Array<{ employeeName: string; days: unknown[] }>;
        }).buildCaseChunks(makeRecord());

        expect(chunks.map((chunk) => [chunk.employeeName, chunk.days.length])).toEqual([
            ["제공A", 5],
            ["제공A", 1],
            ["제공B", 1],
        ]);
    });

    it("changes sourceHash when a day's clientSignature changes (legacy session gets a signature)", () => {
        const { usecase } = setup();
        const buildChunks = (record: ReturnType<typeof makeRecord>) => (usecase as unknown as {
            buildCaseChunks(value: ReturnType<typeof makeRecord>): Array<{ sourceHash: string }>;
        }).buildCaseChunks(record);

        const withoutSignature = makeRecord();
        withoutSignature.requiredSessionCount = 1;
        withoutSignature.days = [withoutSignature.days[0]!];
        const hashWithoutSignature = buildChunks(withoutSignature)[0]!.sourceHash;

        const withSignature = makeRecord();
        withSignature.requiredSessionCount = 1;
        withSignature.days = [{
            ...withSignature.days[0]!,
            clientSignature: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAAB",
        }];
        const hashWithSignature = buildChunks(withSignature)[0]!.sourceHash;

        expect(hashWithSignature).not.toBe(hashWithoutSignature);
    });

    it("reconciles an ambiguous create attempt by title without creating a second document", async () => {
        const { usecase, prisma, eformsignClient, remoteDocument } = setup();
        const record = makeRecord();
        record.requiredSessionCount = 1;
        record.days = [record.days[0]!];
        record.assignments = [record.assignments[0]!];
        const chunk = (usecase as unknown as {
            buildCaseChunks(value: ReturnType<typeof makeRecord>): Array<Record<string, unknown>>;
        }).buildCaseChunks(record)[0]!;
        const processor = usecase as unknown as {
            processChunk(params: Record<string, unknown>): Promise<string>;
        };
        const common = {
            record,
            chunk,
            chunkId: "chunk-1",
            chunkAttempts: 0,
            chunkClaimedAt: null,
            chunkCreateAttemptedAt: null,
            templateId: "template-1",
            accessToken: "access-token",
            reviewer: { name: "검토자", id: "reviewer@example.com" },
        };

        await expect(processor.processChunk({ ...common, chunkStatus: "PENDING" }))
            .rejects.toThrow("fetch failed");
        expect(prisma.service_record_snapshot_chunk.update).toHaveBeenLastCalledWith(expect.objectContaining({
            data: expect.objectContaining({ status: "RECONCILING" }),
        }));

        await expect(processor.processChunk({
            ...common,
            chunkStatus: "RECONCILING",
            chunkAttempts: 1,
            chunkCreateAttemptedAt: new Date(),
        })).resolves.toBe(remoteDocument.id);

        expect(eformsignClient.createDocument).toHaveBeenCalledTimes(1);
        expect(eformsignClient.findDocumentsByTitle).toHaveBeenCalledWith(
            "access-token",
            chunk["documentName"],
        );
        expect(prisma.eformsign_doc.upsert).toHaveBeenCalledWith(expect.objectContaining({
            where: { documentId: remoteDocument.id },
            update: expect.objectContaining({
                statusType: "070",
                statusDetail: "검토 요청",
                stepType: "06",
                stepIndex: "2",
                expired: false,
            }),
        }));
        expect(prisma.service_record_snapshot_chunk.update).toHaveBeenLastCalledWith(expect.objectContaining({
            data: expect.objectContaining({
                status: "CREATED",
                eformsignDocumentId: remoteDocument.id,
            }),
        }));
    });
});
