export type TriggerJobDeferKind = "config" | "transient";

export class TriggerJobDeferredError extends Error {
    constructor(
        public readonly kind: TriggerJobDeferKind,
        reason: string,
    ) {
        super(reason);
        this.name = "TriggerJobDeferredError";
    }
}
