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

    it("returns duplicate when a concurrent create loses the unique race (P2002)", async () => {
        prisma.call_record.findUnique
            .mockResolvedValueOnce(null)                     // pre-check misses
            .mockResolvedValueOnce({ id: "rec-winner" });    // post-P2002 re-read
        const p2002 = Object.assign(new Error("Unique constraint failed"), { code: "P2002" });
        prisma.call_record.create.mockRejectedValue(p2002);

        await expect(service.ingest("branch-1", payload)).resolves.toEqual({
            duplicate: true,
            callRecordId: "rec-winner",
        });
        expect(processingService.processCallRecord).not.toHaveBeenCalled();
    });
});
