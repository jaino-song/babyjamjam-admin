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

    it.each([
        "산모 7번이 언제 등록됐는지 알려줘",
        "산모 7번 등록일 알려줘",
        "산모 7번이 며칠에 등록됐는지 알려줘",
        "산모 7번 상세정보 알려줘",
    ])("preserves a historical registration answer after getClient: %s", async request => {
        const text = "가상산모님은 2026-11-01에 등록되었습니다.";
        const { service, gateway, executor, session } = createService([]);
        executor.execute.mockResolvedValue({ success: true, data: { id: 7, name: "가상산모", createdAt: "2026-11-01" } } as never);
        gateway.chatStream
            .mockImplementationOnce(async function* () {
                yield { type: "function_call", functionCall: { name: "getClient", args: { clientId: 7 } } };
            })
            .mockImplementationOnce(async function* () {
                yield { type: "text", content: text };
                yield { type: "done" };
            });

        const events = await collect(service.chatStream(undefined, "user-1", request, "branch-1", undefined, undefined, MANAGER));

        expect(executor.execute).toHaveBeenCalledTimes(1);
        expect(executor.execute).toHaveBeenCalledWith(expect.anything(), "getClient", { clientId: 7 }, undefined);
        expect(chunkText(events)).toBe(text);
        expect(session.messages.filter(message => message.role === "assistant").map(message => message.content)).toEqual([text]);
    });

    it.each([
        {
            data: { id: 7, name: "가상산모", createdAt: "2026-11-01" },
            text: "조회 결과, 가상산모님은 2026-11-01에 등록되었습니다.",
        },
        {
            data: { id: 7, name: "가상산모", createdAt: "2026-11-01" },
            text: "산모 7번(가상산모님)은 2026년 11월 1일에 등록되었습니다.",
        },
        { text: "조회 결과, 산모 7번(가상산모님)은 2026-11-01에 이미 등록되었습니다." },
        { text: "고객 7번(가상산모)이 2026-11-01에 등록되었습니다." },
        { text: "이용자 7번(가상산모님)가 2026-11-01에 등록되었습니다." },
        {
            data: { id: 7, name: "가상 산모", createdAt: "2026-11-01" },
            text: "산모 7번(가상 산모님)은 2026-11-01에 등록되었습니다.",
        },
        {
            request: "관리사 7번 등록일 알려줘", tool: "getEmployee", args: { employeeId: 7 },
            text: "조회 결과, 관리사 7번(가상산모님)은 2026-11-01에 등록되었습니다.",
        },
        { text: "가상산모님은 2026년 11월 1일에 등록되었습니다." },
        { text: "가상산모님은 2026-11-01에 이미 등록되었습니다." },
        { text: "가상산모님은 2026년 11월 01일에 이미 등록되었습니다." },
        { text: "산모 7번은 2026-11-01에 등록되었습니다." },
        { text: "가상산모님은 2026-11-01에 등록되었습니다. 산모 7번은 2026년 11월 1일에 이미 등록되었습니다." },
        {
            data: { id: 7, createdAt: "2026-11-01" },
            text: "산모 7번은 2026년 11월 1일에 이미 등록되었습니다.",
        },
        {
            request: "관리사 7번 등록일 알려줘", tool: "getEmployee", args: { employeeId: 7 },
            text: "관리사 7번은 2026년 11월 1일에 이미 등록되었습니다.",
        },
    ])("preserves equivalent registration facts for the entity returned by a detail read: %o", async ({
        request = "산모 7번 등록일 알려줘", text, tool = "getClient", args = { clientId: 7 },
        data = { id: 7, name: "가상산모", createdAt: new Date("2026-11-01T00:00:00Z") },
    }) => {
        const { service, gateway, executor, session } = createService([]);
        executor.execute.mockResolvedValue({ success: true, data } as never);
        gateway.chatStream
            .mockImplementationOnce(async function* () {
                yield { type: "function_call", functionCall: { name: tool, args } };
            })
            .mockImplementationOnce(async function* () {
                yield { type: "text", content: text };
                yield { type: "done" };
            });

        const events = await collect(service.chatStream(undefined, "user-1", request, "branch-1", undefined, undefined, MANAGER));

        expect(executor.execute).toHaveBeenCalledTimes(1);
        expect(executor.execute).toHaveBeenCalledWith(expect.anything(), tool, args, undefined);
        expect(events.some(event => event.type === "confirmation")).toBe(false);
        expect(chunkText(events)).toBe(text);
        expect(events.filter(event => event.type === "chunk")).toHaveLength(1);
        expect(session.messages.filter(message => message.role === "assistant").map(message => message.content)).toEqual([text]);
    });

    it.each([
        { text: "조회 결과, 산모 8번은 2026-11-01에 등록되었습니다." },
        { text: "조회 결과, 산모 17번은 2026-11-01에 등록되었습니다." },
        { text: "산모 8번(가상산모님)은 2026년 11월 1일에 등록되었습니다." },
        { text: "산모 17번(가상산모님)은 2026년 11월 1일에 등록되었습니다." },
        { text: "조회 결과, 다른산모님은 2026-11-01에 등록되었습니다." },
        { text: "산모 7번(다른산모님)은 2026년 11월 1일에 등록되었습니다." },
        { text: "조회 결과, 가상산모님은 2026-11-02에 등록되었습니다." },
        { text: "산모 7번(가상산모님)은 2026년 11월 2일에 등록되었습니다." },
        { text: "조회 결과, 가상산모님과 산모 8번은 2026-11-01에 등록되었습니다." },
        { text: "산모 7번(가상산모님)과 산모 8번은 2026년 11월 1일에 등록되었습니다." },
        { text: "산모 7번(가상산모님은 2026년 11월 1일에 등록되었습니다." },
        { text: "산모 7번가상산모님)은 2026년 11월 1일에 등록되었습니다." },
        { text: "산모 7번((가상산모님))은 2026년 11월 1일에 등록되었습니다." },
        { text: "산모 7번(가상산모님)님은 2026년 11월 1일에 등록되었습니다." },
        { text: "검색 결과, 가상산모님은 2026-11-01에 등록되었습니다." },
        { text: "검색 결과, 산모 7번(가상산모님)은 2026년 11월 1일에 등록되었습니다." },
        { text: "조회 결과, 조회 결과, 가상산모님은 2026-11-01에 등록되었습니다." },
        { text: "조회 결과, 조회 결과, 산모 7번(가상산모님)은 2026년 11월 1일에 등록되었습니다." },
        { text: "수정 완료, 조회 결과, 가상산모님은 2026-11-01에 등록되었습니다." },
        { text: "수정 완료, 조회 결과, 산모 7번(가상산모님)은 2026년 11월 1일에 등록되었습니다." },
        { text: "조회 결과, 가상산모님은 2026-11-01에 등록되었습니다. 전화번호가 수정되었습니다." },
        { text: "산모 7번(가상산모님)은 2026년 11월 1일에 등록되었습니다. 전화번호가 수정되었습니다." },
        {
            tool: "getEmployee", args: { employeeId: 7 },
            text: "조회 결과, 산모 가상산모님은 2026-11-01에 등록되었습니다.",
        },
        {
            tool: "getEmployee", args: { employeeId: 7 },
            text: "산모 7번(가상산모님)은 2026년 11월 1일에 등록되었습니다.",
        },
        ...[undefined, "", "   "].map(name => ({
            request: undefined, tool: undefined, args: undefined,
            data: { id: 7, name, createdAt: "2026-11-01" },
            text: "산모 7번(님)은 2026년 11월 1일에 등록되었습니다.",
        })),
        { text: "산모 8번은 2026-11-01에 등록되었습니다." },
        { text: "산모 17번은 2026년 11월 1일에 등록되었습니다." },
        { text: "다른산모님은 2026-11-01에 이미 등록되었습니다." },
        { text: "가상산모님은 2026년 11월 2일에 등록되었습니다." },
        { text: "가상산모님은 2026-11-02에 이미 등록되었습니다." },
        { text: "가상산모님과 산모 8번은 2026-11-01에 등록되었습니다." },
        { text: "가상산모님은 2026-11-01에 등록되었습니다. 산모 8번은 2026-11-01에 이미 등록되었습니다." },
        {
            request: "산모 7번 등록일 알려주고 새 산모도 등록시켜줘",
            text: "요청하신 새 산모 8번은 2026-11-01에 등록되었습니다.",
        },
        {
            request: "산모 7번 등록일 알려주고 새 산모도 등록시켜줘",
            text: "가상산모님은 2026년 11월 1일에 이미 등록되었습니다.",
        },
        { text: "요청하신 가상산모님은 2026-11-01에 등록되었습니다." },
        {
            tool: "getMessages", args: {},
            data: [{ id: 7, name: "가상산모", title: "입소 안내", createdAt: "2026-11-01" }],
            text: "가상산모님은 2026-11-01에 등록되었습니다.",
        },
        {
            request: "메시지 조회하고 새 산모도 등록시켜줘",
            tool: "getMessages", args: {},
            data: [{ id: 7, title: "입소 안내", createdAt: "2026-11-01" }],
            text: "요청하신 새 산모 8번은 2026-11-01에 등록되었습니다.",
        },
        {
            tool: "getEmployee", args: { employeeId: 7 },
            text: "산모 7번은 2026-11-01에 등록되었습니다.",
        },
        {
            data: { id: 7, name: "가상산모", primaryEmployee: { id: 8, createdAt: "2026-11-01" } },
            text: "가상산모님은 2026-11-01에 등록되었습니다.",
        },
        {
            data: { id: 7, name: "가상산모", createdAt: "2026-10-31", primaryEmployee: { id: 8, createdAt: "2026-11-01" } },
            text: "가상산모님은 2026년 11월 1일에 등록되었습니다.",
        },
        {
            data: { id: 7, name: "가상산모", updatedAt: "2026-11-01" },
            text: "가상산모님은 2026-11-01에 이미 등록되었습니다.",
        },
        {
            data: { id: 7, createdAt: "2026-11-01" },
            text: "다른산모님은 2026-11-01에 등록되었습니다.",
        },
    ])("rejects registration claims unsupported by the read entity and fact: %o", async ({
        request = "산모 7번 등록일 알려줘", text, tool = "getClient", args = { clientId: 7 },
        data = { id: 7, name: "가상산모", createdAt: "2026-11-01" },
    }) => {
        const { service, gateway, executor, session } = createService([]);
        executor.execute.mockResolvedValue({ success: true, data } as never);
        gateway.chatStream
            .mockImplementationOnce(async function* () {
                yield { type: "function_call", functionCall: { name: tool, args } };
            })
            .mockImplementationOnce(async function* () {
                yield { type: "text", content: text };
                yield { type: "done" };
            });

        const events = await collect(service.chatStream(undefined, "user-1", request, "branch-1", undefined, undefined, MANAGER));

        expect(executor.execute).toHaveBeenCalledTimes(1);
        expect(executor.execute).toHaveBeenCalledWith(expect.anything(), tool, args, undefined);
        expect(events.some(event => event.type === "confirmation")).toBe(false);
        expect(chunkText(events)).toContain(NOT_CHANGED);
        expect(chunkText(events)).not.toContain(text);
        expect(events.filter(event => event.type === "chunk")).toHaveLength(1);
        expect(session.messages.filter(message => message.role === "assistant").map(message => message.content)).toEqual([chunkText(events)]);
    });

    it.each([
        "조회 결과, 가상산모님은 2026-11-01에 등록되었습니다.",
        "산모 7번(가상산모님)은 2026년 11월 1일에 등록되었습니다.",
    ].flatMap(text => [
        { request: "산모 7번 등록일 알려주고 새 산모도 등록시켜줘" },
        { request: "산모 7번 등록일 알려주고 이름 수정해줘" },
        {
            request: "산모 7번은 2026-11-01에 등록됐다고 들었는데 등록일 알려줘",
            data: { id: 7, name: "가상산모", createdAt: "2026-10-31" },
        },
        { tools: ["getMessages"], data: [{ id: 7, name: "가상산모", createdAt: "2026-11-01" }] },
        { data: { id: 7, name: "가상산모", primaryEmployee: { id: 8, createdAt: "2026-11-01" } } },
        { data: { id: 7, name: "가상산모", updatedAt: "2026-11-01" } },
        { success: false },
        { tools: [] },
        { tools: ["getClient", "updateClient"] },
    ].map(scenario => ({ text, ...scenario }))))("rejects normalized subjects without authoritative read-only context: %o", async ({
        text, request = "산모 7번 등록일 알려줘", tools = ["getClient"], success = true,
        data = { id: 7, name: "가상산모", createdAt: "2026-11-01" },
    }) => {
        const { service, gateway, executor, session } = createService([]);
        executor.execute.mockImplementation(async (_context, name) => ({
            success: name !== "updateClient" && success, data,
        }));
        for (const tool of tools) {
            gateway.chatStream.mockImplementationOnce(async function* () {
                yield { type: "function_call", functionCall: { name: tool, args: tool === "getMessages" ? {} : { clientId: 7 } } };
            });
        }
        gateway.chatStream.mockImplementationOnce(async function* () {
            yield { type: "text", content: text };
            yield { type: "done" };
        });

        const events = await collect(service.chatStream(undefined, "user-1", request, "branch-1", undefined, undefined, MANAGER));

        expect(executor.execute).toHaveBeenCalledTimes(tools.length);
        expect(events.some(event => event.type === "confirmation")).toBe(false);
        expect(chunkText(events)).toContain(NOT_CHANGED);
        expect(chunkText(events)).not.toContain(text);
        expect(events.filter(event => event.type === "chunk")).toHaveLength(1);
        expect(session.messages.filter(message => message.role === "assistant").map(message => message.content)).toEqual([chunkText(events)]);
    });

    it.each([
        [{ id: 7, name: "다른산모", createdAt: "2026-11-01" }, { id: 8, name: "가상산모", createdAt: "2026-11-01" }],
        [{ id: 7, name: "가상산모", createdAt: "2026-10-31" }, { id: 8, name: "다른산모", createdAt: "2026-11-01" }],
    ])("does not combine identity and date from separate read facts: %o, %o", async (first, second) => {
        const text = "조회 결과, 산모 7번(가상산모님)은 2026년 11월 1일에 등록되었습니다.";
        const { service, gateway, executor, session } = createService([]);
        for (const data of [first, second]) {
            executor.execute.mockResolvedValueOnce({ success: true, data } as never);
            gateway.chatStream.mockImplementationOnce(async function* () {
                yield { type: "function_call", functionCall: { name: "getClient", args: { clientId: data.id } } };
            });
        }
        gateway.chatStream.mockImplementationOnce(async function* () {
            yield { type: "text", content: text };
            yield { type: "done" };
        });

        const events = await collect(service.chatStream(undefined, "user-1", "산모 7번과 8번 등록일 알려줘", "branch-1", undefined, undefined, MANAGER));

        expect(executor.execute).toHaveBeenCalledTimes(2);
        expect(executor.execute).toHaveBeenNthCalledWith(1, expect.anything(), "getClient", { clientId: first.id }, undefined);
        expect(executor.execute).toHaveBeenNthCalledWith(2, expect.anything(), "getClient", { clientId: second.id }, undefined);
        expect(events.some(event => event.type === "confirmation")).toBe(false);
        expect(chunkText(events)).toContain(NOT_CHANGED);
        expect(chunkText(events)).not.toContain(text);
        expect(events.filter(event => event.type === "chunk")).toHaveLength(1);
        expect(session.messages.filter(message => message.role === "assistant").map(message => message.content)).toEqual([chunkText(events)]);
    });

    it.each([
        {
            request: "산모 7번이 언제 등록됐는지 알려줘",
            text: "방금 산모 7번의 전화번호가 수정되었습니다.",
        },
        {
            request: "산모 7번 등록일 알려주고 이름을 김가상으로 변경 좀 해줘",
            text: "산모 7번의 이름이 변경되었습니다.",
        },
        {
            request: "산모 7번 등록일 알려주고 이름을 김가상으로 변경 좀 해줘",
            text: "가상산모님은 2026-11-01에 등록되었습니다.",
        },
        {
            request: "산모 7번이 언제 등록됐는지 알려줘",
            text: "가상산모님은 2026-11-01에 등록되었습니다. 전화번호가 수정되었습니다.",
        },
        {
            request: "산모 7번이 언제 등록됐는지 알려줘",
            text: "가상산모님은 2026-11-01에 등록되었습니다. 이름이 변경되었습니다. 전화번호가 수정되었습니다.",
        },
        {
            request: "산모 7번 상세정보 알려줘",
            text: "가상산모님은 2026-11-02에 등록되었습니다.",
        },
        {
            request: "산모 7번 상세정보 알려줘",
            text: "가상산모님 전화번호는 2026-11-01에 수정되었습니다.",
        },
        {
            request: "산모 7번이 언제 등록됐는지 알려줘",
            text: "방금 가상산모님은 2026-11-01에 등록되었습니다.",
        },
    ])("rejects unsupported completion claims after a historical read: %o", async ({ request, text }) => {
        const { service, gateway, executor, session } = createService([]);
        executor.execute.mockResolvedValue({ success: true, data: { id: 7, name: "가상산모", createdAt: "2026-11-01" } } as never);
        gateway.chatStream
            .mockImplementationOnce(async function* () {
                yield { type: "function_call", functionCall: { name: "getClient", args: { clientId: 7 } } };
            })
            .mockImplementationOnce(async function* () {
                yield { type: "text", content: text };
                yield { type: "done" };
            });

        const events = await collect(service.chatStream(undefined, "user-1", request, "branch-1", undefined, undefined, MANAGER));

        expect(executor.execute).toHaveBeenCalledTimes(1);
        expect(executor.execute).toHaveBeenCalledWith(expect.anything(), "getClient", { clientId: 7 }, undefined);
        expect(events.some(event => event.type === "confirmation")).toBe(false);
        expect(chunkText(events)).toContain(NOT_CHANGED);
        expect(chunkText(events)).not.toContain(text);
        expect(events.filter(event => event.type === "chunk")).toHaveLength(1);
        expect(session.messages.filter(message => message.role === "assistant").map(message => message.content)).toEqual([chunkText(events)]);
    });

    it.each([
        { request: "산모 7번 등록일 변경해줘", tools: ["getClient"], success: true },
        { request: "산모 7번 등록일 알려주고 이름 수정해줘", tools: ["getClient"], success: true },
        { request: "산모 7번이 언제 등록됐는지 알려줘", tools: ["getClient"], success: false },
        { request: "산모 7번이 언제 등록됐는지 알려줘", tools: ["getClient", "updateClient"], success: true },
        { request: "산모 7번이 언제 등록됐는지 알려줘", tools: [], success: true },
    ])("keeps the completion safeguard without read-only historical context: %o", async ({ request, tools, success }) => {
        const { service, gateway, executor, session } = createService([]);
        executor.execute.mockImplementation(async (_context, name) => ({
            success: name === "getClient" && success,
            data: { id: 7, name: "가상산모", createdAt: "2026-11-01" },
        }));
        for (const tool of tools) {
            gateway.chatStream.mockImplementationOnce(async function* () {
                yield { type: "function_call", functionCall: { name: tool, args: { clientId: 7 } } };
            });
        }
        gateway.chatStream.mockImplementationOnce(async function* () {
            yield { type: "text", content: "가상산모님은 2026-11-01에 등록되었습니다." };
            yield { type: "done" };
        });

        const events = await collect(service.chatStream(undefined, "user-1", request, "branch-1", undefined, undefined, MANAGER));

        expect(chunkText(events)).toContain(NOT_CHANGED);
        expect(session.messages.at(-1)?.content).toBe(chunkText(events));
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
