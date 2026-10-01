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
    });
});
