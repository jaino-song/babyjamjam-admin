import type {
    ConversationRuntimeAdapter,
    ConversationRuntimeContext,
    ConversationRuntimeObservation,
    ConversationTransport,
    RuntimeSafetyError,
} from "./evaluation-policy";
import type { ConversationScenario, ConversationTurn, InputEvent } from "./cases";

/**
 * The product projection intentionally excludes `scenario.oracle`.  A driver
 * must obtain every observation from the product runtime, task service, and
 * its injected ledgers; fixture expectations are only consumed later by the
 * evaluator.
 */
export interface ProductScenarioProjection {
    readonly id: string;
    readonly partition: ConversationScenario["partition"];
    readonly family: ConversationScenario["family"];
    readonly fixtureVersion: ConversationScenario["fixtureVersion"];
    readonly deterministicClock: ConversationScenario["deterministicClock"];
    readonly syntheticTokens: readonly string[];
    readonly turns: readonly ConversationTurn[];
}
export interface ProductRuntimeTurnContext {
    readonly scenario: ProductScenarioProjection;
    readonly turn: ConversationTurn;
    readonly turnIndex: number;
    readonly clock: ConversationRuntimeContext["clock"];
    readonly transport: ConversationTransport;
}

/**
 * A narrow bridge around the real AgentRuntime/task service.  The adapter does
 * not prescribe how a host builds DI fixtures: the host supplies one driver
 * that sends a turn through the actual runtime and returns inspected evidence.
 * Returning a partial observation is intentional while a later lifecycle
 * phase has no authoritative ledger (the evaluator reports not_evaluated).
 */
export interface ProductRuntimeDriver {
    reset?(context: {
        readonly scenario: ProductScenarioProjection;
        readonly clock: ConversationRuntimeContext["clock"];
        readonly transport: ConversationTransport;
    }): Promise<void> | void;
    runTurn(context: ProductRuntimeTurnContext): Promise<ConversationRuntimeObservation | void>;
    inspect?(context: {
        readonly scenario: ProductScenarioProjection;
        readonly clock: ConversationRuntimeContext["clock"];
        readonly transport: ConversationTransport;
    }): Promise<ConversationRuntimeObservation | void>;
}

export interface ProductRuntimeAdapterOptions {
    readonly driver?: ProductRuntimeDriver;
    /** Bound the number of driver calls even if a malformed projection grows. */
    readonly maxTurns?: number;
}

/** Build an oracle-free immutable projection for the product bridge. */
export function projectScenarioForProduct(scenario: ConversationScenario): ProductScenarioProjection {
    return {
        id: scenario.id,
        partition: scenario.partition,
        family: scenario.family,
        fixtureVersion: scenario.fixtureVersion,
        deterministicClock: scenario.deterministicClock,
        syntheticTokens: [...scenario.syntheticTokens],
        turns: scenario.turns.map((turn) => ({
            id: turn.id,
            userText: turn.userText,
            inputEvents: turn.inputEvents.map((event) => ({ ...event } as InputEvent)),
        })),
    };
}

function mergeObservations(
    current: ConversationRuntimeObservation,
    next: ConversationRuntimeObservation | void,
): ConversationRuntimeObservation {
    if (!next) return current;
    return {
        ...current,
        ...(next.completion === undefined ? {} : { completion: next.completion }),
        ...(next.currentState === undefined ? {} : { currentState: next.currentState }),
        ...(next.acceptedDraftState === undefined ? {} : { acceptedDraftState: next.acceptedDraftState }),
        ...(next.structuredEvents === undefined ? {} : { structuredEvents: [...(current.structuredEvents ?? []), ...next.structuredEvents] }),
        ...(next.actionExecutionLedger === undefined ? {} : { actionExecutionLedger: [...(current.actionExecutionLedger ?? []), ...next.actionExecutionLedger] }),
        ...(next.sends === undefined ? {} : { sends: [...(current.sends ?? []), ...next.sends] }),
        ...(next.authorityOutcomes === undefined ? {} : { authorityOutcomes: [...(current.authorityOutcomes ?? []), ...next.authorityOutcomes] }),
        ...(next.assistantMessages === undefined ? {} : { assistantMessages: [...(current.assistantMessages ?? []), ...next.assistantMessages] }),
        ...(next.safetyErrors === undefined ? {} : { safetyErrors: [...(current.safetyErrors ?? []), ...next.safetyErrors] }),
    };
}

function applyClockEvents(turn: ConversationTurn, clock: ConversationRuntimeContext["clock"]): void {
    for (const event of turn.inputEvents) {
        if (event.type === "clock_advance") clock.advanceTo(event.at);
    }
}

function transportSafetyError(transport: ConversationTransport, observedAt: string): RuntimeSafetyError | undefined {
    // Deterministic product runs are intentionally offline. Read the injected
    // counter after all driver calls; do not trust a driver-supplied observation
    // field to claim that no network request occurred.
    if (transport.networkCalls === 0 && transport.calls >= transport.networkCalls) return undefined;
    return {
        code: "other",
        message: `Deterministic product bridge observed ${transport.networkCalls} network calls across ${transport.calls} transport calls`,
        observedAt,
    };
}

/**
 * Connect deterministic fixtures to an actual product/runtime driver.  With
 * no driver, the adapter still returns an honest structural observation: all
 * outcome fields remain missing and the evaluator reports not_evaluated rather
 * than passing synthetic fixture state.
 */
export function createProductRuntimeAdapter(options: ProductRuntimeAdapterOptions = {}): ConversationRuntimeAdapter {
    const maxTurns = Number.isSafeInteger(options.maxTurns) && (options.maxTurns ?? 0) > 0
        ? Math.min(options.maxTurns!, 32)
        : 16;
    return {
        mode: "product",
        async run(context: ConversationRuntimeContext): Promise<ConversationRuntimeObservation> {
            const scenario = projectScenarioForProduct(context.case);
            const driver = options.driver;
            let observation: ConversationRuntimeObservation = {};
            if (!driver) {
                return {
                    transport: { networkCalls: context.transport.networkCalls, calls: context.transport.calls },
                };
            }

            await driver.reset?.({ scenario, clock: context.clock, transport: context.transport });
            const turns = scenario.turns.slice(0, maxTurns);
            for (const [turnIndex, turn] of turns.entries()) {
                applyClockEvents(turn, context.clock);
                observation = mergeObservations(observation, await driver.runTurn({
                    scenario,
                    turn,
                    turnIndex,
                    clock: context.clock,
                    transport: context.transport,
                }));
            }
            observation = mergeObservations(observation, await driver.inspect?.({
                scenario,
                clock: context.clock,
                transport: context.transport,
            }));
            const networkError = transportSafetyError(context.transport, context.clock.now);
            if (networkError) {
                observation = {
                    ...observation,
                    safetyErrors: [...(observation.safetyErrors ?? []), networkError],
                };
            }
            return {
                ...observation,
                // This is always read from the authoritative injected transport
                // after the driver has completed.
                transport: { networkCalls: context.transport.networkCalls, calls: context.transport.calls },
            };
        },
    };
}
