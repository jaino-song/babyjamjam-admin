"use client";

import { useState } from "react";
import {
    Dialog,
    DialogContent,
    DialogHeader,
    DialogTitle,
    DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";

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
        <Dialog open={open} onOpenChange={handleClose}>
            <DialogContent className="sm:max-w-md">
                <DialogHeader>
                    <DialogTitle className="flex items-center justify-between">
                        어떤 점이 불만족스러우셨나요?
                    </DialogTitle>
                </DialogHeader>
                <div className="py-4">
                    <Textarea
                        autoFocus
                        rows={4}
                        placeholder="피드백을 입력해주세요..."
                        value={comment}
                        onChange={(e: React.ChangeEvent<HTMLTextAreaElement>) => setComment(e.target.value)}
                        className="resize-none"
                    />
                </div>
                <DialogFooter>
                    <Button variant="outline" onClick={handleClose}>
                        취소
                    </Button>
                    <Button onClick={handleSubmit} disabled={!comment.trim()}>
                        제출
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}
