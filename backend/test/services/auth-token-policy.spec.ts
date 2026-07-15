import {
    AUTH_TOKEN_EXPIRES_IN_BY_ROLE,
    AUTH_TOKEN_MAX_AGE_MS_BY_ROLE,
    getAuthTokenExpiresIn,
    getAuthTokenMaxAgeMs,
} from "application/services/auth-token-policy";

const DAY_IN_MS = 24 * 60 * 60 * 1000;

describe("auth-token-policy", () => {
    // ============================================
    // Policy tables (the source of truth)
    // ============================================
    describe("policy tables", () => {
        it("should grant owner the longest expiry (30d) — the most privileged session", () => {
            expect(AUTH_TOKEN_EXPIRES_IN_BY_ROLE.owner).toBe("30d");
            expect(AUTH_TOKEN_MAX_AGE_MS_BY_ROLE.owner).toBe(30 * DAY_IN_MS);
        });

        it("should grant admin and manager an identical 7d expiry", () => {
            expect(AUTH_TOKEN_EXPIRES_IN_BY_ROLE.admin).toBe("7d");
            expect(AUTH_TOKEN_EXPIRES_IN_BY_ROLE.manager).toBe("7d");
            expect(AUTH_TOKEN_MAX_AGE_MS_BY_ROLE.admin).toBe(7 * DAY_IN_MS);
            expect(AUTH_TOKEN_MAX_AGE_MS_BY_ROLE.manager).toBe(7 * DAY_IN_MS);
        });

        it("should grant the shortest 3d expiry as the default fallback", () => {
            expect(AUTH_TOKEN_EXPIRES_IN_BY_ROLE.default).toBe("3d");
            expect(AUTH_TOKEN_MAX_AGE_MS_BY_ROLE.default).toBe(3 * DAY_IN_MS);
        });

        it("should keep the string and millisecond tables internally consistent per role", () => {
            // expiresIn (jwt string) and maxAge (cookie ms) must describe the same lifetime,
            // otherwise the JWT and the cookie carrying it would diverge.
            const stringToDays: Record<string, number> = { "30d": 30, "7d": 7, "3d": 3 };
            for (const role of ["owner", "admin", "manager", "default"] as const) {
                const days = stringToDays[AUTH_TOKEN_EXPIRES_IN_BY_ROLE[role]] ?? 0;
                expect(days).toBeGreaterThan(0);
                expect(AUTH_TOKEN_MAX_AGE_MS_BY_ROLE[role]).toBe(days * DAY_IN_MS);
            }
        });
    });

    // ============================================
    // getAuthTokenExpiresIn — JWT lifetime string
    // ============================================
    describe("getAuthTokenExpiresIn", () => {
        describe("recognized roles (happy path)", () => {
            it("should return 30d for owner", () => {
                expect(getAuthTokenExpiresIn("owner")).toBe("30d");
            });

            it("should return 7d for admin", () => {
                expect(getAuthTokenExpiresIn("admin")).toBe("7d");
            });

            it("should return 7d for manager", () => {
                expect(getAuthTokenExpiresIn("manager")).toBe("7d");
            });
        });

        describe("rejection / fallback paths", () => {
            it("should fall back to the shortest 3d for a null role", () => {
                expect(getAuthTokenExpiresIn(null)).toBe("3d");
            });

            it("should fall back to the shortest 3d for an undefined role", () => {
                expect(getAuthTokenExpiresIn(undefined)).toBe("3d");
            });

            it("should fall back to the shortest 3d for an empty-string role", () => {
                expect(getAuthTokenExpiresIn("")).toBe("3d");
            });

            it("should fall back to the shortest 3d for an unknown role (no privilege escalation)", () => {
                expect(getAuthTokenExpiresIn("superuser")).toBe("3d");
                expect(getAuthTokenExpiresIn("root")).toBe("3d");
            });

            it("should be case-sensitive: a differently-cased owner must NOT receive the 30d privilege", () => {
                // Security-relevant: matching is exact. An attacker-controlled or mis-stored
                // 'Owner'/'OWNER' must not be treated as the privileged owner role.
                expect(getAuthTokenExpiresIn("Owner")).toBe("3d");
                expect(getAuthTokenExpiresIn("OWNER")).toBe("3d");
                expect(getAuthTokenExpiresIn("Admin")).toBe("3d");
            });

            it("should not be fooled by whitespace-padded role strings", () => {
                expect(getAuthTokenExpiresIn(" owner")).toBe("3d");
                expect(getAuthTokenExpiresIn("owner ")).toBe("3d");
            });

            it("should never grant more than the default for any unrecognized input", () => {
                const unrecognized = ["", "guest", "user", "0", "owner\n", "admin;owner"];
                for (const role of unrecognized) {
                    expect(getAuthTokenExpiresIn(role)).toBe(AUTH_TOKEN_EXPIRES_IN_BY_ROLE.default);
                }
            });
        });
    });

    // ============================================
    // getAuthTokenMaxAgeMs — cookie max-age
    // ============================================
    describe("getAuthTokenMaxAgeMs", () => {
        describe("recognized roles (happy path)", () => {
            it("should return 30 days in ms for owner", () => {
                expect(getAuthTokenMaxAgeMs("owner")).toBe(30 * DAY_IN_MS);
            });

            it("should return 7 days in ms for admin", () => {
                expect(getAuthTokenMaxAgeMs("admin")).toBe(7 * DAY_IN_MS);
            });

            it("should return 7 days in ms for manager", () => {
                expect(getAuthTokenMaxAgeMs("manager")).toBe(7 * DAY_IN_MS);
            });
        });

        describe("rejection / fallback paths", () => {
            it("should fall back to the shortest 3 days in ms for a null role", () => {
                expect(getAuthTokenMaxAgeMs(null)).toBe(3 * DAY_IN_MS);
            });

            it("should fall back to the shortest 3 days in ms for an undefined role", () => {
                expect(getAuthTokenMaxAgeMs(undefined)).toBe(3 * DAY_IN_MS);
            });

            it("should fall back to the shortest 3 days in ms for an empty-string role", () => {
                expect(getAuthTokenMaxAgeMs("")).toBe(3 * DAY_IN_MS);
            });

            it("should fall back to the shortest 3 days in ms for an unknown role (no privilege escalation)", () => {
                expect(getAuthTokenMaxAgeMs("superuser")).toBe(3 * DAY_IN_MS);
                expect(getAuthTokenMaxAgeMs("root")).toBe(3 * DAY_IN_MS);
            });

            it("should be case-sensitive: a differently-cased owner must NOT receive the 30-day cookie", () => {
                expect(getAuthTokenMaxAgeMs("Owner")).toBe(3 * DAY_IN_MS);
                expect(getAuthTokenMaxAgeMs("OWNER")).toBe(3 * DAY_IN_MS);
                expect(getAuthTokenMaxAgeMs("Manager")).toBe(3 * DAY_IN_MS);
            });

            it("should never grant a longer max-age than the default for any unrecognized input", () => {
                const unrecognized = ["", "guest", "user", "0", " owner", "admin "];
                for (const role of unrecognized) {
                    expect(getAuthTokenMaxAgeMs(role)).toBe(AUTH_TOKEN_MAX_AGE_MS_BY_ROLE.default);
                }
            });

            it("should always return a positive finite number of milliseconds", () => {
                for (const role of ["owner", "admin", "manager", "default", "unknown", null, undefined]) {
                    const ms = getAuthTokenMaxAgeMs(role as string | null | undefined);
                    expect(Number.isFinite(ms)).toBe(true);
                    expect(ms).toBeGreaterThan(0);
                }
            });
        });
    });

    // ============================================
    // Cross-function invariant
    // ============================================
    describe("expiresIn / maxAge agreement", () => {
        it("should yield the same lifetime from both accessors for every role class", () => {
            const stringToMs: Record<string, number> = {
                "30d": 30 * DAY_IN_MS,
                "7d": 7 * DAY_IN_MS,
                "3d": 3 * DAY_IN_MS,
            };
            for (const role of ["owner", "admin", "manager", "default", "stranger", null, undefined]) {
                const r = role as string | null | undefined;
                const expectedMs = stringToMs[getAuthTokenExpiresIn(r)] ?? 0;
                expect(expectedMs).toBeGreaterThan(0);
                expect(getAuthTokenMaxAgeMs(r)).toBe(expectedMs);
            }
        });
    });
});
