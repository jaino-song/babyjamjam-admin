"use client";

import { useState } from "react";
import { Box } from "@mui/material";
import { ChatInput } from "./ChatInput";
import { ChatFullscreen } from "./ChatFullscreen";

export function ChatWidget() {
    const [isChatOpen, setIsChatOpen] = useState(false);

    const handleOpenChat = () => {
        setIsChatOpen(true);
    };

    const handleCloseChat = () => {
        setIsChatOpen(false);
    };

    return (
        <>
            <Box sx={{ mt: 3 }}>
                <ChatInput
                    onSubmit={handleOpenChat}
                    onFocus={handleOpenChat}
                    placeholder="무엇을 도와드릴까요?"
                />
            </Box>

            <ChatFullscreen open={isChatOpen} onClose={handleCloseChat} />
        </>
    );
}
