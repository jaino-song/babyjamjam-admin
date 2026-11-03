import { readFileSync } from "fs";
import { join } from "path";
import { clientTools } from "application/ai-chat/tools/client.tools";

describe("AI chat intent mapping contracts", () => {
    test("SYSTEM_PROMPT uses 제공인력 in replies and preserves user synonyms", () => {
        const source = readFileSync(join(__dirname, "../../services/ai-chat.service.ts"), "utf8");
        expect(source).toContain('사용자는 제공인력을 "직원" 또는 "관리사"라고도 부를 수 있습니다. 답변에서는 "제공인력"으로 표현합니다.');
    });

    test("SYSTEM_PROMPT includes mapping for 발송 후 대기 -> incomplete-contracts", () => {
        // NOTE: We can't deterministically test LLM tool selection.
        // We test the prompt contract by inspecting the source file for the mapping examples.
        const source = readFileSync(join(__dirname, "../../services/ai-chat.service.ts"), "utf8");
        expect(source).toContain("발송 후 대기");
        expect(source).toContain("incomplete-contracts");
    });

    test("getClientsByFilter tool description includes 발송/서명 대기 synonyms", () => {
        const getClientsByFilter = clientTools.find((t) => t.name === "getClientsByFilter");
        expect(getClientsByFilter).toBeTruthy();
        expect(getClientsByFilter!.description).toContain("계약 미완료");
        expect(getClientsByFilter!.description).toContain("발송 후 대기");
    });
});
