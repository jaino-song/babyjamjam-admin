import { PrismaClient } from "@prisma/client";

export function clientLock(prisma: PrismaClient, hooks: { attempted?: () => void; acquired?: () => void; hold?: Promise<void> }) {
    let observed = false;
    return prisma.$extends({ query: { $allOperations: async ({ model, operation, args, query }) => {
        const raw = (Array.isArray(args) ? args[0] : args) as unknown as { strings?: readonly string[]; sql?: string };
        const sql = (raw?.strings?.join(" ") ?? raw?.sql ?? "").toLowerCase();
        const target = !observed && model === undefined && operation === "$queryRaw"
            && /from\s+"?client"?\s/.test(sql) && /for\s+update/.test(sql);
        if (target) { observed = true; hooks.attempted?.(); }
        const result = await query(args);
        if (target) { hooks.acquired?.(); await hooks.hold; }
        return result;
    } } });
}


export async function reached(barrier: Promise<void>, operation: Promise<unknown>) {
    await Promise.race([barrier, operation.then(() => {
        throw new Error("Operation finished without the common client lock");
    })]);
}

