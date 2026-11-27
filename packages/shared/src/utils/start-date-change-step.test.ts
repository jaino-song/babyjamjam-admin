import { getStartDateChangeStep } from "./start-date-change-step";

const TODAY = "2026-11-27";

describe("getStartDateChangeStep", () => {
    it("asks the started question while the service is running, through its end date", () => {
        const lock = { serviceStarted: true, recordedSessionCount: 3 };
        expect(getStartDateChangeStep(lock, "2026-12-01", TODAY)).toBe("started");
        expect(getStartDateChangeStep(lock, "2026-11-27", TODAY)).toBe("started");
        expect(getStartDateChangeStep(lock, "2026-11-27T00:00:00.000Z", TODAY)).toBe("started");
    });

    it("treats a started service without an end date as running", () => {
        expect(getStartDateChangeStep({ serviceStarted: true, recordedSessionCount: 0 }, null, TODAY)).toBe("started");
    });

    it("skips the started question once the service has ended, asking only about written sessions", () => {
        expect(getStartDateChangeStep({ serviceStarted: true, recordedSessionCount: 3 }, "2026-11-26", TODAY)).toBe("records");
        expect(getStartDateChangeStep({ serviceStarted: true, recordedSessionCount: 0 }, "2026-11-26", TODAY)).toBeNull();
    });

    it("asks only about written sessions before the service starts", () => {
        expect(getStartDateChangeStep({ serviceStarted: false, recordedSessionCount: 2 }, "2026-12-10", TODAY)).toBe("records");
        expect(getStartDateChangeStep({ serviceStarted: false, recordedSessionCount: 0 }, "2026-12-10", TODAY)).toBeNull();
    });

    it("sends a finalized household straight to the records question", () => {
        const finalized = { serviceStarted: true, recordedSessionCount: 10, finalized: true as const };
        expect(getStartDateChangeStep(finalized, "2026-12-01", TODAY)).toBe("records");
        expect(getStartDateChangeStep(finalized, "2026-11-20", TODAY)).toBe("records");
        expect(getStartDateChangeStep({ ...finalized, serviceStarted: false }, "2026-12-10", TODAY)).toBe("records");
    });
});
