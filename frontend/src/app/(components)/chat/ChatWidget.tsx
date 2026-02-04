"use client";

import { useRouter } from "next/navigation";
import { ChatInput } from "./ChatInput";

export function ChatWidget() {
    const router = useRouter();

    const handleOpenChat = () => {
        router.push("/chat");
    };

    return (
        <div className="mt-6">
            <ChatInput
                onSubmit={handleOpenChat}
                onFocus={handleOpenChat}
                placeholder="무엇을 도와드릴까요?"
            />
        </div>
    );
}
