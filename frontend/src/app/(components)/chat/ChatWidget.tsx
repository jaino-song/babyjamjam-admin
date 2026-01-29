"use client";

import { useRouter } from "next/navigation";
import { Box } from "@mui/material";
import { ChatInput } from "./ChatInput";

export function ChatWidget() {
    const router = useRouter();

    const handleOpenChat = () => {
        router.push("/chat");
    };

    return (
        <Box sx={{ mt: 3 }}>
            <ChatInput
                onSubmit={handleOpenChat}
                onFocus={handleOpenChat}
                placeholder="무엇을 도와드릴까요?"
            />
        </Box>
    );
}

