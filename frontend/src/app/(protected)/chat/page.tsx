"use client";

import { AgentShell, AgentShellLoading } from "@/components/app/chat/AgentShell";
import { LegacyChatPage } from "@/components/app/chat/LegacyChatPage";
import { InfoCard, PageSection } from "@/components/app/v3";
import { AGENT_DISCOVERY_ERROR_MESSAGE, useAgentShellEnabled } from "@/hooks/useAgentChat";

export default function ChatPage() {
    const agentShellState = useAgentShellEnabled();
    if (agentShellState === "loading") return <AgentShellLoading />;
    if (agentShellState === "discovery-error") {
        // Locally authored safe copy rendered through the design system —
        // discovery failures no longer throw an unregistered Error into the
        // app router boundary.
        return (
            <PageSection name="chat">
                <InfoCard data-component="desktop_chat_discovery-error" title={AGENT_DISCOVERY_ERROR_MESSAGE}>
                    <p>잠시 후 다시 시도해 주세요. 문제가 계속되면 관리자에게 문의해 주세요.</p>
                </InfoCard>
            </PageSection>
        );
    }
    if (agentShellState === "compatibility-off") return <LegacyChatPage />;
    return <AgentShell />;
}
