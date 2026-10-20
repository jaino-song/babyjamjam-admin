import { getQueryClient, getQueryRetryDelay, shouldRetryQuery } from "./queryClient";

function httpError(status: number) {
    const error = new Error(`HTTP ${status}`) as Error & { response: { status: number } };
    error.response = { status };
    return error;
}

// React Query는 실패할 때마다 retry(failureCount, error)를 물어본다.
// 실제 재시도 횟수 = 그 질문에 true가 나온 횟수.
function countRetries(error: unknown): number {
    let retries = 0;
    while (shouldRetryQuery(retries, error)) {
        retries += 1;
        if (retries > 50) throw new Error("retry policy never gives up");
    }
    return retries;
}

describe("shouldRetryQuery", () => {
    it.each([500, 502, 503, 504, 408])("retries a transient %i exactly 3 times", (status) => {
        expect(countRetries(httpError(status))).toBe(3);
    });

    it("retries an error carrying no response (network drop) exactly 3 times", () => {
        expect(countRetries(new Error("Network Error"))).toBe(3);
        expect(countRetries(null)).toBe(3);
        expect(countRetries(undefined)).toBe(3);
    });

    it.each([400, 401, 403, 404, 409, 422, 429])("never retries a %i", (status) => {
        expect(countRetries(httpError(status))).toBe(0);
        expect(shouldRetryQuery(0, httpError(status))).toBe(false);
    });

    it("tolerates non-numeric statuses without throwing (treated as no status)", () => {
        expect(shouldRetryQuery(0, { response: { status: "401" } })).toBe(true);
    });
});

describe("getQueryRetryDelay", () => {
    it("backs off 1s, 2s, 4s and then stays capped at 4s", () => {
        expect([0, 1, 2, 3].map(getQueryRetryDelay)).toEqual([1000, 2000, 4000, 4000]);
        expect(getQueryRetryDelay(10)).toBe(4000);
    });
});

describe("query client defaults", () => {
    it("wires the status-aware retry policy and delay into the effective QueryClient", () => {
        const queries = getQueryClient().getDefaultOptions().queries;
        const retry = queries?.retry;

        expect(retry).toBe(shouldRetryQuery);
        expect(queries?.retryDelay).toBe(getQueryRetryDelay);
        if (typeof retry !== "function") {
            throw new Error("QueryClient retry policy is not a function");
        }

        expect(retry(0, httpError(401))).toBe(false);
        expect(retry(0, httpError(500))).toBe(true);
        expect(retry(2, httpError(500))).toBe(true);
        expect(retry(3, httpError(500))).toBe(false);
    });
});
