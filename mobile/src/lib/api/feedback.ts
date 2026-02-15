export interface FeedbackData {
    sessionId: string;
    messageId: string;
    type: "positive" | "negative";
    comment?: string;
}

export async function submitFeedback(data: FeedbackData): Promise<{ success: boolean }> {
    const response = await fetch("/api/ai/chat/feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
        credentials: "include",
    });

    if (!response.ok) {
        throw new Error(`Feedback submission failed: ${response.status}`);
    }

    return response.json();
}
