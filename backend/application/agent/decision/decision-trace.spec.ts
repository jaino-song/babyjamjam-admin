import {
    DECISION_KINDS,
    DECISION_MODES,
    DECISION_STATUSES,
    type DecisionTraceEventV1,
    type DomainRoutingEvidence,
} from "./decision-contracts";
import { toDecisionTraceEvent } from "./decision-policy";
import { DECISION_QUESTION_VERSION } from "./decision-questions";
import {
    createDecisionTraceCollector,
    mergeDecisionTraceEvents,
    MAX_DECISION_TRACE_EVENTS,
    serializeDecisionTraceEvent,
} from "./decision-trace";

function makeValidEvent(overrides: Partial<DecisionTraceEventV1> = {}): DecisionTraceEventV1 {
    return {
        kind: "semantic-decision-v1",
        decisionKind: DECISION_KINDS.routeDomains,
        mode: DECISION_MODES.shadow,
        model: "jev-1.13.0",
        profileVersion: "profile-v1",
        questionVersion: DECISION_QUESTION_VERSION,
        labels: ["clients"],
        scores: [0.9],
        latencyMs: 42,
        outcome: DECISION_STATUSES.accepted,
        reason: null,
        disagreement: null,
        usage: { inputTokens: 10, outputTokens: 5 },
        missing: false,
        droppedReason: null,
        ...overrides,
    };
}

describe("decision-trace collector", () => {
    it("keeps two collectors isolated — no module-level shared state", () => {
        const first = createDecisionTraceCollector();
        const second = createDecisionTraceCollector();

        expect(first.record(makeValidEvent({ labels: ["a"], scores: [0.1] }))).toBe(true);

        const secondDrain = second.drain();
        expect(secondDrain.events).toEqual([]);
        expect(secondDrain.drained).toBe(true);
        expect(secondDrain.droppedCount).toBe(0);

        const firstDrain = first.drain();
        expect(firstDrain.events).toEqual([makeValidEvent({ labels: ["a"], scores: [0.1] })]);
        expect(firstDrain.drained).toBe(true);
    });

    it("bounds accepted events to maxEvents", () => {
        const collector = createDecisionTraceCollector({ maxEvents: 2 });
        const first = makeValidEvent({ labels: ["a"], scores: [0.1] });
        const second = makeValidEvent({ labels: ["b"], scores: [0.2] });

        expect(collector.record(first)).toBe(true);
        expect(collector.record(second)).toBe(true);

        const drain = collector.drain();
        expect(drain.events).toEqual([first, second]);
        expect(drain.drained).toBe(true);
    });

    it("counts overflow as dropped and rejects the event", () => {
        const collector = createDecisionTraceCollector({ maxEvents: 1 });
        expect(collector.record(makeValidEvent())).toBe(true);
        expect(collector.record(makeValidEvent({ labels: ["b"], scores: [0.2] }))).toBe(false);

        const drain = collector.drain();
        expect(drain.events).toEqual([makeValidEvent()]);
        expect(drain.droppedCount).toBe(1);
        expect(drain.drained).toBe(true);
    });

    it("defaults to MAX_DECISION_TRACE_EVENTS bounding", () => {
        const collector = createDecisionTraceCollector();
        for (let index = 0; index < MAX_DECISION_TRACE_EVENTS; index += 1) {
            expect(collector.record(makeValidEvent({ labels: [`d${index}`], scores: [0.1] }))).toBe(true);
        }
        expect(collector.record(makeValidEvent({ labels: ["overflow"], scores: [0.1] }))).toBe(false);

        const drain = collector.drain();
        expect(drain.events).toHaveLength(MAX_DECISION_TRACE_EVENTS);
        expect(drain.droppedCount).toBe(1);
    });

    it("drains exactly once and rejects late records", () => {
        const collector = createDecisionTraceCollector();
        const kept = makeValidEvent();
        collector.record(kept);

        const first = collector.drain();
        expect(first.drained).toBe(true);
        expect(first.events).toEqual([kept]);
        expect(first.droppedCount).toBe(0);

        // Late result may never enter a drained collector.
        expect(collector.record(makeValidEvent({ labels: ["late"], scores: [0.5] }))).toBe(false);

        const second = collector.drain();
        expect(second.events).toEqual([]);
        expect(second.drained).toBe(false);
        expect(second.droppedCount).toBe(1);
    });

    it("rejects and counts an invalid event", () => {
        const collector = createDecisionTraceCollector();
        const invalid = { ...makeValidEvent(), scores: [Number.NaN] } as unknown as DecisionTraceEventV1;
        expect(collector.record(invalid)).toBe(false);

        const drain = collector.drain();
        expect(drain.events).toEqual([]);
        expect(drain.droppedCount).toBe(1);
    });
});

describe("serializeDecisionTraceEvent", () => {
    it("accepts a valid toDecisionTraceEvent output unchanged", () => {
        const evidence: DomainRoutingEvidence = {
            kind: "route-domains",
            status: DECISION_STATUSES.accepted,
            questionVersion: DECISION_QUESTION_VERSION,
            requestedModel: "jev-1.13.0",
            returnedModel: "jev-1.13.0",
            latencyMs: 42,
            providerRequestId: "req-1",
            failureReason: null,
            usage: { inputTokens: 10, outputTokens: 5 },
            domains: [
                { domain: "clients", yesProbability: 0.92 },
                { domain: "schedules", yesProbability: 0.1 },
            ],
        };
        const event = toDecisionTraceEvent({
            evidence,
            mode: DECISION_MODES.shadow,
            baselineEvidence: null,
            profileVersion: "profile-v1",
            missing: false,
            droppedReason: null,
        });

        expect(serializeDecisionTraceEvent(event)).toEqual(event);
    });

    it("accepts a valid event with null optional fields", () => {
        const event = makeValidEvent({
            model: null,
            profileVersion: null,
            usage: null,
            disagreement: null,
            reason: "low-confidence",
            droppedReason: null,
        });
        expect(serializeDecisionTraceEvent(event)).toEqual(event);
    });

    it("rejects a non-finite score", () => {
        const invalid = { ...makeValidEvent(), scores: [Number.POSITIVE_INFINITY] };
        expect(serializeDecisionTraceEvent(invalid as DecisionTraceEventV1)).toBeNull();
    });

    it("rejects labels and scores of unequal length", () => {
        const invalid = makeValidEvent({ labels: ["clients", "schedules"], scores: [0.9] });
        expect(serializeDecisionTraceEvent(invalid)).toBeNull();
    });

    it("rejects a raw-text droppedReason", () => {
        const invalid = makeValidEvent({ droppedReason: "Model timed out after retry!!!" });
        expect(serializeDecisionTraceEvent(invalid)).toBeNull();
    });

    it("rejects an unknown kind", () => {
        const invalid = { ...makeValidEvent(), kind: "semantic-decision-v2" };
        expect(serializeDecisionTraceEvent(invalid as unknown as DecisionTraceEventV1)).toBeNull();
    });

    it("rejects an unknown mode", () => {
        const invalid = { ...makeValidEvent(), mode: "observe" };
        expect(serializeDecisionTraceEvent(invalid as unknown as DecisionTraceEventV1)).toBeNull();
    });

    it("rejects an unknown outcome", () => {
        const invalid = { ...makeValidEvent(), outcome: "skipped" };
        expect(serializeDecisionTraceEvent(invalid as unknown as DecisionTraceEventV1)).toBeNull();
    });

    it("rejects token-pattern violations on labels", () => {
        const invalid = makeValidEvent({ labels: ["bad label!"], scores: [0.9] });
        expect(serializeDecisionTraceEvent(invalid)).toBeNull();
    });

    it("rejects token-pattern violations on model", () => {
        const invalid = makeValidEvent({ model: "model; DROP TABLE users" });
        expect(serializeDecisionTraceEvent(invalid)).toBeNull();
    });

    it("rejects token-pattern violations on profileVersion", () => {
        const invalid = makeValidEvent({ profileVersion: "profile v1" });
        expect(serializeDecisionTraceEvent(invalid)).toBeNull();
    });

    it("rejects a negative latencyMs", () => {
        const invalid = makeValidEvent({ latencyMs: -1 });
        expect(serializeDecisionTraceEvent(invalid)).toBeNull();
    });

    it("rejects non-numeric usage token counts", () => {
        const invalid = { ...makeValidEvent(), usage: { inputTokens: "10", outputTokens: 5 } };
        expect(serializeDecisionTraceEvent(invalid as unknown as DecisionTraceEventV1)).toBeNull();
    });

    it("rejects a non-boolean missing flag", () => {
        const invalid = { ...makeValidEvent(), missing: "false" };
        expect(serializeDecisionTraceEvent(invalid as unknown as DecisionTraceEventV1)).toBeNull();
    });

    it("rejects null input", () => {
        expect(serializeDecisionTraceEvent(null as unknown as DecisionTraceEventV1)).toBeNull();
    });
});

describe("mergeDecisionTraceEvents", () => {
    it("preserves capability entries and appends tagged events in order", () => {
        const capabilityMetadata = [
            { capability: "clients.search", version: "1.0.0", risk: "read" },
            { capability: "clients.create", version: "1.0.0", risk: "write" },
        ];
        const first = makeValidEvent({ decisionKind: DECISION_KINDS.routeDomains, labels: ["clients"], scores: [0.9] });
        const second = makeValidEvent({
            decisionKind: DECISION_KINDS.classifyClientIntent,
            labels: ["create", "read"],
            scores: [0.8, 0.1],
        });

        const result = mergeDecisionTraceEvents(capabilityMetadata, [first, second]);

        expect(result.omittedReason).toBeNull();
        expect(result.appended).toBe(2);
        expect(result.dropped).toBe(0);
        const merged = result.stepMetadata as unknown[];
        expect(merged).toHaveLength(4);
        // Existing entries unchanged, tagged events appended in order.
        expect(merged[0]).toEqual(capabilityMetadata[0]);
        expect(merged[0]).toBe(capabilityMetadata[0]);
        expect(merged[1]).toEqual(capabilityMetadata[1]);
        expect(merged[2]).toEqual(first);
        expect(merged[3]).toEqual(second);
    });

    it("preserves a non-array legacy payload untouched with omittedReason", () => {
        const legacy = { note: "legacy metadata", count: 2 };
        const event = makeValidEvent();

        const result = mergeDecisionTraceEvents(legacy, [event]);

        expect(result.stepMetadata).toBe(legacy);
        expect(result.appended).toBe(0);
        expect(result.dropped).toBe(1);
        expect(result.omittedReason).toBe("legacy-non-array-payload");
    });

    it("drops invalid events and counts them while appending the valid ones", () => {
        const valid = makeValidEvent();
        const invalid = { ...makeValidEvent(), outcome: "skipped" } as unknown as DecisionTraceEventV1;

        const result = mergeDecisionTraceEvents([{ capability: "clients.search" }], [invalid, valid]);

        expect(result.appended).toBe(1);
        expect(result.dropped).toBe(1);
        expect(result.omittedReason).toBeNull();
        expect(result.stepMetadata).toEqual([{ capability: "clients.search" }, valid]);
    });

    it("returns the original payload untouched when events is undefined", () => {
        const payload = [{ capability: "clients.search", version: "1.0.0", risk: "read" }];

        const result = mergeDecisionTraceEvents(payload, undefined);

        expect(result.stepMetadata).toBe(payload);
        expect(result.appended).toBe(0);
        expect(result.dropped).toBe(0);
        expect(result.omittedReason).toBeNull();
    });

    it("returns the original payload untouched when events is empty", () => {
        const payload = [{ capability: "clients.search" }];

        const result = mergeDecisionTraceEvents(payload, []);

        expect(result.stepMetadata).toBe(payload);
        expect(result.appended).toBe(0);
        expect(result.dropped).toBe(0);
        expect(result.omittedReason).toBeNull();
    });

    it("does not mutate the original array when merging", () => {
        const payload = [{ capability: "clients.search" }];
        const event = makeValidEvent();

        mergeDecisionTraceEvents(payload, [event]);

        expect(payload).toEqual([{ capability: "clients.search" }]);
        expect(payload).toHaveLength(1);
    });
});
