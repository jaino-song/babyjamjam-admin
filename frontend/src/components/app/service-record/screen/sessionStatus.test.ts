import { getAdminSessionStatus } from "./sessionStatus";

// The sixteen input combinations are explicit so changing precedence cannot change the oracle.
describe("getAdminSessionStatus", () => {
    it.each([
        [false, false, false, false, "조회 가능", undefined],
        [false, false, false, true, "편집 가능", undefined],
        [false, false, true, false, "제출완료", undefined],
        [false, false, true, true, "제출완료", undefined],
        [false, true, false, false, "수정 완료", "success"],
        [false, true, false, true, "수정 완료", "success"],
        [false, true, true, false, "수정 완료", "success"],
        [false, true, true, true, "수정 완료", "success"],
        [true, false, false, false, "수정중", "warning"],
        [true, false, false, true, "수정중", "warning"],
        [true, false, true, false, "수정중", "warning"],
        [true, false, true, true, "수정중", "warning"],
        [true, true, false, false, "수정중", "warning"],
        [true, true, false, true, "수정중", "warning"],
        [true, true, true, false, "수정중", "warning"],
        [true, true, true, true, "수정중", "warning"],
    ] as const)("pending=%s adminEdited=%s done=%s adminEditing=%s", (pending, adminEdited, done, adminEditing, label, tone) => {
        expect(getAdminSessionStatus({ pending, adminEdited, done, adminEditing })).toEqual({ label, tone });
    });
});
