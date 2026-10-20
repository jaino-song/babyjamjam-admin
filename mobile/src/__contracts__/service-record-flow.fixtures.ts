import type { ServiceRecordContext, ServiceRecordSession } from "@babyjamjam/service-record-ui";

/**
 * Fixtures and the fetch router for the service-record page contract.
 *
 * The router answers exactly the endpoints the token page calls (page.tsx:223
 * builds `/api/service-record/${token}${path}`) and records every call so a
 * test can assert what reached the server. Any other request throws, so a new
 * network dependency cannot slip in unnoticed.
 */

// Must equal the literal in the `next/navigation` mock of the contract test.
export const TOKEN = "contract-token";
export const API_PREFIX = `/api/service-record/${TOKEN}`;

/** KST noon on the first planned service day, so "today" matches the fixtures. */
export const NOW = new Date("2026-09-21T03:00:00+09:00");

export const PLANNED_DATES = [
    { sessionIndex: 1, serviceDate: "2026-09-21" },
    { sessionIndex: 2, serviceDate: "2026-09-22" },
    { sessionIndex: 3, serviceDate: "2026-09-23" },
];

export const SAVED_HEADER = {
    momName: "이예지",
    momBirth: "1994-03-15",
    babyName: "이아기",
    babyBirth: "2026-09-10",
    deliveryType: "자연분만",
    babyWeight: "3.2",
};

export const SERVER_NAMES = { provider: "인천 아이미래로", employee: "김제공" };

export function makeSession(sessionIndex: number, overrides: Partial<ServiceRecordSession> = {}): ServiceRecordSession {
    return {
        sessionIndex,
        serviceDate: PLANNED_DATES[sessionIndex - 1]?.serviceDate ?? "2026-09-30",
        locked: false,
        ...overrides,
    };
}

export function makeContext(overrides: Partial<ServiceRecordContext> = {}): ServiceRecordContext {
    return {
        org: { name: SERVER_NAMES.provider },
        employee: { id: 7, name: SERVER_NAMES.employee },
        client: { id: 42, name: "이예지" },
        totalSessions: PLANNED_DATES.length,
        startDate: PLANNED_DATES[0].serviceDate,
        header: null,
        sessions: [],
        plannedSessionDates: PLANNED_DATES,
        recordStatus: null,
        pendingScheduleChange: null,
        ...overrides,
    };
}

/** A submitted 1회차 whose answers come from the server, not from this browser. */
export const SUBMITTED_ANSWERS = {
    perineum: ["혈종"],
    breast: ["울혈", "통증"],
    excretion: ["불편감"],
    sitzBath: "미실시",
    meals_meal: "3",
    meals_snack: "2",
    temperature_temp: "37.1",
    sleep: "잘 못 잠",
    breastFeeding_count: "4",
    formulaFeeding_count: "5",
    formulaFeeding_ml: "120",
    stool: "이상변",
    stool_color: "연두색",
    bath: "실시",
};

export function makeSubmittedFirstSession(): ServiceRecordSession {
    return makeSession(1, {
        locked: true,
        submittedAt: "2026-09-21T02:00:00.000Z",
        answers: SUBMITTED_ANSWERS,
        etcService: "옷 정리",
        notes: "산모 요청으로 간식 시간 변경",
        paymentConfirmed: true,
        clientSignature: "data:image/png;base64,SAVED",
        clientSignedAt: "2026-09-21T02:00:00.000Z",
    });
}

export interface RecordedCall {
    method: string;
    path: string;
    body: unknown;
}

export interface ApiScript {
    /** GET /link answers `{ valid }`. */
    linkValid: boolean;
    /** GET /link rejects like a dropped connection. */
    linkNetworkError: boolean;
    /** Whether the browser already holds the access cookie (GET /context answers 401 until it does). */
    verified: boolean;
    /** Whether POST /verify accepts the number. */
    verifyOk: boolean;
    /** What GET /context answers once verified. Mutated by header/submit calls like the real server. */
    context: ServiceRecordContext;
}

function respond(status: number, body: unknown) {
    return { ok: status >= 200 && status < 300, status, json: async () => body };
}

export function installApi(script: Partial<ApiScript> = {}) {
    const state: ApiScript = {
        linkValid: true,
        linkNetworkError: false,
        verified: true,
        verifyOk: true,
        context: makeContext(),
        ...script,
    };
    const calls: RecordedCall[] = [];

    const handler = async (input: RequestInfo | URL, init: RequestInit = {}) => {
        const url = String(input);
        if (!url.startsWith(`${API_PREFIX}/`) && url !== API_PREFIX) throw new Error(`unrouted fetch: ${url}`);
        const rest = url.slice(API_PREFIX.length);
        const path = rest.split("?")[0];
        const method = (init.method ?? "GET").toUpperCase();
        const body = typeof init.body === "string" ? JSON.parse(init.body) : undefined;
        calls.push({ method, path: rest, body });

        if (method === "GET" && path === "/link") {
            if (state.linkNetworkError) throw new TypeError("Failed to fetch");
            return respond(200, { valid: state.linkValid });
        }
        if (method === "GET" && path === "/context") {
            return state.verified ? respond(200, state.context) : respond(401, {});
        }
        if (method === "POST" && path === "/verify") {
            if (!state.verifyOk) return respond(200, { ok: false });
            state.verified = true;
            return respond(200, { ok: true });
        }
        if (method === "PUT" && path === "/header") {
            state.context = { ...state.context, header: body as Record<string, unknown> };
            return respond(200, { ok: true });
        }
        const submit = /^\/sessions\/(\d+)\/submit$/.exec(path);
        if (method === "POST" && submit) {
            const sessionIndex = Number(submit[1]);
            const payload = body as Record<string, unknown>;
            const submitted = makeSession(sessionIndex, {
                locked: true,
                serviceDate: String(payload.serviceDate),
                answers: payload.answers as Record<string, unknown>,
                etcService: payload.etcService as string,
                notes: payload.notes as string,
                paymentConfirmed: Boolean(payload.paymentConfirmed),
                clientSignature: payload.clientSignature as string,
            });
            state.context = {
                ...state.context,
                sessions: [...state.context.sessions.filter((row) => row.sessionIndex !== sessionIndex), submitted],
            };
            return respond(200, { ok: true });
        }
        if (method === "GET" && path === "/holidays") return respond(200, { year: 2026, holidays: [] });
        if (method === "GET" && path === "/schedule-change/preview") {
            return respond(200, { sessionIndex: 2, fromDate: "2026-09-22", toDate: "2026-09-23" });
        }
        if (method === "POST" && path === "/schedule-change") return respond(200, { ok: true });
        throw new Error(`unrouted request: ${method} ${rest}`);
    };

    const fetchMock = jest.fn(handler);
    global.fetch = fetchMock as unknown as typeof fetch;

    return {
        state,
        calls,
        fetchMock,
        /** Calls to one endpoint, in order. */
        callsTo: (method: string, path: string) => calls.filter((call) => call.method === method && call.path === path),
    };
}
