import type { Prisma } from "@prisma/client";

export type ServiceRecordCaseTarget =
    | { kind: "missing" }
    | { kind: "ambiguous" }
    | { kind: "retired"; caseId: string; babyId: string }
    | {
        kind: "resolved";
        caseId: string;
        babyId: string | null;
        ordinal: number | null;
        rank: number | null;
        babyCount: number | null;
    };

interface CaseTargetScope {
    branchId: string;
    clientId: number;
    caseId?: string;
}

const UUID = /^[\da-f]{8}(?:-[\da-f]{4}){3}-[\da-f]{12}$/i;

/** 케이스 대상만 조회한다. 쓰기 잠금과 확정·보관 정책은 호출자가 적용한다. */
export async function resolveServiceRecordCaseTarget(
    tx: Prisma.TransactionClient,
    { branchId, clientId, caseId }: CaseTargetScope,
): Promise<ServiceRecordCaseTarget> {
    const explicit = caseId !== undefined;
    if (!UUID.test(branchId) || (explicit && !UUID.test(caseId))) return { kind: "missing" };

    const liveClient = { id: clientId, branchId, deletedAt: null };
    const client = await tx.client.findFirst({
        where: liveClient,
        select: { fetalConfirmation: true },
    });
    if (!client) return { kind: "missing" };

    // Two rows are enough to detect ambiguity without loading the entire household.
    const cases = await tx.service_record_case.findMany({
        where: { branchId, clientId, client: liveClient, ...(explicit ? { id: caseId } : {}) },
        select: { id: true, babyId: true },
        take: 2,
    });
    let [recordCase] = cases;
    if (explicit && !recordCase) return { kind: "missing" };

    const babies = await tx.client_baby.findMany({
        where: {
            branchId,
            clientId,
            OR: [{ active: true }, ...(recordCase?.babyId ? [{ id: recordCase.babyId }] : [])],
        },
        select: { id: true, ordinal: true, active: true },
        orderBy: { ordinal: "asc" },
    });
    const activeBabies = babies.filter(({ active }) => active);
    if (!explicit) {
        if (activeBabies.length > 1) return { kind: "ambiguous" };
        if (cases.length > 1) {
            const [activeBaby] = activeBabies;
            if (!activeBaby) return { kind: "ambiguous" };
            const liveCases = await tx.service_record_case.findMany({
                where: { branchId, clientId, client: liveClient, OR: [{ babyId: activeBaby.id }, { babyId: null }] },
                select: { id: true, babyId: true },
                take: 2,
            });
            [recordCase] = liveCases;
            // Unbound history still makes an implicit selection unsafe.
            if (liveCases.length > 1 || recordCase?.babyId === null) return { kind: "ambiguous" };
        }
    }
    if (!recordCase) return { kind: "missing" };

    const { id, babyId } = recordCase;
    const babyCount = client.fetalConfirmation === "CONFIRMED" ? activeBabies.length : null;
    if (babyId === null) {
        return { kind: "resolved", caseId: id, babyId, ordinal: null, rank: null, babyCount };
    }

    const rankIndex = activeBabies.findIndex((baby) => baby.id === babyId);
    const baby = activeBabies[rankIndex];
    if (baby) {
        return { kind: "resolved", caseId: id, babyId, ordinal: baby.ordinal, rank: rankIndex + 1, babyCount };
    }
    if (explicit && babies.some((candidate) => candidate.id === babyId)) {
        return { kind: "retired", caseId: id, babyId };
    }
    return { kind: "missing" };
}
