import { Prisma } from "@prisma/client";

const TRANSIENT_PRISMA_CONNECTIVITY_CODES = new Set(["P1001", "P1017", "P2024"]);
const TRANSIENT_PRISMA_MESSAGE_PATTERNS = [
    "Timed out fetching a new connection from the connection pool",
    "Can't reach database server",
    "Server has closed the connection",
];

function toErrorWithMessage(error: unknown): { code?: string; message: string } {
    if (error instanceof Prisma.PrismaClientKnownRequestError) {
        return { code: error.code, message: error.message };
    }

    if (error instanceof Error) {
        const maybeCode = "code" in error && typeof error.code === "string" ? error.code : undefined;
        return { code: maybeCode, message: error.message };
    }

    if (typeof error === "object" && error !== null) {
        const message =
            "message" in error && typeof error.message === "string"
                ? error.message
                : String(error);
        const code = "code" in error && typeof error.code === "string" ? error.code : undefined;
        return { code, message };
    }

    return { message: String(error) };
}

export function getPrismaErrorCode(error: unknown): string | null {
    return toErrorWithMessage(error).code ?? null;
}

export function summarizePrismaError(error: unknown): string {
    const { code, message } = toErrorWithMessage(error);
    const compactMessage = message.replace(/\s+/g, " ").trim();
    return code ? `${code}: ${compactMessage}` : compactMessage;
}

export function isTransientPrismaConnectivityError(error: unknown): boolean {
    const { code, message } = toErrorWithMessage(error);

    if (code && TRANSIENT_PRISMA_CONNECTIVITY_CODES.has(code)) {
        return true;
    }

    return TRANSIENT_PRISMA_MESSAGE_PATTERNS.some((pattern) => message.includes(pattern));
}
