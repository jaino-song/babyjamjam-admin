import { generateText } from "ai";
import { CapabilityRouterService, minimizeClassifierText, type RouterDecisionContext } from "./capability-router.service";
import type { DecisionMode } from "./decision/decision-contracts";
import type { DecisionTurnContext } from "./decision/agent-decision.service";

jest.mock("ai", () => ({ generateText: jest.fn() }));

const mockedGenerateText = generateText as jest.MockedFunction<typeof generateText>;

describe("CapabilityRouterService", () => {
    beforeEach(() => mockedGenerateText.mockReset());

    function enabledFlags() {
        return {
            getSnapshot: jest.fn().mockResolvedValue({ config: {}, emergencyDisabled: false }),
            isCapabilityEnabledFromSnapshot: jest.fn().mockReturnValue(true),
        };
    }

    function ambiguousRegistry() {
        return {
            list: () => [
                { meta: { name: "clients.search", domain: "clients" } },
                { meta: { name: "employees.search", domain: "employees" } },
            ],
        };
    }

    const principal = { userId: "u", branchId: "b", globalRole: "admin", branchRole: "admin" } as const;

    it("routes Korean and English terms only to enabled capabilities", async () => {
        const registry = {
            list: () => [
                { meta: { name: "clients.search", domain: "clients" } },
                { meta: { name: "contracts.status", domain: "contracts" } },
            ],
        };
        const flags = enabledFlags();
        const router = new CapabilityRouterService(registry as never, flags as never);
        const result = await router.route("계약 상태 보여줘", {
            userId: "u", branchId: "b", globalRole: "admin", branchRole: "admin",
        });

        expect(result.domains).toEqual(["contracts"]);
        expect(result.capabilities.map((item) => item.meta.name)).toEqual(["contracts.status"]);
        expect(flags.getSnapshot).toHaveBeenCalledTimes(1);
        expect(flags.isCapabilityEnabledFromSnapshot).toHaveBeenCalledTimes(2);
    });

    it("caps the bundle", async () => {
        const capabilities = Array.from({ length: 20 }, (_, index) => ({
            meta: { name: `clients.read${index}`, domain: "clients" },
        }));
        const router = new CapabilityRouterService(
            { list: () => capabilities } as never,
            enabledFlags() as never,
        );
        await expect(router.route("client", {
            userId: "u", branchId: "b", globalRole: "admin", branchRole: "admin",
        }, 5)).resolves.toMatchObject({ capabilities: { length: 5 } });
    });

    it("uses one bounded classifier call when lexical routing is ambiguous", async () => {
        const create = jest.fn().mockReturnValue({});
        const router = new CapabilityRouterService(
            ambiguousRegistry() as never,
            enabledFlags() as never,
            { create } as never,
        );
        const previousClassifierFlag = process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
        process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = "true";
        // The deterministic provider cannot do a non-streaming classifier call,
        // so the router safely falls back to the enabled default domain.
        try {
            await expect(router.route("도와줘", {
                userId: "u", branchId: "b", globalRole: "admin", branchRole: "admin",
            })).resolves.toMatchObject({ domains: ["clients"] });
            expect(create).toHaveBeenCalledTimes(1);
        } finally {
            if (previousClassifierFlag === undefined) delete process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
            else process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = previousClassifierFlag;
        }
    });

    it("falls back to all enabled lexical matches when classifier routing is disabled", async () => {
        const create = jest.fn().mockReturnValue({});
        const router = new CapabilityRouterService(ambiguousRegistry() as never, enabledFlags() as never, { create } as never);
        const previousClassifierFlag = process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
        process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = "false";

        try {
            await expect(router.route("고객 직원", principal)).resolves.toMatchObject({ domains: ["clients", "employees"] });
        } finally {
            if (previousClassifierFlag === undefined) delete process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
            else process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = previousClassifierFlag;
        }

        expect(create).not.toHaveBeenCalled();
    });

    it("falls back to lexical matches when no classifier model is available", async () => {
        const router = new CapabilityRouterService(ambiguousRegistry() as never, enabledFlags() as never);

        await expect(router.route("고객 직원", principal)).resolves.toMatchObject({ domains: ["clients", "employees"] });
    });

    it("falls back to lexical matches when classifier generation throws", async () => {
        mockedGenerateText.mockRejectedValueOnce(new Error("classifier unavailable"));
        const router = new CapabilityRouterService(
            ambiguousRegistry() as never,
            enabledFlags() as never,
            { create: jest.fn().mockReturnValue({}) } as never,
        );
        const previousClassifierFlag = process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
        process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = "true";

        try {
            await expect(router.route("고객 직원", principal)).resolves.toMatchObject({ domains: ["clients", "employees"] });
        } finally {
            if (previousClassifierFlag === undefined) delete process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
            else process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = previousClassifierFlag;
        }
    });

    it.each([
        ["invalid JSON shape", '{"domains":"employees"}'],
        ["invalid domain values", '{"domains":["unknown", 42]}'],
        ["mixed valid and invalid domains", '{"domains":["employees","unknown"]}'],
        ["empty domain output", '{"domains":[]}'],
    ])("falls back to lexical matches for %s classifier output", async (_caseName, classifierText) => {
        mockedGenerateText.mockResolvedValueOnce({ text: classifierText } as never);
        const router = new CapabilityRouterService(
            ambiguousRegistry() as never,
            enabledFlags() as never,
            { create: jest.fn().mockReturnValue({}) } as never,
        );
        const previousClassifierFlag = process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
        process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = "true";

        try {
            await expect(router.route("고객 직원", principal)).resolves.toMatchObject({ domains: ["clients", "employees"] });
        } finally {
            if (previousClassifierFlag === undefined) delete process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
            else process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = previousClassifierFlag;
        }
    });

    it("uses a nonempty valid classifier result to narrow ambiguous lexical matches", async () => {
        mockedGenerateText.mockResolvedValueOnce({ text: '{"domains":["employees"]}' } as never);
        const router = new CapabilityRouterService(
            ambiguousRegistry() as never,
            enabledFlags() as never,
            { create: jest.fn().mockReturnValue({}) } as never,
        );
        const previousClassifierFlag = process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
        process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = "true";

        try {
            await expect(router.route("고객 직원", principal)).resolves.toMatchObject({
                domains: ["employees"],
                capabilities: [{ meta: { name: "employees.search", domain: "employees" } }],
            });
        } finally {
            if (previousClassifierFlag === undefined) delete process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
            else process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = previousClassifierFlag;
        }
    });

    it("defaults to clients only when neither lexical nor classifier routing has a result", async () => {
        const router = new CapabilityRouterService(
            { list: () => [
                { meta: { name: "clients.search", domain: "clients" } },
                { meta: { name: "employees.search", domain: "employees" } },
            ] } as never,
            enabledFlags() as never,
        );

        await expect(router.route("도와줘", principal)).resolves.toMatchObject({
            domains: ["clients"],
            capabilities: [{ meta: { name: "clients.search", domain: "clients" } }],
        });
    });

    it("filters disabled domains out of keyword matches before the single-match fast path", async () => {
        const registry = {
            list: () => [
                { meta: { name: "clients.search", domain: "clients" } },
                { meta: { name: "contracts.status", domain: "contracts" } },
            ],
        };
        const disabledContractsFlags = {
            getSnapshot: jest.fn().mockResolvedValue({ config: {}, emergencyDisabled: false }),
            isCapabilityEnabledFromSnapshot: jest.fn().mockImplementation((meta: { domain: string }) => meta.domain !== "contracts"),
        };
        const router = new CapabilityRouterService(registry as never, disabledContractsFlags as never);

        // Both keyword patterns match, but only clients is enabled, so the
        // filtered single match takes the fast path.
        await expect(router.route("계약 고객", principal)).resolves.toMatchObject({
            domains: ["clients"],
            capabilities: [{ meta: { name: "clients.search", domain: "clients" } }],
        });
        expect(disabledContractsFlags.isCapabilityEnabledFromSnapshot).toHaveBeenCalledTimes(2);
    });

    it("excludes disabled domains from the classifier prompt and treats disabled classifier output as invalid", async () => {
        mockedGenerateText.mockResolvedValueOnce({ text: '{"domains":["contracts","employees"]}' } as never);
        const registry = {
            list: () => [
                { meta: { name: "clients.search", domain: "clients" } },
                { meta: { name: "employees.search", domain: "employees" } },
                { meta: { name: "contracts.status", domain: "contracts" } },
            ],
        };
        const disabledContractsFlags = {
            getSnapshot: jest.fn().mockResolvedValue({ config: {}, emergencyDisabled: false }),
            isCapabilityEnabledFromSnapshot: jest.fn().mockImplementation((meta: { domain: string }) => meta.domain !== "contracts"),
        };
        const router = new CapabilityRouterService(
            registry as never,
            disabledContractsFlags as never,
            { create: jest.fn().mockReturnValue({}) } as never,
        );
        const previousClassifierFlag = process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
        process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = "true";

        try {
            await expect(router.route("도와줘", principal)).resolves.toMatchObject({ domains: ["clients"] });
        } finally {
            if (previousClassifierFlag === undefined) delete process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
            else process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = previousClassifierFlag;
        }

        expect(mockedGenerateText).toHaveBeenCalledWith(expect.objectContaining({
            system: expect.stringContaining("clients, employees"),
        }));
        const classifierSystem = mockedGenerateText.mock.calls[0]?.[0]?.system;
        expect(classifierSystem).not.toContain("contracts");
    });

    it("caps the bundle at the default maximum of twelve capabilities", async () => {
        const capabilities = Array.from({ length: 15 }, (_, index) => ({
            meta: { name: `clients.read${index}`, domain: "clients" },
        }));
        const router = new CapabilityRouterService(
            { list: () => capabilities } as never,
            enabledFlags() as never,
        );
        await expect(router.route("client", {
            userId: "u", branchId: "b", globalRole: "admin", branchRole: "admin",
        })).resolves.toMatchObject({ capabilities: { length: 12 } });
    });

    it("minimizes phone, email, URL, and long identifiers before classifier dispatch", () => {
        expect(minimizeClassifierText("010-1234-5678 client@example.com https://private.example/a 123e4567-e89b-12d3-a456-426614174000 abcdefghijklmnopqrstuvwxyz 고객 123456789"))
            .toBe("[redacted] [redacted] [redacted] 123e4567-e89b-12d3-a456-426614174000 abcdefghijklmnopqrstuvwxyz 고객 [redacted]");
    });

    it("minimizes Korean landlines and hyphenated identifiers while preserving operational metadata", () => {
        expect(minimizeClassifierText("02-1234-5678 031-123-4567 070-1234-5678 080-123-4567 0505-123-4567 +82-2-1234-5678 +82-31-123-4567 900101-1234567 123-45-67890 2026-08-03 v1.2.3 123e4567-e89b-12d3-a456-426614174000"))
            .toBe("[redacted] [redacted] [redacted] [redacted] [redacted] [redacted] [redacted] [redacted] [redacted] 2026-08-03 v1.2.3 123e4567-e89b-12d3-a456-426614174000");
    });

    it("passes only minimized current-turn text to the ambiguous classifier", async () => {
        mockedGenerateText.mockResolvedValueOnce({ text: '{"domains":["clients"]}' } as never);
        const router = new CapabilityRouterService(
            { list: () => [{ meta: { name: "clients.search", domain: "clients" } }] } as never,
            enabledFlags() as never,
            { create: jest.fn().mockReturnValue({}) } as never,
        );
        const previousClassifierFlag = process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
        process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = "true";

        try {
            await router.route("person@example.com https://private.example/a 123e4567-e89b-12d3-a456-426614174000", {
                userId: "u", branchId: "b", globalRole: "admin", branchRole: "admin",
            });
        } finally {
            if (previousClassifierFlag === undefined) delete process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
            else process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = previousClassifierFlag;
        }

        expect(mockedGenerateText).toHaveBeenCalledWith(expect.objectContaining({
            prompt: "[redacted] [redacted] 123e4567-e89b-12d3-a456-426614174000",
        }));
    });

    it("masks labelled and server-known customer values before classifier dispatch", async () => {
        mockedGenerateText.mockResolvedValueOnce({ text: '{"domains":["clients"]}' } as never);
        const router = new CapabilityRouterService(
            { list: () => [
                { meta: { name: "clients.search", domain: "clients" } },
                { meta: { name: "employees.search", domain: "employees" } },
            ] } as never,
            enabledFlags() as never,
            { create: jest.fn().mockReturnValue({}) } as never,
        );
        const previousClassifierFlag = process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
        process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = "true";

        try {
            await router.route("이름: 홍길동, 주소: 서울시 강남구", principal, 12, ["서울시 강남구"]);
        } finally {
            if (previousClassifierFlag === undefined) delete process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
            else process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = previousClassifierFlag;
        }

        expect(mockedGenerateText).toHaveBeenCalledWith(expect.objectContaining({
            prompt: "이름: [protected], 주소: [protected]",
        }));
        const classifierPrompt = mockedGenerateText.mock.calls[0]?.[0]?.prompt;
        expect(classifierPrompt).not.toContain("홍길동");
        expect(classifierPrompt).not.toContain("서울시 강남구");
    });

    it("removes labeled credentials while preserving opaque operational identifiers", () => {
        expect(minimizeClassifierText("Bearer abc.def token: secret-value actionId=123e4567-e89b-12d3-a456-426614174000 cursor=cuid_2m4x6z8q0v"))
            .toBe("[redacted] [redacted] actionId=123e4567-e89b-12d3-a456-426614174000 cursor=cuid_2m4x6z8q0v");
    });

    describe("decision facade routing", () => {
        function stubTurn(): DecisionTurnContext {
            return {
                deadlineAt: Date.now() + 60_000,
                signal: new AbortController().signal,
                sampleKey: "spec-turn",
                collector: { record: jest.fn() },
            } as unknown as DecisionTurnContext;
        }

        function facadeStub(selection: readonly string[] | null = null) {
            const routeDomains = jest.fn().mockResolvedValue({
                status: selection === null ? "abstain" : "accepted",
                selection,
                baselineSelection: null,
                reason: selection === null ? "low-confidence" : null,
                profileVersion: "spec-profile",
            });
            const turn = stubTurn();
            return {
                routeDomains,
                turn,
                context: (mode: DecisionMode): RouterDecisionContext => ({ decisions: { routeDomains }, turn, mode }),
            };
        }

        function rejectingFacadeStub() {
            const routeDomains = jest.fn().mockRejectedValue(new Error("facade unavailable"));
            const turn = stubTurn();
            return {
                routeDomains,
                turn,
                context: (mode: DecisionMode): RouterDecisionContext => ({ decisions: { routeDomains }, turn, mode }),
            };
        }

        function threeDomainRegistry() {
            return {
                list: () => [
                    { meta: { name: "clients.search", domain: "clients" } },
                    { meta: { name: "employees.search", domain: "employees" } },
                    { meta: { name: "schedules.create", domain: "schedules" } },
                ],
            };
        }

        async function withClassifierFlag<T>(value: "true" | "false", run: () => Promise<T>): Promise<T> {
            const previous = process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
            process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = value;
            try {
                return await run();
            } finally {
                if (previous === undefined) delete process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"];
                else process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] = previous;
            }
        }

        it("returns the incumbent selection with the selected disposition when no decision context is given", async () => {
            const router = new CapabilityRouterService(ambiguousRegistry() as never, enabledFlags() as never);

            await expect(router.route("고객 직원", principal)).resolves.toMatchObject({
                domains: ["clients", "employees"],
                capabilities: [
                    { meta: { name: "clients.search", domain: "clients" } },
                    { meta: { name: "employees.search", domain: "employees" } },
                ],
                disposition: "selected",
            });
        });

        it("shadow mode observes the facade and returns the incumbent result verbatim", async () => {
            const facade = facadeStub(["employees"]);
            const router = new CapabilityRouterService(ambiguousRegistry() as never, enabledFlags() as never);

            // The incumbent result (lexical fallback, no classifier models) is
            // returned even though the facade selected a different domain.
            await expect(router.route("고객 직원", principal, 12, [], facade.context("shadow"))).resolves.toMatchObject({
                domains: ["clients", "employees"],
                disposition: "selected",
            });
            expect(facade.routeDomains).toHaveBeenCalledTimes(1);
            expect(facade.routeDomains).toHaveBeenCalledWith(facade.turn, {
                text: "고객 직원",
                knownValues: [],
                permittedDomains: ["clients", "employees"],
                baseline: ["clients", "employees"],
            });
        });

        it("shadow mode still records the observation for the single-domain keyword fast path", async () => {
            const facade = facadeStub();
            const router = new CapabilityRouterService(ambiguousRegistry() as never, enabledFlags() as never);

            await expect(router.route("고객", principal, 12, [], facade.context("shadow"))).resolves.toMatchObject({
                domains: ["clients"],
                disposition: "selected",
            });
            expect(facade.routeDomains).toHaveBeenCalledTimes(1);
        });

        it("shadow mode observation failures never disturb the incumbent result", async () => {
            const facade = rejectingFacadeStub();
            const router = new CapabilityRouterService(ambiguousRegistry() as never, enabledFlags() as never);

            await expect(router.route("고객 직원", principal, 12, [], facade.context("shadow"))).resolves.toMatchObject({
                domains: ["clients", "employees"],
                disposition: "selected",
            });
        });

        it("off mode never calls the decision facade", async () => {
            const facade = facadeStub();
            const router = new CapabilityRouterService(ambiguousRegistry() as never, enabledFlags() as never);

            await expect(router.route("고객 직원", principal, 12, [], facade.context("off"))).resolves.toMatchObject({
                domains: ["clients", "employees"],
                disposition: "selected",
            });
            expect(facade.routeDomains).not.toHaveBeenCalled();
        });

        it.each(["off", "shadow"] as const)("keeps the current keyword fallback cardinality above two domains in %s mode", async (mode) => {
            const facade = facadeStub();
            const router = new CapabilityRouterService(threeDomainRegistry() as never, enabledFlags() as never);

            // The two-domain enforce cap must not be applied retroactively:
            // off/shadow keyword fallback keeps all three matches.
            await expect(router.route("고객 직원 일정", principal, 12, [], facade.context(mode))).resolves.toMatchObject({
                domains: ["clients", "employees", "schedules"],
                disposition: "selected",
            });
            if (mode === "shadow") {
                expect(facade.routeDomains).toHaveBeenCalledWith(facade.turn, expect.objectContaining({
                    baseline: ["clients", "employees", "schedules"],
                }));
            } else {
                expect(facade.routeDomains).not.toHaveBeenCalled();
            }
        });

        it("enforce keeps the single-domain keyword fast path without calling the facade or the classifier", async () => {
            const facade = facadeStub();
            const create = jest.fn().mockReturnValue({});
            const router = new CapabilityRouterService(
                ambiguousRegistry() as never,
                enabledFlags() as never,
                { create } as never,
            );

            await withClassifierFlag("true", async () => {
                await expect(router.route("고객", principal, 12, [], facade.context("enforce"))).resolves.toMatchObject({
                    domains: ["clients"],
                    capabilities: [{ meta: { name: "clients.search", domain: "clients" } }],
                    disposition: "selected",
                });
            });

            expect(facade.routeDomains).not.toHaveBeenCalled();
            expect(create).not.toHaveBeenCalled();
            expect(mockedGenerateText).not.toHaveBeenCalled();
        });

        it("enforce abstains before any port call when more than two keyword domains match", async () => {
            const facade = facadeStub(["clients", "employees"]);
            const router = new CapabilityRouterService(threeDomainRegistry() as never, enabledFlags() as never);

            await expect(router.route("고객 직원 일정", principal, 12, [], facade.context("enforce"))).resolves.toMatchObject({
                domains: [],
                capabilities: [],
                disposition: "clarify",
            });
            expect(facade.routeDomains).not.toHaveBeenCalled();
        });

        it("enforce accepts a valid Jev selection from the enabled domain set", async () => {
            const facade = facadeStub(["employees"]);
            const router = new CapabilityRouterService(ambiguousRegistry() as never, enabledFlags() as never);

            await expect(router.route("고객 직원", principal, 12, [], facade.context("enforce"))).resolves.toMatchObject({
                domains: ["employees"],
                capabilities: [{ meta: { name: "employees.search", domain: "employees" } }],
                disposition: "selected",
            });
            expect(facade.routeDomains).toHaveBeenCalledWith(facade.turn, {
                text: "고객 직원",
                knownValues: [],
                permittedDomains: ["clients", "employees"],
                baseline: ["clients", "employees"],
            });
        });

        it("enforce accepts a two-domain selection and offers both domains' capabilities", async () => {
            const facade = facadeStub(["employees", "clients"]);
            const router = new CapabilityRouterService(ambiguousRegistry() as never, enabledFlags() as never);

            await expect(router.route("고객 직원", principal, 12, [], facade.context("enforce"))).resolves.toMatchObject({
                domains: ["employees", "clients"],
                capabilities: [
                    { meta: { name: "clients.search", domain: "clients" } },
                    { meta: { name: "employees.search", domain: "employees" } },
                ],
                disposition: "selected",
            });
        });

        it("enforce deduplicates a repeated selection before accepting it", async () => {
            const facade = facadeStub(["clients", "clients"]);
            const router = new CapabilityRouterService(ambiguousRegistry() as never, enabledFlags() as never);

            await expect(router.route("고객 직원", principal, 12, [], facade.context("enforce"))).resolves.toMatchObject({
                domains: ["clients"],
                disposition: "selected",
            });
        });

        it.each([
            ["an empty selection", []],
            ["a selection above the supported domain count", ["clients", "employees", "schedules"]],
            ["a selection naming a non-member domain", ["clients", "schedules"]],
            ["a selection with a non-string entry", ["clients", 42]],
        ] as const)("enforce treats %s as an abstention", async (_caseName, selection) => {
            const facade = facadeStub(selection as readonly string[]);
            const router = new CapabilityRouterService(ambiguousRegistry() as never, enabledFlags() as never);

            await expect(router.route("고객 직원", principal, 12, [], facade.context("enforce"))).resolves.toMatchObject({
                domains: [],
                capabilities: [],
                disposition: "clarify",
            });
        });

        it("enforce never calls the incumbent classifier when the decision abstains", async () => {
            const facade = facadeStub(null);
            const create = jest.fn().mockReturnValue({});
            const router = new CapabilityRouterService(
                ambiguousRegistry() as never,
                enabledFlags() as never,
                { create } as never,
            );

            // Zero keyword matches: the incumbent path would default to
            // "clients"; enforce must abstain instead, with no classifier call.
            await withClassifierFlag("true", async () => {
                await expect(router.route("도와줘", principal, 12, [], facade.context("enforce"))).resolves.toMatchObject({
                    domains: [],
                    capabilities: [],
                    disposition: "clarify",
                });
            });

            expect(facade.routeDomains).toHaveBeenCalledTimes(1);
            expect(create).not.toHaveBeenCalled();
            expect(mockedGenerateText).not.toHaveBeenCalled();
        });

        it("enforce never calls the incumbent classifier when the selection is invalid", async () => {
            const facade = facadeStub(["clients", "schedules"]);
            const create = jest.fn().mockReturnValue({});
            const router = new CapabilityRouterService(
                ambiguousRegistry() as never,
                enabledFlags() as never,
                { create } as never,
            );

            await withClassifierFlag("true", async () => {
                await expect(router.route("고객 직원", principal, 12, [], facade.context("enforce"))).resolves.toMatchObject({
                    domains: [],
                    capabilities: [],
                    disposition: "clarify",
                });
            });

            expect(facade.routeDomains).toHaveBeenCalledTimes(1);
            expect(create).not.toHaveBeenCalled();
            expect(mockedGenerateText).not.toHaveBeenCalled();
        });

        it.each(["off", "shadow", "enforce"] as const)("reports the disabled disposition without calling the facade in %s mode when no domain is enabled", async (mode) => {
            const facade = facadeStub(["clients"]);
            const allDisabledFlags = {
                getSnapshot: jest.fn().mockResolvedValue({ config: {}, emergencyDisabled: false }),
                isCapabilityEnabledFromSnapshot: jest.fn().mockReturnValue(false),
            };
            const router = new CapabilityRouterService(ambiguousRegistry() as never, allDisabledFlags as never);

            await expect(router.route("고객", principal, 12, [], facade.context(mode))).resolves.toMatchObject({
                domains: [],
                capabilities: [],
                disposition: "disabled",
            });
            expect(facade.routeDomains).not.toHaveBeenCalled();
        });

        it("enforce passes string known values only to the facade", async () => {
            const facade = facadeStub(["clients"]);
            const router = new CapabilityRouterService(ambiguousRegistry() as never, enabledFlags() as never);

            await router.route("고객 직원", principal, 12, [42, "서울시 강남구"], facade.context("enforce"));

            expect(facade.routeDomains).toHaveBeenCalledWith(facade.turn, expect.objectContaining({
                knownValues: ["서울시 강남구"],
            }));
        });
    });
});
