import { ConflictException } from "@nestjs/common";
import { Prisma } from "@prisma/client";

import { codeOnlyProblemBody } from "application/utils/problem-bodies";

export const BABY_RECORD_ROLLOUT_PAUSED = "지점의 아기별 제공기록지 신규 처리가 중지되었습니다";

export function babyRecordRolloutKey(branchId: string): string {
    return `branch:${branchId}:baby_service_records:enabled`;
}

export async function isBabyRecordRolloutEnabled(
    db: Pick<Prisma.TransactionClient, "system_setting">,
    branchId: string,
): Promise<boolean> {
    if (!branchId) return false;
    const setting = await db.system_setting.findUnique({
        where: { key: babyRecordRolloutKey(branchId) },
        select: { value: true },
    });
    return setting?.value === "true";
}

/**
 * For writers already holding aggregate locks. SHARE locks on the setting
 * coexist across writers, and conflict with the operator's setting upsert.
 * The operator takes the branch advisory lock and writes only this setting.
 * A missing row denies admission, so a missing-row lock is unnecessary.
 */
export async function lockEnabledBabyRecordRollout(tx: Prisma.TransactionClient, branchId: string): Promise<boolean> {
    const [setting] = await tx.$queryRaw<Array<{ value: string }>>`
        SELECT value FROM system_setting WHERE key = ${babyRecordRolloutKey(branchId)} FOR SHARE
    `;
    return setting?.value === "true";
}

export class BabyRecordRolloutPausedException extends ConflictException {
    constructor() {
        super({ ...codeOnlyProblemBody("REQUEST_CONFLICT"), detail: BABY_RECORD_ROLLOUT_PAUSED });
    }
}

export async function requireBabyRecordRollout(tx: Prisma.TransactionClient, branchId: string): Promise<void> {
    if (!await lockEnabledBabyRecordRollout(tx, branchId)) throw new BabyRecordRolloutPausedException();
}

/** Queue eligibility is only a prefilter; writers recheck under their fence. */
export function babyRecordRolloutEnabledSql(branch: Prisma.Sql): Prisma.Sql {
    return Prisma.sql`EXISTS (
        SELECT 1 FROM system_setting rollout
        WHERE rollout.key = 'branch:' || ${branch}::text || ':baby_service_records:enabled'
          AND rollout.value = 'true'
    )`;
}
