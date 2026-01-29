"use client";

import { useRef, useEffect, useCallback, useLayoutEffect } from "react";
import { useRouter } from "next/navigation";
import {
    Box,
    IconButton,
    Typography,
    Paper,
    CircularProgress,
    Fade,
    Stack,
    Button,
} from "@mui/material";
import ArrowBackIcon from "@mui/icons-material/ArrowBack";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import { ChatInput } from "../(components)/chat/ChatInput";
import { AssistantMessage } from "../(components)/chat/AssistantMessage";
import { useChatStream, ChatMessage, ChatState } from "@/app/hooks/useChatStream";

function UserMessage({ message }: { message: ChatMessage }) {
    return (
        <Box sx={{ display: "flex", justifyContent: "flex-end", mb: 2 }}>
            <Paper
                data-component="user-message-paper"
                elevation={0}
                sx={{
                    maxWidth: "80%",
                    px: 2,
                    py: 1.5,
                    borderRadius: 2,
                    bgcolor: "primary.main",
                    color: "primary.contrastText",
                }}
            >
                <Typography
                    variant="body1"
                    sx={{
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                    }}
                >
                    {message.content}
                </Typography>
            </Paper>
        </Box>
    );
}

function ToolExecutingIndicator({ toolName }: { toolName: string | null }) {
    return (
        <Box
            sx={{
                display: "flex",
                alignItems: "center",
                gap: 1,
                mb: 2,
                px: 2,
            }}
        >
            <CircularProgress size={16} />
            <Typography variant="body2" color="text.secondary">
                {toolName ? `${toolName} 실행 중...` : "처리 중..."}
            </Typography>
        </Box>
    );
}

function StateIndicator({ state }: { state: ChatState }) {
    if (state === "connecting") {
        return (
            <Box sx={{ display: "flex", alignItems: "center", gap: 1, mb: 2, px: 2 }}>
                <CircularProgress size={16} />
                <Typography variant="body2" color="text.secondary">
                    연결 중...
                </Typography>
            </Box>
        );
    }
    return null;
}

export default function ChatPage() {
    const router = useRouter();
    const {
        messages,
        state,
        sendMessage,
        clearSession,
        isToolExecuting,
        currentTool,
        loadHistory,
        isLoadingHistory,
        hasMoreHistory,
    } = useChatStream();

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const prevScrollHeightRef = useRef(0);
    const lastMessageRef = useRef<ChatMessage | null>(null);

    useEffect(() => {
        loadHistory(0);
    }, [loadHistory]);

    const handleScroll = useCallback(() => {
        const container = scrollContainerRef.current;
        if (!container) return;

        if (container.scrollTop < 100 && hasMoreHistory && !isLoadingHistory) {
            prevScrollHeightRef.current = container.scrollHeight;
            loadHistory(messages.length);
        }
    }, [hasMoreHistory, isLoadingHistory, messages.length, loadHistory]);

    useEffect(() => {
        const container = scrollContainerRef.current;
        if (container) {
            container.addEventListener("scroll", handleScroll);
            return () => container.removeEventListener("scroll", handleScroll);
        }
    }, [handleScroll]);

    useLayoutEffect(() => {
        const container = scrollContainerRef.current;
        const lastMessage = messages[messages.length - 1];
        const isNewMessage = lastMessage !== lastMessageRef.current;

        if (!isNewMessage && container && prevScrollHeightRef.current > 0) {
            const diff = container.scrollHeight - prevScrollHeightRef.current;
            if (diff > 0) {
                requestAnimationFrame(() => {
                    container.scrollTop = diff;
                });
            }
            prevScrollHeightRef.current = 0;
        } else if (isNewMessage && messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
        }

        lastMessageRef.current = lastMessage || null;
    }, [messages]);

    const handleBack = () => {
        router.back();
    };

    const handleConfirm = () => {
        sendMessage("확인");
    };

    const handleCancel = () => {
        sendMessage("취소");
    };

    const lastMessage = messages[messages.length - 1];
    const showConfirmButtons =
        lastMessage?.role === "assistant" &&
        !lastMessage.isStreaming &&
        (lastMessage.content.includes("하시겠습니까?") ||
            lastMessage.content.includes("Would you like"));

    return (
        <Box
            data-component="chat-page"
            sx={{
                // Use position fixed to break out of parent layout and fill viewport
                position: "fixed",
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                // Use 100dvh for dynamic viewport height (handles mobile keyboard)
                height: "100dvh",
                display: "flex",
                flexDirection: "column",
                bgcolor: "background.default",
                zIndex: 1200,
            }}
        >
            {/* Header */}
            <Box
                sx={{
                    display: "flex",
                    alignItems: "center",
                    justifyContent: "space-between",
                    px: 2,
                    py: 1.5,
                    borderBottom: 1,
                    borderColor: "divider",
                    bgcolor: "background.paper",
                    flexShrink: 0,
                }}
            >
                <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                    <IconButton onClick={handleBack} size="small" edge="start">
                        <ArrowBackIcon />
                    </IconButton>
                    <AutoAwesomeIcon color="primary" />
                    <Typography variant="h6" fontWeight={600}>
                        AI 어시스턴트
                    </Typography>
                </Box>
                <IconButton onClick={clearSession} size="small">
                    <DeleteOutlineIcon />
                </IconButton>
            </Box>

            {/* Messages Area */}
            <Box
                ref={scrollContainerRef}
                sx={{
                    flex: 1,
                    overflow: "auto",
                    px: { xs: 2, sm: 4 },
                    py: 3,
                    userSelect: "text",
                    WebkitUserSelect: "text",
                    MozUserSelect: "text",
                    // Smooth scroll for iOS
                    WebkitOverflowScrolling: "touch",
                }}
            >
                {isLoadingHistory && messages.length > 0 && (
                    <Box sx={{ display: "flex", justifyContent: "center", p: 2 }}>
                        <CircularProgress size={20} />
                    </Box>
                )}
                {messages.length === 0 ? (
                    <Fade in>
                        <Box
                            sx={{
                                display: "flex",
                                flexDirection: "column",
                                alignItems: "center",
                                justifyContent: "center",
                                height: "100%",
                                textAlign: "center",
                                color: "text.secondary",
                            }}
                        >
                            <AutoAwesomeIcon sx={{ fontSize: 48, mb: 2, opacity: 0.5 }} />
                            <Typography variant="h6" gutterBottom>
                                무엇을 도와드릴까요?
                            </Typography>
                            <Typography variant="body2">
                                고객 검색, 직원 관리, 계약서 발송 등을 도와드립니다.
                            </Typography>
                        </Box>
                    </Fade>
                ) : (
                    <>
                        {messages.map((msg, idx) =>
                            msg.role === "user" ? (
                                <UserMessage key={idx} message={msg} />
                            ) : (
                                <AssistantMessage key={idx} message={msg} />
                            )
                        )}
                        {isToolExecuting && <ToolExecutingIndicator toolName={currentTool} />}
                        <StateIndicator state={state} />
                        {showConfirmButtons && (
                            <Stack direction="row" spacing={1} sx={{ mb: 2, px: 2 }}>
                                <Button
                                    variant="contained"
                                    size="small"
                                    onClick={handleConfirm}
                                    disabled={state === "streaming"}
                                >
                                    확인
                                </Button>
                                <Button
                                    variant="outlined"
                                    size="small"
                                    onClick={handleCancel}
                                    disabled={state === "streaming"}
                                >
                                    취소
                                </Button>
                            </Stack>
                        )}
                        <div ref={messagesEndRef} />
                    </>
                )}
            </Box>

            {/* Input Area */}
            <Box
                sx={{
                    px: { xs: 2, sm: 4 },
                    py: 2,
                    borderTop: 1,
                    borderColor: "divider",
                    bgcolor: "background.paper",
                    flexShrink: 0,
                }}
            >
                <ChatInput
                    onSubmit={sendMessage}
                    disabled={state === "streaming" || state === "connecting"}
                    compact={false}
                />
            </Box>
        </Box>
    );
}
