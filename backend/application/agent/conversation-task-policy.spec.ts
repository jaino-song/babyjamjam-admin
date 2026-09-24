import { randomUUID } from "node:crypto";

import {
    canonicalConversationMessage,
    conversationMessageHash,
    extractExplicitUserOperations,
    isQuestionLike,
    sanitizeConversationMessage,
} from "./conversation-task-policy";

describe("conversation task intake policy", () => {
    const owner = {
        userId: randomUUID(),
        branchId: randomUUID(),
        sessionId: randomUUID(),
        messageId: "caller-message-1",
        text: "이름: 홍길동, 주소: 서울시 강남구, 전화번호: 010-1234-5678",
    };

    it("removes labelled protected values and legacy lookup labels before persistence/model conversion", () => {
        const message = sanitizeConversationMessage({
            id: owner.messageId,
            role: "user",
            parts: [
                { type: "text", text: owner.text },
                { type: "data-form-submit", data: { formId: "clients.create-session", values: { name: "홍길동", phone: "01012345678" } } },
                { type: "data-entity-choice", data: { entityType: "clients", prompt: "선택", choices: [{ id: "1", label: "홍길동" }, { id: "2", label: "김철수" }] } },
                { type: "data-task-snapshot", data: { taskId: owner.sessionId, snapshotRef: randomUUID(), kind: "clients.create", capabilityId: "clients.create", revision: 1, state: "collecting", fieldStatus: [] } },
            ],
        });
        const serialized = JSON.stringify(message);

        expect(serialized).not.toContain("홍길동");
        expect(serialized).not.toContain("01012345678");
        expect(message.parts).toEqual(expect.arrayContaining([
            { type: "data-form-submit", data: { formId: "clients.create-session" } },
            expect.objectContaining({ type: "data-task-snapshot" }),
        ]));
        expect(message.parts).not.toEqual(expect.arrayContaining([
            expect.objectContaining({ type: "data-entity-choice" }),
        ]));
    });

    it("binds canonical intake to the immutable displayed choice hint", () => {
        const hint = { taskId: owner.sessionId, choiceSetRef: randomUUID(), revision: 3 };
        const canonical = canonicalConversationMessage({ ...owner, displayedChoice: hint });
        const same = conversationMessageHash({ ...owner, displayedChoice: hint });
        const changed = conversationMessageHash({ ...owner, displayedChoice: { ...hint, revision: 4 } });

        expect(canonical.displayedChoice).toEqual(hint);
        expect(same).not.toBe(changed);
        expect(JSON.stringify(canonical)).not.toContain(owner.text);
    });

    it("captures labelled exact dates as literals and approximate dates as tentative references", () => {
        expect(extractExplicitUserOperations("startDate: 2026-03-05")).toEqual([
            { op: "set", field: "startDate", value: "2026-03-05" },
        ]);
        expect(extractExplicitUserOperations("startDate: 3월 초")).toEqual([
            { op: "mark-tentative", field: "startDate", value: "3월 초" },
        ]);
        expect(extractExplicitUserOperations("시작일: 3월 초")).toEqual([
            { op: "mark-tentative", field: "startDate", value: "3월 초" },
        ]);
        expect(extractExplicitUserOperations("홍길동이 3월 초를 원해요")).toEqual([]);
    });

    describe("isQuestionLike", () => {
        it.each([
            "남궁솔 관리사 다음 근무 가능하게 바꿔줘",
            "주소 확인하고 인천 서구 가정로 10으로 바꿔줘",
            "연락처 찾아서 010-0000-0101로 수정해 주세요",
            "근무 가능하게 해줘",
        ])("treats an imperative change request as not question-like: %s", (text) => {
            expect(isQuestionLike(text)).toBe(false);
        });

        it.each([
            "근무 가능한지 알려줘",
            "바꿀 수 있어?",
            "변경해 줄래?",
            "지금 가능해?",
            "일정 확인해줘",
            "계약서 보여줘",
        ])("still treats question-shaped text as question-like: %s", (text) => {
            expect(isQuestionLike(text)).toBe(true);
        });
    });
});
