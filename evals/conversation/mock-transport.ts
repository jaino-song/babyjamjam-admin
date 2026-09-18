import type {
    ConversationRuntimeAdapter,
    ConversationRuntimeContext,
    ConversationRuntimeObservation,
    ConversationTransport,
} from "./evaluation-policy";

/** A transport that fails closed if a harness accidentally attempts I/O. */
export function createNoNetworkMockTransport(): ConversationTransport {
    let calls = 0;
    return {
        get calls() { return calls; },
        get networkCalls() { return calls; },
        async request<T = never>(): Promise<T> {
            calls += 1;
            throw new Error("The deterministic conversation harness does not permit network requests");
        },
    };
}

/**
 * This adapter only exercises the evaluator with deterministic synthetic
 * observations. Its results are labelled harness validation by the CLI and
 * must never be reported as product or model quality evidence.
 */
export function createHarnessValidationAdapter(): ConversationRuntimeAdapter {
    return {
        mode: "harness",
        async run(context: ConversationRuntimeContext): Promise<ConversationRuntimeObservation> {
            const { oracle } = context.case;
            const observedAt = context.clock.now;
            return {
                completion: oracle.completion,
                currentState: { ...oracle.currentState, observedAt },
                structuredEvents: oracle.requiredEvents.map((event) => ({ ...event, observedAt })),
                acceptedDraftState: oracle.acceptedDraftState.status === "absent"
                    ? null
                    : { ...oracle.acceptedDraftState, observedAt },
                actionExecutionLedger: oracle.ledger.map((entry) => ({ ...entry, observedAt })),
                sends: oracle.sends.map((entry) => ({ ...entry, observedAt })),
                authorityOutcomes: oracle.authority.map((entry) => ({ ...entry, observedAt })),
                assistantMessages: context.case.turns.map((turn) => ({ turnId: turn.id, text: "synthetic harness observation" })),
                safetyErrors: [],
                transport: { networkCalls: context.transport.networkCalls, calls: context.transport.calls },
            };
        },
    };
}
