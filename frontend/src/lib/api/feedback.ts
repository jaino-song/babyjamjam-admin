export interface FeedbackData {
    sessionId: string;
    messageId: string;
    type: "positive" | "negative";
    comment?: string;
}

export interface FeedbackSubmissionFailure extends Error {
    status: number;
    code?: string;
}

function readResponseCode(body: unknown): string | undefined {
    if (!body || typeof body !== "object" || Array.isArray(body)) return undefined;
    const code = (body as { code?: unknown }).code;
    return typeof code === "string" && code.length > 0 ? code : undefined;
}

export async function submitFeedback(data: FeedbackData): Promise<{ success: boolean }> {
    const response = await fetch("/api/ai/chat/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
    });

    if (!response.ok) {
        // Surface the registered problem code for downstream comparison;
        // never interpolate the raw status into a user-facing message.
        const body: unknown = await response.json().catch(() => null);
        const failure = new Error("Feedback submission failed") as FeedbackSubmissionFailure;
        failure.status = response.status;
        const code = readResponseCode(body);
        if (code !== undefined) {
            failure.code = code;
        }
        throw failure;
    }

    return response.json();
}
