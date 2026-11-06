import { z } from "zod";
import { canonicalJson } from "domain/eformsign-backup/source-evidence";
import { MANUAL_BACKUP_LEASE_DURATION_MS, manualBackupSnapshotId } from "domain/eformsign-backup/manual-backup-constants";
import { manualControlUuidSchema } from "domain/eformsign-backup/manual-backup-control";
import { manualExecutionScopeSchema } from "domain/eformsign-backup/worker/manual-protocol";
import { isoUtc } from "domain/eformsign-backup/worker/schema-fields";
import { ExecutionFencedError, type ExecutionFenceReason } from "../execution-effect-fence";
import { ManualControlFailure, manualClaimSnapshotSchema, type ManualClaim, type ManualControlClient, type ManualLease } from "./manual-control-client";

const expiry = z.strictObject({ leaseExpiresAtUTC: isoUtc.pipe(z.iso.datetime()), leaseDurationMs: z.literal(MANUAL_BACKUP_LEASE_DURATION_MS) });
const claimSchema = expiry.extend({ executionScope: manualExecutionScopeSchema, snapshot: manualClaimSnapshotSchema, leaseToken: manualControlUuidSchema })
    .refine(c => c.snapshot.companyId === c.executionScope.companyId && c.snapshot.snapshotId === manualBackupSnapshotId(c.executionScope));

/** Copy only strict JSON data, before crossing an asynchronous boundary. */
export function copyManualClaim(value: unknown): z.infer<typeof claimSchema> {
    try { return claimSchema.parse(JSON.parse(canonicalJson(value))); }
    catch { throw new ExecutionFencedError("uncertain"); }
}

export interface ManualBackupLeaseOptions {
    client: Pick<ManualControlClient, "renew" | "validate">;
    claim: ManualClaim;
    claimStartedAtMono: number;
    beforeCheck: () => Promise<void>;
    now?: () => number;
    setTimeout?: typeof setTimeout;
    clearTimeout?: typeof clearTimeout;
}

/** Request-start monotonic authority. Capabilities never become enumerable object properties. */
export class ManualBackupLeaseFence {
    #client: ManualBackupLeaseOptions["client"];
    #lease: ManualLease;
    #beforeCheck: () => Promise<void>;
    #now: () => number;
    #set: typeof setTimeout;
    #clear: typeof clearTimeout;
    #controller = new AbortController();
    #stopped: Promise<never>;
    #reject!: (error: ExecutionFencedError) => void;
    #reason: ExecutionFenceReason | null = null;
    #started = false;
    #closed = false;
    #proof: number;
    #lastNow = -Infinity;
    #until = 0;
    #deadline: ReturnType<typeof setTimeout> | undefined;
    #heartbeat: ReturnType<typeof setTimeout> | undefined;
    #renewing: Promise<void> | null = null;

    constructor(options: ManualBackupLeaseOptions) {
        try {
            const claim = copyManualClaim(options.claim);
            this.#proof = options.claimStartedAtMono;
            if (typeof this.#proof !== "number" || !Number.isFinite(this.#proof) || this.#proof < 0
                || typeof options.beforeCheck !== "function" || typeof options.client.renew !== "function"
                || typeof options.client.validate !== "function" || (options.now !== undefined && typeof options.now !== "function")) throw 0;
            this.#client = options.client;
            this.#lease = { runId: claim.executionScope.jobId, leaseToken: claim.leaseToken };
            this.#beforeCheck = options.beforeCheck;
            this.#now = options.now ?? (() => performance.now());
            this.#set = options.setTimeout ?? setTimeout;
            this.#clear = options.clearTimeout ?? clearTimeout;
            if (typeof this.#set !== "function" || typeof this.#clear !== "function") throw 0;
        } catch { throw new ExecutionFencedError("uncertain"); }
        this.#stopped = new Promise<never>((_, reject) => { this.#reject = reject; });
        void this.#stopped.catch(() => undefined);
    }

    get signal(): AbortSignal { return this.#controller.signal; }

    start = (): void => {
        if (this.#reason) throw new ExecutionFencedError(this.#reason);
        if (this.#started) return;
        try {
            const now = this.#time();
            if (this.#proof > now) throw new ExecutionFencedError("uncertain");
            this.#started = true;
            this.#until = this.#proof + MANUAL_BACKUP_LEASE_DURATION_MS - 30_000;
            this.#check();
            this.#armDeadline();
            this.#armHeartbeat();
        } catch (error) { throw this.#fail(error); }
    };

    close = (): void => {
        if (this.#closed) return;
        this.#closed = true;
        this.#fail(new ExecutionFencedError("aborted"));
    };

    assertActive = async (documentId?: string): Promise<void> => {
        try {
            this.#check();
            if (this.#renewing) await this.#race(() => this.#renewing!);
            if (this.#until - this.#time() < 60_000) await this.#renew();
            await this.#guard();
            const valid = await this.#race(() => this.#client.validate({ ...this.#lease }, documentId, this.signal));
            if (valid !== undefined) throw new ExecutionFencedError("uncertain");
            await this.#guard();
            this.#check();
        } catch (error) { throw this.#fail(error); }
    };

    #time(): number {
        const now = this.#now();
        if (!Number.isFinite(now) || now < 0 || now < this.#lastNow) throw new ExecutionFencedError("uncertain");
        this.#lastNow = now;
        return now;
    }
    #check(): void {
        if (this.#reason) throw new ExecutionFencedError(this.#reason);
        if (!this.#started || this.#closed) throw new ExecutionFencedError("aborted");
        if (this.#time() >= this.#until) throw this.#fail(new ExecutionFencedError("lease-lost"));
    }
    #fail(error: unknown): ExecutionFencedError {
        if (this.#reason === null) {
            let reason: ExecutionFenceReason = "uncertain";
            try {
                if (error instanceof ExecutionFencedError && ["lease-lost", "source-changed", "aborted", "uncertain"].includes(error.reason)) reason = error.reason;
                else if (error instanceof ManualControlFailure) {
                    if (["LEASE_LOST", "NOT_FOUND"].includes(error.code)) reason = "lease-lost";
                    else if (error.code === "SOURCE_CHANGED") reason = "source-changed";
                }
            } catch { /* Foreign error properties never escape. */ }
            this.#reason = reason;
            this.#clear(this.#deadline); this.#clear(this.#heartbeat);
            this.#deadline = undefined; this.#heartbeat = undefined;
            this.#reject(new ExecutionFencedError(reason));
            this.#controller.abort();
        }
        return new ExecutionFencedError(this.#reason);
    }
    async #race<T>(work: () => Promise<T>): Promise<T> {
        this.#check();
        const result = await Promise.race([Promise.resolve().then(() => { this.#check(); return work(); }), this.#stopped]);
        this.#check();
        return result;
    }
    async #guard(): Promise<void> {
        const valid = await this.#race(() => this.#beforeCheck());
        if (valid !== undefined) throw new ExecutionFencedError("uncertain");
        this.#check();
    }
    #armDeadline(): void {
        this.#clear(this.#deadline);
        this.#deadline = this.#set(() => {
            try { this.#check(); this.#armDeadline(); }
            catch (error) { this.#fail(error); }
        }, Math.max(0, this.#until - this.#time()));
    }
    #armHeartbeat(): void {
        if (this.#reason || this.#closed) return;
        this.#heartbeat = this.#set(() => { void this.#renew().catch(error => { this.#fail(error); }); }, 30_000);
    }
    #renew(): Promise<void> {
        if (this.#renewing) return this.#renewing;
        const work = (async () => {
            try {
                await this.#guard();
                const requestStart = this.#time();
                const result = await this.#race(() => this.#client.renew({ ...this.#lease }, this.signal));
                // Do not extend authority if the old proof expired while the reply/guard was pending.
                await this.#guard();
                expiry.parse(JSON.parse(canonicalJson(result)));
                this.#until = requestStart + MANUAL_BACKUP_LEASE_DURATION_MS - 30_000;
                this.#check();
                this.#armDeadline();
            } catch (error) { throw this.#fail(error); }
        })();
        this.#renewing = work;
        void work.then(() => {
            this.#renewing = null;
            this.#clear(this.#heartbeat);
            this.#armHeartbeat();
        }, () => { this.#renewing = null; });
        return work;
    }
}
