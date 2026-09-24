"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";

/**
 * Shared markdown rendering primitive for chat surfaces (legacy assistant
 * messages and the AgentShell part registry). Callers supply their own
 * `components` overrides (e.g. legacy's syntax-highlighted code blocks, the
 * agent registry's locked-down link/image handling) which are merged on top
 * of the table-wrapper override every chat surface needs.
 */

const CHAT_MARKDOWN_REMARK_PLUGINS = [remarkGfm];

const CHAT_MARKDOWN_BASE_COMPONENTS: Components = {
    table: ({ children }) => (
        <div className="table-wrapper">
            <table>{children}</table>
        </div>
    ),
};

interface ChatMarkdownProps {
    children: string;
    components?: Components;
}

export function ChatMarkdown({ children, components }: ChatMarkdownProps) {
    return (
        <ReactMarkdown
            remarkPlugins={CHAT_MARKDOWN_REMARK_PLUGINS}
            components={{ ...CHAT_MARKDOWN_BASE_COMPONENTS, ...components }}
        >
            {children}
        </ReactMarkdown>
    );
}
