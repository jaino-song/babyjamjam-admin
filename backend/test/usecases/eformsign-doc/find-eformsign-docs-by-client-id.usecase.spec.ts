import { FindEformsignDocsByClientIdUsecase } from "application/usecases/eformsign-doc/find-eformsign-docs-by-client-id.usecase";
import { EformsignDocEntity } from "domain/entities/eformsign-doc.entity";
import { createKrBusinessDayCalendar, KR_BUILTIN_HOLIDAYS } from "domain/utils/business-days";
import { createHolidayCalendarStub } from "../../utils/holiday-calendar.stub";

function providerReviewDoc(documentId: string): EformsignDocEntity {
    return EformsignDocEntity.create({
        documentId,
        documentName: "계약서",
        createdDate: new Date("2026-07-01T00:00:00Z"),
        statusType: "070",
        statusDetail: "제공기관 확인",
        stepType: "06",
        stepIndex: "1",
        stepName: "제공기관 확인",
        stepRecipientType: "06",
        stepRecipientName: "제공기관",
        stepRecipientSms: "010-0000-0000",
        expiredDate: new Date("2026-12-01T00:00:00Z"),
        expired: false,
        clientId: 10,
    });
}

describe("FindEformsignDocsByClientIdUsecase.executeWithContractEndDates", () => {
    const docs = [providerReviewDoc("doc-1"), providerReviewDoc("doc-2")];
    const repository = {
        findByClientId: jest.fn(),
        findContractEndDatesByDocumentIds: jest.fn(),
        findVoidedByNames: jest.fn().mockResolvedValue(new Map()),
    };

    beforeEach(() => {
        repository.findByClientId.mockResolvedValue(docs);
        repository.findContractEndDatesByDocumentIds.mockResolvedValue(
            new Map([["doc-1", "2026-08-07"], ["doc-2", "2026-08-07"]]),
        );
    });

    afterEach(() => {
        jest.useRealTimers();
        jest.clearAllMocks();
    });

    it("resolves every row's display status on the branch calendar, fetched once", async () => {
        // End date Fri 2026-08-07, today Wed 2026-08-05 (KST): the built-in window opens
        // Thu 8/6 (서명 완료); a branch holiday on 8/6 opens it Wed 8/5 (검토 필요).
        jest.useFakeTimers({ now: new Date("2026-08-05T03:00:00.000Z") });

        const builtinStub = createHolidayCalendarStub();
        const builtin = await new FindEformsignDocsByClientIdUsecase(repository as never, builtinStub)
            .executeWithContractEndDates("branch-1", 10);

        const branchStub = createHolidayCalendarStub();
        (branchStub.forBranch as jest.Mock).mockResolvedValue(
            createKrBusinessDayCalendar([...KR_BUILTIN_HOLIDAYS, "2026-08-06"], { supportedYears: [2026] }),
        );
        const branch = await new FindEformsignDocsByClientIdUsecase(repository as never, branchStub)
            .executeWithContractEndDates("branch-1", 10);

        expect(builtin.map((doc) => doc.displayStatus)).toEqual(["signed", "signed"]);
        expect(branch.map((doc) => doc.displayStatus)).toEqual(["review", "review"]);
        expect(branchStub.forBranch).toHaveBeenCalledTimes(1);
        expect(branchStub.forBranch).toHaveBeenCalledWith("branch-1");
        expect(builtin[0]).toMatchObject({ voidedAt: null, voidedByName: null });
        expect(repository.findVoidedByNames).not.toHaveBeenCalled();
    });

    it("batches distinct actor ids once and never returns the actor id or email", async () => {
        const voidedAt = new Date("2026-10-14T00:00:00Z");
        const voided = (id: string, actor: string) => EformsignDocEntity.reconstitute({
            ...providerReviewDoc(id).toJSON(), voidedAt, voidedBy: actor,
        });
        repository.findByClientId.mockResolvedValue([
            voided("a", "actor-1"), voided("b", "actor-1"), voided("c", "actor-2"),
            voided("d", "deleted-actor"), providerReviewDoc("live"),
        ]);
        repository.findVoidedByNames.mockResolvedValue(new Map([["actor-1", "담당자"], ["actor-2", null]]));
        const result = await new FindEformsignDocsByClientIdUsecase(repository as never, createHolidayCalendarStub())
            .executeWithContractEndDates("branch-1", 10);
        expect(repository.findVoidedByNames).toHaveBeenCalledTimes(1);
        expect(repository.findVoidedByNames).toHaveBeenCalledWith(["actor-1", "actor-2", "deleted-actor"]);
        expect(result.map((doc) => doc.voidedByName)).toEqual(["담당자", "담당자", null, null, null]);
        expect(result.slice(0, 4).every((doc) => doc.displayStatus === "voided" && doc.voidedAt === voidedAt.toISOString())).toBe(true);
        expect(result[4]).toMatchObject({ voidedAt: null, voidedByName: null });
        for (const doc of result) {
            expect(doc).not.toHaveProperty("voidedBy");
            expect(doc).not.toHaveProperty("email");
        }
    });
});
