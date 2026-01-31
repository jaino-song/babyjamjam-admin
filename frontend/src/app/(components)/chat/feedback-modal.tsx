"use client";

import { useState } from "react";
import {
    Dialog,
    DialogTitle,
    DialogContent,
    DialogActions,
    TextField,
    Button,
    IconButton,
} from "@mui/material";
import CloseIcon from "@mui/icons-material/Close";

interface FeedbackModalProps {
    open: boolean;
    onClose: () => void;
    onSubmit: (comment: string) => void;
}

export function FeedbackModal({ open, onClose, onSubmit }: FeedbackModalProps) {
    const [comment, setComment] = useState("");

    const handleSubmit = () => {
        if (comment.trim()) {
            onSubmit(comment.trim());
            setComment("");
            onClose();
        }
    };

    const handleClose = () => {
        setComment("");
        onClose();
    };

    return (
        <Dialog open={open} onClose={handleClose} maxWidth="sm" fullWidth>
            <DialogTitle sx={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                어떤 점이 불만족스러우셨나요?
                <IconButton onClick={handleClose} size="small">
                    <CloseIcon />
                </IconButton>
            </DialogTitle>
            <DialogContent>
                <TextField
                    autoFocus
                    multiline
                    rows={4}
                    fullWidth
                    placeholder="피드백을 입력해주세요..."
                    value={comment}
                    onChange={(e) => setComment(e.target.value)}
                    sx={{ mt: 1 }}
                />
            </DialogContent>
            <DialogActions sx={{ px: 3, pb: 2 }}>
                <Button onClick={handleClose} color="inherit">
                    취소
                </Button>
                <Button
                    onClick={handleSubmit}
                    variant="contained"
                    disabled={!comment.trim()}
                >
                    제출
                </Button>
            </DialogActions>
        </Dialog>
    );
}
