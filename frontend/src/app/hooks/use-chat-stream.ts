"use client";

import { useState, useCallback, useRef } from "react";

export interface ChatMessage {
    id?: string;
    role: "user" | "assistant";
    content: string;
    timestamp: string;
    isStreaming?: boolean;
    ui?: {
        clientId?: number;
        clientName?: string;
        documentStatus?: string | null;
        serviceStatus?: string | null;
        type: "clientRegistrationWizard" | "clientRegistrationSuccess" | "contractSendWizard" | "contractStatusWizard" | "contractStatusResponse";
    };
}

export interface ChatStreamEvent {
    type: "chunk" | "tool_call" | "confirmation" | "done" | "error";
    content?: string;
    toolName?: string;
    toolStatus?: string;
    confirmationMessage?: string;
    sessionId?: string;
    error?: string;
}

export type ChatState = "idle" | "connecting" | "streaming" | "complete" | "error";

interface UseChatStreamReturn {
    messages: ChatMessage[];
    state: ChatState;
    sessionId: string | null;
    error: string | null;
    sendMessage: (message: string) => Promise<void>;
    loadHistory: (offset?: number) => Promise<void>;
    clearSession: () => void;
    appendMessage: (message: ChatMessage) => void;
    isToolExecuting: boolean;
    currentTool: string | null;
    isLoadingHistory: boolean;
    hasMoreHistory: boolean;
    totalMessages: number;
    retry: () => void;
    canRetry: boolean;
}

const SESSION_STORAGE_KEY = "ai_chat_session_id";

// Map persisted wizard markers back to UI metadata
const WIZARD_MARKERS: Record<string, ChatMessage["ui"]> = {
    "[산모 등록 위자드 표시됨]": { type: "clientRegistrationWizard" },
    "[계약서 전송 위자드 표시됨]": { type: "contractSendWizard" },
    "[계약서 상태 조회 위자드 표시됨]": { type: "contractStatusWizard" },
};

function restoreMessageUI(msg: ChatMessage): ChatMessage {
    if (msg.role !== "assistant") return msg;
    
    const ui = WIZARD_MARKERS[msg.content];
    if (ui) {
        return { ...msg, content: "", ui };
    }
    return msg;
}

function parseSSEChunk(chunk: string): ChatStreamEvent[] {
    const events: ChatStreamEvent[] = [];
    const lines = chunk.split("\n");
    
    let currentData = "";
    
    for (const line of lines) {
        if (line.startsWith("data: ")) {
            currentData = line.slice(6);
        } else if (line === "" && currentData) {
            try {
                const parsed = JSON.parse(currentData);
                events.push(parsed);
            } catch {
            }
            currentData = "";
        }
    }
    
    return events;
}

export function useChatStream(): UseChatStreamReturn {
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [state, setState] = useState<ChatState>("idle");
    const [sessionId, setSessionId] = useState<string | null>(() => {
        if (typeof window !== "undefined") {
            return localStorage.getItem(SESSION_STORAGE_KEY);
        }
        return null;
    });
    const [error, setError] = useState<string | null>(null);
    const [isToolExecuting, setIsToolExecuting] = useState(false);
    const [currentTool, setCurrentTool] = useState<string | null>(null);

    const [isLoadingHistory, setIsLoadingHistory] = useState(false);
    const [hasMoreHistory, setHasMoreHistory] = useState(true);
    const [totalMessages, setTotalMessages] = useState(0);
    const isLoadingRef = useRef<boolean>(false);
    
    const abortControllerRef = useRef<AbortController | null>(null);

    const [retryCount, setRetryCount] = useState(0);
    const [lastMessage, setLastMessage] = useState<string | null>(null);

    const appendMessage = useCallback((message: ChatMessage) => {
        setMessages((prev) => [...prev, message]);
    }, []);

    const persistMessage = useCallback(async (userMessage: string, assistantContent: string) => {
        try {
            await fetch("/api/ai/chat/persist", {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    sessionId,
                    userMessage,
                    assistantContent,
                }),
            });
        } catch (err) {
            console.error("[chat] failed to persist message:", err);
        }
    }, [sessionId]);

    const loadHistory = useCallback(async (offset: number = 0) => {
        if (isLoadingRef.current) return;
        isLoadingRef.current = true;
        setIsLoadingHistory(true);
        try {
            const res = await fetch(`/api/ai/chat/history?offset=${offset}&limit=20`);
            if (!res.ok) {
                console.error("failed to load history:", res.status);
                setHasMoreHistory(false);
                return;
            }
            const data = await res.json();
            const restoredMessages = (data.messages as ChatMessage[]).map(restoreMessageUI);
            if (offset === 0) {
                setMessages(restoredMessages);
                if (data.sessionId) {
                    setSessionId(data.sessionId);
                    localStorage.setItem(SESSION_STORAGE_KEY, data.sessionId);
                }
            } else {
                setMessages((prev) => [...restoredMessages, ...prev]);
            }
            setHasMoreHistory(data.hasMore);
            setTotalMessages(data.total);
        } catch (err) {
            console.error("error loading history:", err);
            setHasMoreHistory(false);
        } finally {
            isLoadingRef.current = false;
            setIsLoadingHistory(false);
        }
    }, []);

    const sendMessage = useCallback(async (message: string) => {
        if (state === "streaming" || state === "connecting") {
            return;
        }

        const trimmed = message.trim();
        if (!trimmed) {
            return;
        }

        // Save message for retry
        setLastMessage(trimmed);

        // Local command intercepts (no SSE call)
        if (trimmed === "산모 등록") {
            const ts = new Date().toISOString();
            setError(null);
            setIsToolExecuting(false);
            setCurrentTool(null);
            setMessages((prev) => [
                ...prev,
                {
                    role: "user",
                    content: trimmed,
                    timestamp: ts,
                },
                {
                    role: "assistant",
                    content: "",
                    timestamp: ts,
                    ui: { type: "clientRegistrationWizard" },
                },
            ]);
            // persist to backend (fire and forget)
            persistMessage(trimmed, "[산모 등록 위자드 표시됨]");
            setState("idle");
            return;
        }

        if (trimmed === "계약서 전송") {
            const ts = new Date().toISOString();
            setError(null);
            setIsToolExecuting(false);
            setCurrentTool(null);
            setMessages((prev) => [
                ...prev,
                {
                    role: "user",
                    content: trimmed,
                    timestamp: ts,
                },
                {
                    role: "assistant",
                    content: "",
                    timestamp: ts,
                    ui: { type: "contractSendWizard" },
                },
            ]);
            // persist to backend (fire and forget)
            persistMessage(trimmed, "[계약서 전송 위자드 표시됨]");
            setState("idle");
            return;
        }

        if (trimmed === "계약서 상태 조회") {
            const ts = new Date().toISOString();
            setError(null);
            setIsToolExecuting(false);
            setCurrentTool(null);
            setMessages((prev) => [
                ...prev,
                {
                    role: "user",
                    content: trimmed,
                    timestamp: ts,
                },
                {
                    role: "assistant",
                    content: "",
                    timestamp: ts,
                    ui: { type: "contractStatusWizard" },
                },
            ]);
            // persist to backend (fire and forget)
            persistMessage(trimmed, "[계약서 상태 조회 위자드 표시됨]");
            setState("idle");
            return;
        }

        setError(null);
        setState("connecting");

        const userMessage: ChatMessage = {
            role: "user",
            content: trimmed,
            timestamp: new Date().toISOString(),
        };
        setMessages((prev) => [...prev, userMessage]);

        const assistantMessage: ChatMessage = {
            role: "assistant",
            content: "",
            timestamp: new Date().toISOString(),
            isStreaming: true,
        };
        setMessages((prev) => [...prev, assistantMessage]);

        abortControllerRef.current = new AbortController();

        try {
            const response = await fetch("/api/ai/chat/stream", {
                method: "POST",
                headers: {
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    sessionId,
                    message: trimmed,
                }),
                credentials: "include",
                signal: abortControllerRef.current.signal,
            });

            if (!response.ok) {
                throw new Error(`HTTP error: ${response.status}`);
            }

            setState("streaming");

            const reader = response.body?.getReader();
            if (!reader) {
                throw new Error("No response body");
            }

            const decoder = new TextDecoder();
            let buffer = "";

            while (true) {
                const { done, value } = await reader.read();
                if (done) break;

                buffer += decoder.decode(value, { stream: true });
                const events = parseSSEChunk(buffer);
                buffer = "";

                for (const event of events) {
                    switch (event.type) {
                        case "chunk":
                            if (event.content) {
                                setMessages((prev) => {
                                    const updated = [...prev];
                                    const lastIdx = updated.length - 1;
                                    if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                        updated[lastIdx] = {
                                            ...updated[lastIdx],
                                            content: updated[lastIdx].content + event.content,
                                        };
                                    }
                                    return updated;
                                });
                            }
                            break;

                        case "tool_call":
                            setIsToolExecuting(true);
                            setCurrentTool(event.toolName || null);
                            break;

                        case "confirmation":
                            setIsToolExecuting(false);
                            setCurrentTool(null);
                            if (event.confirmationMessage) {
                                setMessages((prev) => {
                                    const updated = [...prev];
                                    const lastIdx = updated.length - 1;
                                    if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                        updated[lastIdx] = {
                                            ...updated[lastIdx],
                                            content: event.confirmationMessage || "",
                                            isStreaming: false,
                                        };
                                    }
                                    return updated;
                                });
                            }
                            break;

                        case "done":
                            setIsToolExecuting(false);
                            setCurrentTool(null);
                            if (event.sessionId) {
                                setSessionId(event.sessionId);
                                localStorage.setItem(SESSION_STORAGE_KEY, event.sessionId);
                            }
                            setMessages((prev) => {
                                const updated = [...prev];
                                const lastIdx = updated.length - 1;
                                if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                    updated[lastIdx] = {
                                        ...updated[lastIdx],
                                        isStreaming: false,
                                    };
                                }
                                return updated;
                            });
                            setState("complete");
                            break;

                        case "error":
                            setIsToolExecuting(false);
                            setCurrentTool(null);
                            setError(event.error || "Unknown error");
                            setState("error");
                            setMessages((prev) => {
                                const updated = [...prev];
                                const lastIdx = updated.length - 1;
                                if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                    updated[lastIdx] = {
                                        ...updated[lastIdx],
                                        content: `Error: ${event.error}`,
                                        isStreaming: false,
                                    };
                                }
                                return updated;
                            });
                            break;
                    }
                }
            }

            setState("complete");
            // Reset retry count on success
            setRetryCount(0);
        } catch (err) {
            if (err instanceof Error && err.name === "AbortError") {
                setState("idle");
                return;
            }
            
            const errorMessage = err instanceof Error ? err.message : "Unknown error";
            
            // Auto-retry logic: retry once automatically after 1 second
            if (retryCount < 1) {
                setRetryCount((prev) => prev + 1);
                setMessages((prev) => {
                    const updated = [...prev];
                    const lastIdx = updated.length - 1;
                    if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                        updated[lastIdx] = {
                            ...updated[lastIdx],
                            content: `Error: ${errorMessage}. Retrying...`,
                            isStreaming: false,
                        };
                    }
                    return updated;
                });
                
                // Wait 1 second and retry
                setTimeout(() => {
                    // Remove the error message and retry
                    setMessages((prev) => {
                        const updated = [...prev];
                        if (updated.length >= 2) {
                            updated.pop(); // remove assistant error
                            updated.pop(); // remove user message
                        }
                        return updated;
                    });
                    
                    // Retry by re-triggering the flow
                    setError(null);
                    setState("connecting");

                    const userMessage: ChatMessage = {
                        role: "user",
                        content: trimmed,
                        timestamp: new Date().toISOString(),
                    };
                    setMessages((prev) => [...prev, userMessage]);

                    const assistantMessage: ChatMessage = {
                        role: "assistant",
                        content: "",
                        timestamp: new Date().toISOString(),
                        isStreaming: true,
                    };
                    setMessages((prev) => [...prev, assistantMessage]);

                    abortControllerRef.current = new AbortController();

                    fetch("/api/ai/chat/stream", {
                        method: "POST",
                        headers: {
                            "Content-Type": "application/json",
                        },
                        body: JSON.stringify({
                            sessionId,
                            message: trimmed,
                        }),
                        credentials: "include",
                        signal: abortControllerRef.current.signal,
                    }).then(async (response) => {
                        if (!response.ok) {
                            throw new Error(`HTTP error: ${response.status}`);
                        }

                        setState("streaming");

                        const reader = response.body?.getReader();
                        if (!reader) {
                            throw new Error("No response body");
                        }

                        const decoder = new TextDecoder();
                        let buffer = "";

                        while (true) {
                            const { done, value } = await reader.read();
                            if (done) break;

                            buffer += decoder.decode(value, { stream: true });
                            const events = parseSSEChunk(buffer);
                            buffer = "";

                            for (const event of events) {
                                switch (event.type) {
                                    case "chunk":
                                        if (event.content) {
                                            setMessages((prev) => {
                                                const updated = [...prev];
                                                const lastIdx = updated.length - 1;
                                                if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                                    updated[lastIdx] = {
                                                        ...updated[lastIdx],
                                                        content: updated[lastIdx].content + event.content,
                                                    };
                                                }
                                                return updated;
                                            });
                                        }
                                        break;

                                    case "tool_call":
                                        setIsToolExecuting(true);
                                        setCurrentTool(event.toolName || null);
                                        break;

                                    case "confirmation":
                                        setIsToolExecuting(false);
                                        setCurrentTool(null);
                                        if (event.confirmationMessage) {
                                            setMessages((prev) => {
                                                const updated = [...prev];
                                                const lastIdx = updated.length - 1;
                                                if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                                    updated[lastIdx] = {
                                                        ...updated[lastIdx],
                                                        content: event.confirmationMessage || "",
                                                        isStreaming: false,
                                                    };
                                                }
                                                return updated;
                                            });
                                        }
                                        break;

                                    case "done":
                                        setIsToolExecuting(false);
                                        setCurrentTool(null);
                                        if (event.sessionId) {
                                            setSessionId(event.sessionId);
                                            localStorage.setItem(SESSION_STORAGE_KEY, event.sessionId);
                                        }
                                        setMessages((prev) => {
                                            const updated = [...prev];
                                            const lastIdx = updated.length - 1;
                                            if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                                updated[lastIdx] = {
                                                    ...updated[lastIdx],
                                                    isStreaming: false,
                                                };
                                            }
                                            return updated;
                                        });
                                        setState("complete");
                                        break;

                                    case "error":
                                        setIsToolExecuting(false);
                                        setCurrentTool(null);
                                        setError(event.error || "Unknown error");
                                        setState("error");
                                        setMessages((prev) => {
                                            const updated = [...prev];
                                            const lastIdx = updated.length - 1;
                                            if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                                updated[lastIdx] = {
                                                    ...updated[lastIdx],
                                                    content: `Error: ${event.error}`,
                                                    isStreaming: false,
                                                };
                                            }
                                            return updated;
                                        });
                                        break;
                                }
                            }
                        }

                        setState("complete");
                        setRetryCount(0);
                    }).catch((retryErr) => {
                        if (retryErr instanceof Error && retryErr.name === "AbortError") {
                            setState("idle");
                            return;
                        }
                        
                        const retryErrorMessage = retryErr instanceof Error ? retryErr.message : "Unknown error";
                        setError(retryErrorMessage);
                        setState("error");
                        
                        setMessages((prev) => {
                            const updated = [...prev];
                            const lastIdx = updated.length - 1;
                            if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                                updated[lastIdx] = {
                                    ...updated[lastIdx],
                                    content: `Error: ${retryErrorMessage}`,
                                    isStreaming: false,
                                };
                            }
                            return updated;
                        });
                    });
                }, 1000);
                return;
            }
            
            // After second failure, show error (manual retry needed)
            setError(errorMessage);
            setState("error");
            
            setMessages((prev) => {
                const updated = [...prev];
                const lastIdx = updated.length - 1;
                if (lastIdx >= 0 && updated[lastIdx].role === "assistant") {
                    updated[lastIdx] = {
                        ...updated[lastIdx],
                        content: `Error: ${errorMessage}`,
                        isStreaming: false,
                    };
                }
                return updated;
            });
        }
    }, [sessionId, state, retryCount, persistMessage]);

    const clearSession = useCallback(async () => {
        if (abortControllerRef.current) {
            abortControllerRef.current.abort();
        }

        const currentSessionId = sessionId;
        
        setMessages([]);
        setSessionId(null);
        setState("idle");
        setError(null);
        setIsToolExecuting(false);
        setCurrentTool(null);
        localStorage.removeItem(SESSION_STORAGE_KEY);

        if (currentSessionId) {
            try {
                await fetch(`/api/ai/chat/sessions/${currentSessionId}`, {
                    method: "DELETE",
                });
            } catch (e) {
                console.error("Failed to delete session:", e);
            }
        }
    }, [sessionId]);

    const retry = useCallback(() => {
        if (lastMessage && state === "error") {
            setRetryCount(0);
            setError(null);
            setMessages((prev) => {
                const updated = [...prev];
                if (updated.length >= 2) {
                    updated.pop();
                    updated.pop();
                }
                return updated;
            });
            sendMessage(lastMessage);
        }
    }, [lastMessage, state, sendMessage]);

    return {
        messages,
        state,
        sessionId,
        error,
        sendMessage,
        loadHistory,
        clearSession,
        appendMessage,
        isToolExecuting,
        currentTool,
        isLoadingHistory,
        hasMoreHistory,
        totalMessages,
        retry,
        canRetry: state === "error" && lastMessage !== null,
    };
}
