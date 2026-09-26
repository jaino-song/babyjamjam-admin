"use client";

import ReactMarkdown, { type Components, type Options as ReactMarkdownOptions } from "react-markdown";
import remarkGfm from "remark-gfm";
import { AGENT_SAFE_MARKDOWN_LINK_COMPONENTS } from "./agent-markdown-link-components";

type RemarkPlugins = ReactMarkdownOptions["remarkPlugins"];

/**
 * Shared markdown rendering primitive for chat surfaces (legacy assistant
 * messages and the AgentShell part registry). Callers supply their own
 * `components` overrides (e.g. legacy's syntax-highlighted code blocks, the
 * agent registry's locked-down link/image handling) which are merged on top
 * of the table-wrapper override every chat surface needs. Callers may also
 * append extra remark plugins (e.g. the agent registry's line-break plugin)
 * without changing the default behaviour for callers that don't pass any.
 */

const CHAT_MARKDOWN_REMARK_PLUGINS: RemarkPlugins = [remarkGfm];

// Model-authored markdown: the safe link/img overrides are part of the base,
// so a caller that forgets them still never renders a live external link or
// an <img>.
const CHAT_MARKDOWN_BASE_COMPONENTS: Components = {
    ...AGENT_SAFE_MARKDOWN_LINK_COMPONENTS,
    table: ({ children }) => (
        <div className="table-wrapper">
            <table>{children}</table>
        </div>
    ),
};

interface ChatMarkdownProps {
    children: string;
    components?: Components;
    remarkPlugins?: RemarkPlugins;
}

export function ChatMarkdown({ children, components, remarkPlugins }: ChatMarkdownProps) {
    return (
        <ReactMarkdown
            remarkPlugins={remarkPlugins ?? CHAT_MARKDOWN_REMARK_PLUGINS}
            components={{ ...CHAT_MARKDOWN_BASE_COMPONENTS, ...components }}
        >
            {children}
        </ReactMarkdown>
    );
}
