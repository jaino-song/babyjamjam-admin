import { AIChatService } from "../ai-chat.service";
import { ChatSessionEntity } from "domain/entities/chat-session.entity";
import type { GeminiStreamChunk } from "infrastructure/api/gemini-chat.gateway";
import { allTools, CUD_TOOLS } from "application/ai-chat/tools";

const MANAGER = { globalRole: "user", branchRole: "manager" };
const NOT_CHANGED = "아직 변경된 내용이 없어요";

function createService(chunks: GeminiStreamChunk[]) {
    const gateway = {
        chatStream: jest.fn().mockImplementation(async function* () {
            yield* chunks;
        }),
    };
    const executor = { execute: jest.fn().mockResolvedValue({ success: true, data: [] }) };
    const session = Object.assign(ChatSessionEntity.create("user-1", "branch-1"), { id: "session-1" });
    const repository = {
        findById: jest.fn().mockResolvedValue(session),
        create: jest.fn().mockResolvedValue(session),
        update: jest.fn().mockResolvedValue(session),
    };
    const service = new AIChatService(gateway as never, executor as never, repository as never);
    return { service, gateway, executor, session };
}

async function collect(stream: ReturnType<AIChatService["chatStream"]>) {
    const events = [];
    for await (const event of stream) events.push(event);
    return events;
}

function chunkText(events: Awaited<ReturnType<typeof collect>>) {
    return events.filter(event => event.type === "chunk").map(event => event.content).join("");
}

describe("legacy chat truthful model output and offered tools", () => {
    it.each(["수정되었습니다", "변경됐어요", "정정 완료", "등록되었습니다", "삭제됐습니다", "저장 완료", "반영이 완료되었습니다"])(
        "replaces a model-only write claim (%s) before any text is streamed or stored",
        async claim => {
            const neutralSentence = "산모님 정보 확인했습니다. ";
            const prefix = neutralSentence.repeat(20);
            // Exceed the redactor's 192-character holdback so resumed live
            // yielding would leak neutral text before the claim is checked.
            expect(prefix.length).toBeGreaterThan(250);
            const text = `${prefix}제공기록지가 ${claim}.`;
            const { service, session } = createService([
                { type: "text", content: text.slice(0, 250) },
                { type: "text", content: text.slice(250) },
                { type: "done" },
            ]);
            const events = await collect(service.chatStream(undefined, "user-1", "제공기록지 정정해줘", "branch-1", undefined, undefined, MANAGER));
            const output = chunkText(events);
            expect(output).toContain(NOT_CHANGED);
            expect(output).toContain("에이전트 채팅");
            expect(output).toContain("제공기록지 편집");
            expect(output).not.toContain(text);
            expect(output).not.toContain(neutralSentence);
            expect(events.filter(event => event.type === "chunk")).toHaveLength(1);
            expect(session.messages.filter(message => message.role === "assistant").map(message => message.content)).toEqual([output]);
            expect(session.messages.find(message => message.role === "user")?.content).toBe("제공기록지 정정해줘");
        },
    );

    it("uses the user request to guide a service-record correction when the model omits the subject", async () => {
        const { service } = createService([{ type: "text", content: "수정되었습니다." }, { type: "done" }]);
        const events = await collect(service.chatStream(undefined, "user-1", "제공 기록지 회차 날짜 변경해줘", "branch-1"));
        expect(chunkText(events)).toContain("제공기록지 편집");
    });

    it.each(["검색 완료", "등록된 산모 검색 완료", "정보 수정은 아직 완료되지 않았어요."])("preserves read/noncompletion text: %s", async text => {
        const { service, session } = createService([{ type: "text", content: text }, { type: "done" }]);
        const events = await collect(service.chatStream(undefined, "user-1", "산모 검색", "branch-1"));
        expect(chunkText(events)).toBe(text);
        expect(session.messages.at(-1)?.content).toBe(text);
    });

    it("normalizes the final model answer after a successful read tool", async () => {
        const { service, gateway, executor } = createService([]);
        gateway.chatStream
            .mockImplementationOnce(async function* () {
                yield { type: "function_call", functionCall: { name: "searchClients", args: { query: "김" } } };
            })
            .mockImplementationOnce(async function* () {
                yield { type: "text", content: "산모 정보가 수정되었습니다." };
                yield { type: "done" };
            });
        const events = await collect(service.chatStream(undefined, "user-1", "산모 수정", "branch-1", undefined, undefined, MANAGER));
        expect(executor.execute).toHaveBeenCalledTimes(1);
        expect(chunkText(events)).toContain(NOT_CHANGED);
    });

    it("buffers even when the provider ends without a done chunk", async () => {
        const { service } = createService([{ type: "text", content: "정보 저장 완료" }]);
        expect(chunkText(await collect(service.chatStream(undefined, "user-1", "저장해줘", "branch-1")))).toContain(NOT_CHANGED);
    });

    it("preserves confirmed write results passed to persistMessages", async () => {
        const { service, session } = createService([]);
        await service.persistMessages(session.id, "user-1", "산모 정보 수정", "산모 정보가 수정되었습니다", "branch-1");
        expect(session.messages.at(-1)?.content).toBe("산모 정보가 수정되었습니다");
    });

    it.each([
        { globalRole: "user", branchRole: "user" },
        { globalRole: "user", branchRole: "unknown" },
        { globalRole: "admin", branchRole: undefined },
        undefined,
    ])("offers no mutation tools to a nonmanager/missing actor %o", async actor => {
        const { service, gateway } = createService([{ type: "text", content: "검색 완료" }, { type: "done" }]);
        await collect(service.chatStream(undefined, "user-1", "산모 검색", "branch-1", undefined, undefined, actor));
        const tools = gateway.chatStream.mock.calls[0]?.[1] as typeof allTools;
        expect(tools.map(tool => tool.name)).toContain("searchClients");
        expect(tools.filter(tool => (CUD_TOOLS as readonly string[]).includes(tool.name))).toEqual([]);
        expect(allTools.filter(tool => (CUD_TOOLS as readonly string[]).includes(tool.name))).toHaveLength(CUD_TOOLS.length);
    });

    it.each([MANAGER, { globalRole: "owner", branchRole: "owner" }, { globalRole: "user", branchRole: "admin" }])("keeps mutation tools offered to verified managers/owners %o", async actor => {
        const { service, gateway, executor } = createService([
            { type: "function_call", functionCall: { name: "searchClients", args: { query: "김" } } },
        ]);
        gateway.chatStream.mockImplementationOnce(async function* () {
            yield { type: "function_call", functionCall: { name: "searchClients", args: { query: "김" } } };
        }).mockImplementation(async function* () { yield { type: "done" }; });
        await collect(service.chatStream(undefined, "user-1", "산모 검색", "branch-1", undefined, undefined, actor));
        expect((gateway.chatStream.mock.calls[0]?.[1] as typeof allTools).map(tool => tool.name)).toEqual(allTools.map(tool => tool.name));
        expect(executor.execute).toHaveBeenCalledWith(expect.objectContaining(actor), "searchClients", { query: "김" }, undefined);
    });

    it("rejects an invented createClient call that was not offered to a user", async () => {
        const { service, executor } = createService([
            { type: "function_call", functionCall: { name: "createClient", args: { name: "김산모", primaryEmployeeId: 1, careCenter: false, voucherClient: true } } },
        ]);
        executor.execute.mockResolvedValue({ success: true, requiresConfirmation: true } as never);
        const events = await collect(service.chatStream(undefined, "user-1", "산모 등록", "branch-1", undefined, undefined, { globalRole: "user", branchRole: "user" }));
        expect(executor.execute).not.toHaveBeenCalled();
        expect(events.some(event => event.type === "confirmation")).toBe(false);
        expect(events.some(event => event.type === "error")).toBe(true);
    });

    it("discards model preamble before returning the server confirmation message unchanged", async () => {
        const { service, executor, session } = createService([
            { type: "text", content: "산모 정보가 수정되었습니다." },
            { type: "function_call", functionCall: { name: "updateClient", args: { clientId: 7, phone: "01012345678" } } },
        ]);
        executor.execute.mockResolvedValue({ success: true, requiresConfirmation: true, confirmationMessage: "전화번호를 변경할까요?" } as never);
        const events = await collect(service.chatStream(undefined, "user-1", "전화번호 수정", "branch-1", undefined, undefined, MANAGER));
        expect(chunkText(events)).toBe("");
        expect(events.find(event => event.type === "confirmation")?.confirmationMessage).toBe("전화번호를 변경할까요?");
        expect(session.messages.at(-1)?.content).toBe("전화번호를 변경할까요?");
    });
});
