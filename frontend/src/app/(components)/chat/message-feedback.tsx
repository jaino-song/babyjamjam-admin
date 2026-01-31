"use client";

import { useState } from "react";
import { Box, IconButton, Tooltip } from "@mui/material";
import ThumbUpIcon from "@mui/icons-material/ThumbUpOutlined";
import ThumbDownIcon from "@mui/icons-material/ThumbDownOutlined";
import ThumbUpFilledIcon from "@mui/icons-material/ThumbUp";
import ThumbDownFilledIcon from "@mui/icons-material/ThumbDown";
import { FeedbackModal } from "./feedback-modal";

interface MessageFeedbackProps {
    messageId: string;
    sessionId: string | null;
    onSubmitFeedback: (type: "positive" | "negative", comment?: string) => Promise<void>;
}

export function MessageFeedback({ messageId, sessionId, onSubmitFeedback }: MessageFeedbackProps) {
    const [feedbackGiven, setFeedbackGiven] = useState<"positive" | "negative" | null>(null);
    const [modalOpen, setModalOpen] = useState(false);
    const [isSubmitting, setIsSubmitting] = useState(false);

    const handleThumbsUp = async () => {
        if (feedbackGiven || isSubmitting) return;
        setIsSubmitting(true);
        try {
            await onSubmitFeedback("positive");
            setFeedbackGiven("positive");
        } finally {
            setIsSubmitting(false);
        }
    };

    const handleThumbsDown = () => {
        if (feedbackGiven || isSubmitting) return;
        setModalOpen(true);
    };

    const handleModalSubmit = async (comment: string) => {
        setIsSubmitting(true);
        try {
            await onSubmitFeedback("negative", comment);
            setFeedbackGiven("negative");
        } finally {
            setIsSubmitting(false);
        }
    };

    return (
        <>
            <Box
                data-testid="message-feedback"
                sx={{
                    display: "flex",
                    gap: 0.5,
                    mt: 1,
                    opacity: feedbackGiven ? 0.5 : 1,
                }}
            >
                <Tooltip title={feedbackGiven === "positive" ? "감사합니다!" : "도움이 됐어요"}>
                    <span>
                        <IconButton
                            data-testid="thumbs-up"
                            size="small"
                            onClick={handleThumbsUp}
                            disabled={feedbackGiven !== null || isSubmitting}
                            sx={{ color: feedbackGiven === "positive" ? "primary.main" : "text.secondary" }}
                        >
                            {feedbackGiven === "positive" ? <ThumbUpFilledIcon fontSize="small" /> : <ThumbUpIcon fontSize="small" />}
                        </IconButton>
                    </span>
                </Tooltip>
                <Tooltip title={feedbackGiven === "negative" ? "피드백 감사합니다" : "개선이 필요해요"}>
                    <span>
                        <IconButton
                            data-testid="thumbs-down"
                            size="small"
                            onClick={handleThumbsDown}
                            disabled={feedbackGiven !== null || isSubmitting}
                            sx={{ color: feedbackGiven === "negative" ? "error.main" : "text.secondary" }}
                        >
                            {feedbackGiven === "negative" ? <ThumbDownFilledIcon fontSize="small" /> : <ThumbDownIcon fontSize="small" />}
                        </IconButton>
                    </span>
                </Tooltip>
            </Box>
            <FeedbackModal
                open={modalOpen}
                onClose={() => setModalOpen(false)}
                onSubmit={handleModalSubmit}
            />
        </>
    );
}
