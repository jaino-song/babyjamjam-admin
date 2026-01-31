"use client";

import { useRef, useEffect, useCallback, useLayoutEffect, lazy, Suspense, useState } from "react";
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
    Chip,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import AutoAwesomeIcon from "@mui/icons-material/AutoAwesome";
import { ChatInput } from "./ChatInput";
import { AssistantMessage } from "./AssistantMessage";
import { useChatStream, ChatMessage, ChatState } from "@/app/hooks/use-chat-stream";
import { submitFeedback } from "@/lib/api/feedback";
import { ClientFormDialog } from "../clients/ClientFormDialog";
import { useClient } from "@/app/hooks/useClients";

const ClientRegistrationWizard = lazy(() => import("./ClientRegistrationWizard"));
const ContractSendWizard = lazy(() => import("./ContractSendWizard"));
const ContractStatusWizard = lazy(() => import("./ContractStatusWizard"));

function useVisualViewportHeight() {
    const [height, setHeight] = useState<number | null>(null);

    useEffect(() => {
        if (typeof window === "undefined") return;

        const updateHeight = () => {
            if (window.visualViewport) {
                setHeight(window.visualViewport.height);
            } else {
                setHeight(window.innerHeight);
            }
        };

        updateHeight();

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

function ClientRegistrationSuccessMessage({ 
    message, 
    onEdit 
}: { 
    message: ChatMessage; 
    onEdit: (clientId: number) => void;
}) {
    const clientId = message.ui?.clientId;
    
    return (
        <Box sx={{ display: "flex", justifyContent: "flex-start", mb: 2 }}>
            <Paper
                elevation={0}
                sx={{
                    maxWidth: "80%",
                    px: 2,
                    py: 1.5,
                    borderRadius: 2,
                    bgcolor: "grey.100",
                }}
            >
                <Typography
                    variant="body1"
                    sx={{
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        mb: 1.5,
                    }}
                >
                    {message.content}
                </Typography>
                {clientId && (
                    <Button
                        variant="contained"
                        size="small"
                        onClick={() => onEdit(clientId)}
                    >
                        수정
                    </Button>
                )}
            </Paper>
        </Box>
    );
}

function ContractStatusResponseMessage({ 
    message,
    onSendContract,
}: { 
    message: ChatMessage;
    onSendContract: (clientId: number) => void;
}) {
    const { clientId, documentStatus, serviceStatus } = message.ui || {};
    const showSendButton = !documentStatus && serviceStatus === "active";
    
    return (
        <Box sx={{ display: "flex", justifyContent: "flex-start", mb: 2 }}>
            <Paper
                elevation={0}
                sx={{
                    maxWidth: "80%",
                    px: 2,
                    py: 1.5,
                    borderRadius: 2,
                    bgcolor: "grey.100",
                }}
            >
                <Typography
                    variant="body1"
                    sx={{
                        whiteSpace: "pre-wrap",
                        wordBreak: "break-word",
                        mb: showSendButton ? 1.5 : 0,
                    }}
                >
                    {message.content}
                </Typography>
                {showSendButton && clientId && (
                    <Button
                        variant="contained"
                        size="small"
                        onClick={() => onSendContract(clientId)}
                    >
                        계약서 전송하기
                    </Button>
                )}
            </Paper>
        </Box>
    );
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
        appendMessage,
        sessionId,
    } = useChatStream();

    const messagesEndRef = useRef<HTMLDivElement>(null);
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const prevScrollHeightRef = useRef(0);
    const lastMessageRef = useRef<ChatMessage | null>(null);

    const [editingClientId, setEditingClientId] = useState<number | null>(null);
    const { data: editingClient } = useClient(editingClientId ?? 0);

    const handleEditClient = useCallback((clientId: number) => {
        setEditingClientId(clientId);
    }, []);

    const handleCloseEditDialog = useCallback(() => {
        setEditingClientId(null);
    }, []);

    const handleContractStatusCheck = useCallback((result: {
        clientId: number;
        clientName: string;
        documentStatus: string | null;
        serviceStatus: string | null;
    }) => {
        const { clientName, documentStatus, serviceStatus } = result;
        
        let content: string;
        if (documentStatus === "completed") {
            content = `${clientName} 님의 계약서는 완료되었어요. ✅`;
        } else if (documentStatus === "created" || documentStatus === "requested" || documentStatus === "opened") {
            content = `${clientName} 님의 계약서는 전송되었지만 아직 완료되지 않았어요. 정해진 스케줄대로 완료 요청 알림톡을 보낼게요. 📩`;
        } else if (!documentStatus && serviceStatus === "active") {
            content = `${clientName} 님의 계약서는 전송되지 않았어요. 심지어 이미 서비스가 시작되었네요. 바로 계약서를 전송할까요? ⚠️`;
        } else if (!documentStatus) {
            content = `${clientName} 님의 계약서는 아직 전송되지 않았어요.`;
        } else {
            content = `${clientName} 님의 계약서 상태: ${documentStatus}`;
        }

        appendMessage({
            role: "assistant",
            content,
            timestamp: new Date().toISOString(),
            ui: {
                type: "contractStatusResponse",
                clientId: result.clientId,
                clientName: result.clientName,
                documentStatus: result.documentStatus,
                serviceStatus: result.serviceStatus,
            },
        });
    }, [appendMessage]);

    const handleSendContractFromStatus = useCallback((clientId: number) => {
        sendMessage("계약서 전송");
    }, [sendMessage]);

    const handleSubmitFeedback = useCallback(async (
        messageIndex: number,
        type: "positive" | "negative",
        comment?: string
    ) => {
        if (!sessionId) return;
        await submitFeedback({
            sessionId,
            messageId: String(messageIndex),
            type,
            comment,
        });
    }, [sessionId]);

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

    const shortcuts = ["산모 등록", "계약서 전송", "계약서 상태 조회"] as const;

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
                        bottom: 0,
                        bgcolor: "background.default",
                        zIndex: 1300,
                    }}
                >
                    <Box
                        sx={{
                            position: "absolute",
                            top: 0,
                            left: 0,
                            right: 0,
                            height: viewportHeight !== null ? `${viewportHeight}px` : "100%",
                            display: "flex",
                            flexDirection: "column",
                            userSelect: "text",
                            WebkitUserSelect: "text",
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
                                        ) : msg.ui?.type === "clientRegistrationWizard" ? (
                                            <Box key={idx} sx={{ display: "flex", justifyContent: "flex-start", mb: 3 }}>
                                                <Paper
                                                    elevation={0}
                                                    sx={{
                                                        width: "100%",
                                                        maxWidth: 720,
                                                        p: 2,
                                                        borderRadius: 2,
                                                        border: "1px solid",
                                                        borderColor: "divider",
                                                        bgcolor: "background.paper",
                                                        minHeight: 520,
                                                    }}
                                                >
                                                    <Suspense
                                                        fallback={
                                                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                                                <CircularProgress size={18} />
                                                                <Typography variant="body2" color="text.secondary">
                                                                    불러오는 중...
                                                                </Typography>
                                                            </Box>
                                                        }
                                                    >
                                                        <ClientRegistrationWizard
                                                            onCreated={(client: { id: number; name: string }) => {
                                                                appendMessage({
                                                                    role: "assistant",
                                                                    content: `${client.name} 산모님이 등록되었어요.`,
                                                                    timestamp: new Date().toISOString(),
                                                                    ui: {
                                                                        type: "clientRegistrationSuccess",
                                                                        clientId: client.id,
                                                                        clientName: client.name,
                                                                    },
                                                                });
                                                            }}
                                                        />
                                                    </Suspense>
                                                </Paper>
                                            </Box>
                                        ) : msg.ui?.type === "clientRegistrationSuccess" ? (
                                            <ClientRegistrationSuccessMessage
                                                key={idx}
                                                message={msg}
                                                onEdit={handleEditClient}
                                            />
                                        ) : msg.ui?.type === "contractSendWizard" ? (
                                            <Box key={idx} sx={{ display: "flex", justifyContent: "flex-start", mb: 3 }}>
                                                <Paper
                                                    elevation={0}
                                                    sx={{
                                                        width: "100%",
                                                        maxWidth: 720,
                                                        p: 2,
                                                        borderRadius: 2,
                                                        border: "1px solid",
                                                        borderColor: "divider",
                                                        bgcolor: "background.paper",
                                                        minHeight: 300,
                                                    }}
                                                >
                                                    <Suspense
                                                        fallback={
                                                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                                                <CircularProgress size={18} />
                                                                <Typography variant="body2" color="text.secondary">
                                                                    불러오는 중...
                                                                </Typography>
                                                            </Box>
                                                        }
                                                    >
                                                        <ContractSendWizard />
                                                    </Suspense>
                                                </Paper>
                                            </Box>
                                        ) : msg.ui?.type === "contractStatusWizard" ? (
                                            <Box key={idx} sx={{ display: "flex", justifyContent: "flex-start", mb: 3 }}>
                                                <Paper
                                                    elevation={0}
                                                    sx={{
                                                        width: "100%",
                                                        maxWidth: 720,
                                                        p: 2,
                                                        borderRadius: 2,
                                                        border: "1px solid",
                                                        borderColor: "divider",
                                                        bgcolor: "background.paper",
                                                    }}
                                                >
                                                    <Suspense
                                                        fallback={
                                                            <Box sx={{ display: "flex", alignItems: "center", gap: 1 }}>
                                                                <CircularProgress size={18} />
                                                                <Typography variant="body2" color="text.secondary">
                                                                    불러오는 중...
                                                                </Typography>
                                                            </Box>
                                                        }
                                                    >
                                                        <ContractStatusWizard onCheck={handleContractStatusCheck} />
                                                    </Suspense>
                                                </Paper>
                                            </Box>
                                        ) : msg.ui?.type === "contractStatusResponse" ? (
                                            <ContractStatusResponseMessage
                                                key={idx}
                                                message={msg}
                                                onSendContract={handleSendContractFromStatus}
                                            />
                                        ) : (
                                            <AssistantMessage
                                                key={idx}
                                                message={msg}
                                                messageIndex={idx}
                                                sessionId={sessionId}
                                                isToolExecuting={isToolExecuting && idx === messages.length - 1}
                                                currentTool={currentTool}
                                                onSubmitFeedback={handleSubmitFeedback}
                                            />
                                        )
                                    )}
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
                            <Box
                                sx={{
                                    display: "flex",
                                    gap: 1,
                                    mb: 1.25,
                                    overflowX: { xs: "auto", sm: "visible" },
                                    WebkitOverflowScrolling: "touch",
                                    pb: { xs: 0.5, sm: 0 },
                                    flexWrap: { xs: "nowrap", sm: "wrap" },
                                }}
                            >
                                {shortcuts.map((label) => (
                                    <Chip
                                        key={label}
                                        label={label}
                                        clickable
                                        size="small"
                                        onClick={() => sendMessage(label)}
                                        sx={{
                                            flex: "0 0 auto",
                                            borderRadius: 2,
                                        }}
                                    />
                                ))}
                            </Box>
                            <ChatInput
                                onSubmit={sendMessage}
                                disabled={state === "streaming" || state === "connecting"}
                                compact={false}
                            />
                        </Box>
                    </Box>
                </Box>
            </Slide>

            <ClientFormDialog
                open={editingClientId !== null}
                onClose={handleCloseEditDialog}
                client={editingClient ?? null}
            />
        </Portal>
    );
}
