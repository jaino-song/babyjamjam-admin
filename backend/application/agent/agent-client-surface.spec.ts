import { agentPrincipalForHeaders, readAgentClientSurface } from "./agent-client-surface";

describe("agent client surface header", () => {
    it.each(["x-bjj-client", "X-BJJ-CLIENT", "X-Bjj-Client"])("matches header names case-insensitively: %s", (name) => {
        expect(readAgentClientSurface({ [name]: "mobile" })).toBe("mobile");
    });

    it.each([undefined, "", "desktop", "MOBILE", "MOBILE ", "mobile ", " mobile", ["mobile"]])(
        "requires the exact lowercase mobile value, without trimming or accepting arrays: %j", (value) => {
            expect(readAgentClientSurface(value === undefined ? {} : { "x-bjj-client": value })).toBeUndefined();
        },
    );

    it.each([{}, { "x-bjj-client": "mobile" }])("returns a copy without mutating request tenant (%j)", (headers) => {
        const tenant = Object.freeze({ userId: "u", branchId: "b", globalRole: "admin", branchRole: "admin" } as const);
        const marked = agentPrincipalForHeaders(tenant, headers);
        expect(marked).not.toBe(tenant);
        expect(marked.clientSurface).toBe(headers["x-bjj-client"] === "mobile" ? "mobile" : undefined);
        expect(tenant).not.toHaveProperty("clientSurface");
    });
});
