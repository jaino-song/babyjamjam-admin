"use client";

import { useRef, useEffect, useCallback, useLayoutEffect, useState } from "react";
import {
    Box,
    IconButton,
    Typography,
    Paper,
    CircularProgress,
    Fade,
    Slide,
    Stack,
    Button,
    Portal,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import { ChatInput } from "./ChatInput";
import { AssistantMessage } from "./AssistantMessage";
import { useChatStream, ChatMessage, ChatState } from "@/app/hooks/useChatStream";

// Hook to track visual viewport height for mobile keyboard handling
function useVisualViewportHeight() {
    const [height, setHeight] = useState<number | null>(null);

    useEffect(() => {
        // Only run on client side
        if (typeof window === "undefined") return;

        const updateHeight = () => {
            if (window.visualViewport) {
                setHeight(window.visualViewport.height);
            } else {
                setHeight(window.innerHeight);
            }
        };

        // Initial set
        updateHeight();

        // Listen to visual viewport changes (keyboard show/hide)
        if (window.visualViewport) {
            window.visualViewport.addEventListener("resize", updateHeight);
            window.visualViewport.addEventListener("scroll", updateHeight);
        }
        window.addEventListener("resize", updateHeight);

        return () => {
            if (window.visualViewport) {
                window.visualViewport.removeEventListener("resize", updateHeight);
                window.visualViewport.removeEventListener("scroll", updateHeight);
            }
            window.removeEventListener("resize", updateHeight);
        };
    }, []);

    return height;
}

interface ChatFullscreenProps {
    open: boolean;
    onClose: () => void;
}

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

export function ChatFullscreen({ open, onClose }: ChatFullscreenProps) {
    const viewportHeight = useVisualViewportHeight();
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
        if (open) {
            loadHistory(0);
        }
    }, [open, loadHistory]);

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
        <Portal>
            <Slide direction="up" in={open} mountOnEnter unmountOnExit>
                <Box
                    sx={{
                        position: "fixed",
                        top: 0,
                        left: 0,
                        right: 0,
                        // Use dynamic height from visualViewport when available (mobile keyboard handling)
                        // Falls back to bottom: 0 when viewportHeight is null (SSR or initial render)
                        ...(viewportHeight !== null
                            ? { height: `${viewportHeight}px` }
                            : { bottom: 0 }),
                        bgcolor: "background.default",
                        zIndex: 1300,
                        display: "flex",
                        flexDirection: "column",
                        userSelect: "text",
                        WebkitUserSelect: "text",
                        // Smooth transition for keyboard animation
                        transition: "height 0.1s ease-out",
                    }}
                >
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
                        }}
                    >
                        <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                            <AutoAwesomeIcon color="primary" />
                            <Typography variant="h6" fontWeight={600}>
                                AI 어시스턴트
                            </Typography>
                        </Box>
                        <Box>
                            <IconButton onClick={clearSession} size="small" sx={{ mr: 1 }}>
                                <DeleteOutlineIcon />
                            </IconButton>
                            <IconButton onClick={onClose} size="small">
                                <CloseIcon />
                            </IconButton>
                        </Box>
                    </Box>

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

                    <Box
                        sx={{
                            px: { xs: 2, sm: 4 },
                            py: 2,
                            borderTop: 1,
                            borderColor: "divider",
                            bgcolor: "background.paper",
                        }}
                    >
                        <ChatInput
                            onSubmit={sendMessage}
                            disabled={state === "streaming" || state === "connecting"}
                            compact={false}
                        />
                    </Box>
                </Box>
            </Slide>
        </Portal>
    );
}
