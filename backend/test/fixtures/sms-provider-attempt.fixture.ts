import { MessageLogEntity } from "domain/entities/message-log.entity";
import type { IMessageLogRepository } from "domain/repositories/message-log.repository.interface";

type ProviderAttemptFixture = IMessageLogRepository & {
    readonly rows: readonly MessageLogEntity[];
    readonly startedCount: number;
};

function snapshot(log: MessageLogEntity): MessageLogEntity {
    return Object.assign(Object.create(MessageLogEntity.prototype) as MessageLogEntity, structuredClone(log));
}

export function createSmsProviderAttemptFixture(): ProviderAttemptFixture {
    const attempts = new Map<string, MessageLogEntity>();
    let startedCount = 0;
    const logs = {
        get rows(): readonly MessageLogEntity[] {
            return Array.from(attempts.values(), snapshot);
        },
        get startedCount(): number {
            return startedCount;
        },
        async prepareProviderAttempt(log: MessageLogEntity): Promise<MessageLogEntity> {
            const { providerAcceptanceKey: key, providerAcceptanceFingerprint: fingerprint } = log;
            if (!key || !fingerprint) throw new Error("SMS provider acceptance key and fingerprint are required before dispatch");
            const existing = attempts.get(key);
            if (existing) {
                if (existing.providerAcceptanceFingerprint !== fingerprint) {
                    throw new Error("SMS provider acceptance fingerprint mismatch");
                }
                return snapshot(existing);
            }

            const stored = Object.assign(snapshot(log), { id: attempts.size + 1 });
            attempts.set(key, stored);
            return snapshot(stored);
        },
        async claimProviderAttempt(log: MessageLogEntity): Promise<MessageLogEntity | null> {
            const { providerAcceptanceKey: key, providerAcceptanceFingerprint: fingerprint } = log;
            if (!key || !fingerprint) throw new Error("SMS provider acceptance key and fingerprint are required before dispatch");
            const stored = attempts.get(key);
            if (!stored || stored.id !== log.id || stored.branchId !== log.branchId
                || stored.providerAcceptanceFingerprint !== fingerprint || stored.providerAcceptanceState !== "prepared") {
                return null;
            }

            stored.markProviderCallStarted();
            startedCount += 1;
            return snapshot(stored);
        },
        async update(log: MessageLogEntity): Promise<MessageLogEntity> {
            const { providerAcceptanceKey: key } = log;
            const stored = key ? attempts.get(key) : undefined;
            if (!key || !stored || stored.id !== log.id || stored.branchId !== log.branchId
                || stored.providerAcceptanceFingerprint !== log.providerAcceptanceFingerprint) {
                throw new Error("SMS provider attempt was not found");
            }

            const updated = snapshot(log);
            updated.markCarrierCheckPersisted();
            attempts.set(key, updated);
            return snapshot(updated);
        },
    };

    // These callers exercise only the provider-attempt methods of the repository.
    return logs as ProviderAttemptFixture;
}
