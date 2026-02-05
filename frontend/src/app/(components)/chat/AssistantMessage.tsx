"use client";

import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { CodeBlock } from "./CodeBlock";
import { MarkdownContent } from "./MarkdownContent";
import { ToolIndicator } from "./tool-indicator";
import { MessageFeedback } from "./message-feedback";
import type { ChatMessage } from "@/app/hooks/useChatStream";

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
        <div className="flex gap-4 mb-6 w-full">
            <Avatar className="w-8 h-8 shrink-0 mt-1">
                <AvatarImage src="/assets/icon-72.png" alt="AI" />
                <AvatarFallback>AI</AvatarFallback>
            </Avatar>

            <div className="flex-1 min-w-0">
                {isToolExecuting && message.isStreaming && (
                    <ToolIndicator toolName={currentTool || null} isExecuting={true} />
                )}
                <MarkdownContent>
                    <ReactMarkdown
                        remarkPlugins={[remarkGfm]}
                        components={{
                            code: ({ className, children, ref: _ref, ...props }) => {
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
                        <span className="inline-block w-2 h-4 bg-foreground ml-1 animate-blink" />
                    )}
                </MarkdownContent>
                {!message.isStreaming && (
                    <MessageFeedback
                        messageId={String(messageIndex)}
                        sessionId={sessionId}
                        onSubmitFeedback={(type, comment) => onSubmitFeedback(messageIndex, type, comment)}
                    />
                )}
            </div>
        </div>
    );
}
