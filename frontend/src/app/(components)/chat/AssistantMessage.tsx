"use client";

import { Box, Avatar } from "@mui/material";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";
import { MarkdownContent } from "./MarkdownContent";
import { ToolIndicator } from "./tool-indicator";
import { MessageFeedback } from "./message-feedback";
import type { ChatMessage } from "@/app/hooks/use-chat-stream";

interface AssistantMessageProps {
    message: ChatMessage;
    messageIndex: number;
    sessionId: string | null;
    isToolExecuting?: boolean;
    currentTool?: string | null;
    onSubmitFeedback: (messageIndex: number, type: "positive" | "negative", comment?: string) => Promise<void>;
}

export function AssistantMessage({ 
    message, 
    messageIndex, 
    sessionId, 
    isToolExecuting, 
    currentTool, 
    onSubmitFeedback 
}: AssistantMessageProps) {
    return (
        <Box
            sx={{
                display: "flex",
                gap: 2,
                mb: 3,
                width: "100%",
            }}
        >
            <Avatar
                src="/assets/icon-72.png"
                alt="AI"
                sx={{
                    width: 32,
                    height: 32,
                    flexShrink: 0,
                    mt: 0.5,
                }}
            />

            <Box sx={{ flex: 1, minWidth: 0 }}>
                {isToolExecuting && message.isStreaming && (
                    <ToolIndicator toolName={currentTool || null} isExecuting={true} />
                )}
                <MarkdownContent>
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                            code: ({ className, children, ...props }) => {
                                const match = /language-(\w+)/.exec(className || "");
                                const language = match ? match[1] : "";
                                const codeString = String(children).replace(/\n$/, "");
                                const isCodeBlock = Boolean(language);

                                if (isCodeBlock) {
                                    return <CodeBlock language={language}>{codeString}</CodeBlock>;
                                }

                                return (
                                    <code className={className} {...props}>
                                        {children}
                                    </code>
                                );
                            },
                            table: ({ children }) => (
                                <div className="table-wrapper">
                                    <table>{children}</table>
                                </div>
                            ),
                        }}
                    >
                        {message.content}
                    </ReactMarkdown>

                    {message.isStreaming && (
                        <Box
                            component="span"
                            sx={{
                                display: "inline-block",
                                width: 8,
                                height: 16,
                                bgcolor: "text.primary",
                                ml: 0.5,
                                animation: "blink 1s infinite",
                                "@keyframes blink": {
                                    "0%, 50%": { opacity: 1 },
                                    "51%, 100%": { opacity: 0 },
                                },
                            }}
                        />
                    )}
                </MarkdownContent>
                {!message.isStreaming && (
                    <MessageFeedback
                        messageId={String(messageIndex)}
                        sessionId={sessionId}
                        onSubmitFeedback={(type, comment) => onSubmitFeedback(messageIndex, type, comment)}
                    />
                )}
            </Box>
        </Box>
    );
}
