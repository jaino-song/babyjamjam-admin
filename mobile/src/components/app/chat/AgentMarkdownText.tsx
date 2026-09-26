"use client";

import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkAgentLineBreaks } from "./remarkAgentLineBreaks";
import { AGENT_SAFE_MARKDOWN_LINK_COMPONENTS } from "./agent-markdown-link-components";

const AGENT_MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkAgentLineBreaks];

// The <img>/<a> restrictions (no raw HTML rendering — react-markdown does
// not render mdast "html" nodes unless rehype-raw is added, and it
// deliberately is not here) live in agent-markdown-link-components, shared
// with every other chat surface that renders model/assistant markdown.
const agentMarkdownComponents: Components = {
    ...AGENT_SAFE_MARKDOWN_LINK_COMPONENTS,
    table: ({ children }) => <div className="table-wrapper"><table>{children}</table></div>,
};

type Props = {
    /** Caller-context canonical value for this node. */
    "data-component": string;
    text: string;
};

export function AgentMarkdownText({ "data-component": dataComponent, text }: Props) {
    return (
        <div data-component={dataComponent} data-slot="text" className="markdown-content break-words">
            <ReactMarkdown remarkPlugins={AGENT_MARKDOWN_REMARK_PLUGINS} components={agentMarkdownComponents}>
                {text}
            </ReactMarkdown>
        </div>
    );
}
