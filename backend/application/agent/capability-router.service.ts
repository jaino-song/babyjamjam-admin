import { Injectable, Optional } from "@nestjs/common";
import { generateText } from "ai";

import type { VerifiedTenantPrincipal } from "infrastructure/tenant/tenant.context";
import { AgentModelFactory } from "infrastructure/agent/agent-model.factory";
import { AgentFlagsService } from "./agent-flags.service";
import { CapabilityRegistryService } from "./capability-registry.service";
import type { CapabilityDefinition } from "./capability.types";
import { redactClassifierText } from "./agent-model-redaction";
import type { DecisionMode } from "./decision/decision-contracts";
import type { AgentDecisionService, DecisionTurnContext } from "./decision/agent-decision.service";

export const DOMAIN_TERMS: Record<string, RegExp> = {
    clients: /(산모|고객|client|mother)/i,
    employees: /(관리사|직원|employee|caregiver)/i,
    schedules: /(일정|스케줄|schedule|calendar)/i,
    dashboard: /(대시보드|요약|dashboard|summary)/i,
    vouchers: /(바우처|voucher|가격|price)/i,
    bank: /(계좌|은행|bank|account)/i,
    contracts: /(계약|서명|contract|document)/i,
    consultations: /(상담|문의|consultation|inquiry)/i,
    calls: /(통화|녹취|전화 기록|call|transcript)/i,
    drafts: /(초안|draft|통화 추출)/i,
    automation: /(자동화|트리거|automation|trigger)/i,
    files: /(파일|문서 파일|첨부|file|attachment)/i,
    policy: /(정책|규정|승인 원칙|보안 원칙|policy|rule|compliance)/i,
    "service-records": /(제공기록|서비스 기록|service[ -]?record)/i,
    analytics: /(분석|통계|analytics|metric|funnel)/i,
    settings: /(설정|환경설정|setting|configuration)/i,
    website: /(웹사이트|홈페이지|website|homepage)/i,
    messages: /(문자|메시지|템플릿|sms|message|template)/i,
    notifications: /(알림|notification|push)/i,
    admin: /(관리자|지점 생성|admin|branch creation)/i,
};

export function minimizeClassifierText(text: string, knownValues: readonly unknown[] = []): string {
    return redactClassifierText(text, knownValues);
}

export type RouterDisposition = "selected" | "clarify" | "disabled";

/**
 * Caller-supplied handle to the Jev decision layer. The router never
 * constructs the decision façade and never resolves it through Nest DI: the
 * caller owns construction and wiring.
 */
export interface RouterDecisionContext {
    /** Narrow slice of the decision façade; the caller owns construction. */
    readonly decisions: Pick<AgentDecisionService, "routeDomains">;
    readonly turn: DecisionTurnContext;
    /** Resolved decision mode for the "route-domains" kind. */
    readonly mode: DecisionMode;
}

export interface CapabilityRouteResult {
    domains: string[];
    capabilities: CapabilityDefinition[];
    disposition: RouterDisposition;
}

/**
 * Disposition contract: the runtime applies disposition-based behavior ONLY
 * in enforce mode (the caller resolved `mode: "enforce"` into the decision
 * context). In off/shadow the returned `domains`/`capabilities` are the
 * incumbent result verbatim and the disposition is observational
 * (`"selected"`, or `"disabled"` when no domain is enabled) — never
 * `"clarify"` — so no caller can gate a non-enforce turn on an abstention.
 */
@Injectable()
export class CapabilityRouterService {
    constructor(
        private readonly registry: CapabilityRegistryService,
        private readonly flags: AgentFlagsService,
        @Optional() private readonly models?: AgentModelFactory,
    ) {}

    /**
     * Existing callers keep the exact incumbent behavior: the decision
     * context parameter is optional and the returned `domains`/`capabilities`
     * fields keep their semantics; `disposition` is additive.
     */
    async route(
        text: string,
        principal: VerifiedTenantPrincipal,
        max = 12,
        protectedValues: readonly unknown[] = [],
        decisionContext?: RouterDecisionContext,
    ): Promise<CapabilityRouteResult> {
        const snapshot = await this.flags.getSnapshot();
        const enabledCapabilities = this.registry.list().filter((capability) => (
            this.flags.isCapabilityEnabledFromSnapshot(capability.meta, principal, snapshot)
        ));
        const enabledDomains = new Set(enabledCapabilities.map((capability) => capability.meta.domain));
        const matched = Object.entries(DOMAIN_TERMS)
            .filter(([, pattern]) => pattern.test(text))
            .map(([domain]) => domain)
            .filter((domain) => enabledDomains.has(domain));

        if (enabledDomains.size === 0) {
            return { domains: [], capabilities: [], disposition: "disabled" };
        }

        if (decisionContext && decisionContext.mode === "enforce") {
            return this.routeEnforce(
                text,
                decisionContext,
                matched,
                enabledDomains,
                enabledCapabilities,
                max,
                protectedValues,
            );
        }

        const domains = await this.incumbentDomains(text, enabledDomains, matched, protectedValues);
        if (decisionContext && decisionContext.mode === "shadow") {
            // Shadow observation only: the Jev selection is ignored and the
            // incumbent result above stays authoritative.
            try {
                await decisionContext.decisions.routeDomains(
                    decisionContext.turn,
                    this.routeDomainsInput(text, enabledDomains, matched, protectedValues),
                );
            } catch {
                // A failed observation must never disturb the incumbent result.
            }
        }
        return { domains, capabilities: this.offerCapabilities(domains, enabledCapabilities, max), disposition: "selected" };
    }

    /**
     * Enforce path. The incumbent generative classifier
     * (`classifyAmbiguous`) and the default `"clients"` fallback are
     * unreachable here: an ambiguous request either yields a validated Jev
     * selection or an explicit abstention.
     */
    private async routeEnforce(
        text: string,
        decisionContext: RouterDecisionContext,
        matched: string[],
        enabledDomains: ReadonlySet<string>,
        enabledCapabilities: CapabilityDefinition[],
        max: number,
        protectedValues: readonly unknown[],
    ): Promise<CapabilityRouteResult> {
        if (matched.length === 1) {
            // Single deterministic keyword match: fast path, no façade call.
            return {
                domains: [...matched],
                capabilities: this.offerCapabilities(matched, enabledCapabilities, max),
                disposition: "selected",
            };
        }
        if (matched.length > 2) {
            // More keyword matches than the supported domain count:
            // deterministic abstention before any decision port call.
            return { domains: [], capabilities: [], disposition: "clarify" };
        }
        const decision = await decisionContext.decisions.routeDomains(
            decisionContext.turn,
            this.routeDomainsInput(text, enabledDomains, matched, protectedValues),
        );
        // Validate against the enabled domain set before accepting Jev
        // output: the selection must deduplicate to 1-2 strings, each an
        // enabled domain; anything else is an abstention.
        const selection = decision.selection === null ? null : [...new Set(decision.selection)];
        if (
            selection === null
            || selection.length === 0
            || selection.length > 2
            || !selection.every((domain) => typeof domain === "string" && enabledDomains.has(domain))
        ) {
            // Explicit abstention: no incumbent classifier fallback and no
            // default "clients" fallback.
            return { domains: [], capabilities: [], disposition: "clarify" };
        }
        return {
            domains: selection,
            capabilities: this.offerCapabilities(selection, enabledCapabilities, max),
            disposition: "selected",
        };
    }

    /** The incumbent decisions, unchanged; used in off/shadow and by legacy callers. */
    private async incumbentDomains(
        text: string,
        enabledDomains: ReadonlySet<string>,
        matched: string[],
        protectedValues: readonly unknown[],
    ): Promise<string[]> {
        const classifierDomains = matched.length === 1
            ? matched
            : await this.classifyAmbiguous(text, [...enabledDomains], protectedValues);
        const routedDomains = classifierDomains.length > 0 ? classifierDomains : matched;
        return routedDomains.length > 0 ? routedDomains : (enabledDomains.has("clients") ? ["clients"] : []);
    }

    /** Facade input; `baseline` is always the deterministic keyword fallback. */
    private routeDomainsInput(
        text: string,
        enabledDomains: ReadonlySet<string>,
        matched: readonly string[],
        protectedValues: readonly unknown[],
    ): {
        readonly text: string;
        readonly knownValues: readonly string[];
        readonly permittedDomains: readonly string[];
        readonly baseline: readonly string[];
    } {
        // The façade types knownValues as strings and its redaction ignores
        // non-string values anyway, so narrowing here is behavior-identical.
        const knownValues = protectedValues.filter((value): value is string => typeof value === "string");
        return {
            text,
            knownValues,
            permittedDomains: [...enabledDomains],
            baseline: matched,
        };
    }

    private offerCapabilities(
        domains: readonly string[],
        enabledCapabilities: CapabilityDefinition[],
        max: number,
    ): CapabilityDefinition[] {
        const offered: CapabilityDefinition[] = [];
        for (const capability of enabledCapabilities) {
            if (!domains.includes(capability.meta.domain)) continue;
            offered.push(capability);
            if (offered.length >= max) break;
        }
        return offered;
    }

    private async classifyAmbiguous(text: string, enabledDomains: string[], protectedValues: readonly unknown[]): Promise<string[]> {
        if (!this.models || enabledDomains.length === 0 || process.env["AGENT_ROUTER_CLASSIFIER_ENABLED"] === "false") return [];
        const prompt = minimizeClassifierText(text, protectedValues);
        try {
            const result = await generateText({
                model: this.models.create(),
                system: `Classify the request into at most two domains from: ${enabledDomains.join(", ")}. Return JSON only: {"domains":["domain"]}. Never include personal data.`,
                prompt,
                maxOutputTokens: 64,
            });
            const json = result.text.match(/\{[\s\S]*\}/)?.[0];
            if (!json) return [];
            const parsed = JSON.parse(json) as { domains?: unknown };
            if (!Array.isArray(parsed.domains) || parsed.domains.length === 0 || parsed.domains.length > 2) return [];
            if (!parsed.domains.every((domain): domain is string => typeof domain === "string" && enabledDomains.includes(domain))) return [];
            return [...new Set(parsed.domains)];
        } catch {
            return [];
        }
    }
}
