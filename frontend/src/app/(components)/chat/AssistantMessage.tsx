"use client";

import { Box, Avatar } from "@mui/material";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { CodeBlock } from "./CodeBlock";
import { MarkdownContent } from "./MarkdownContent";
import type { ChatMessage } from "@/app/hooks/useChatStream";

interface AssistantMessageProps {
    message: ChatMessage;
}

export function AssistantMessage({ message }: AssistantMessageProps) {
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
            </Box>
        </Box>
    );
}
