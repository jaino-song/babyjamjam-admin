"use client";

import type { ReactNode } from "react";
import Link from "next/link";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import { remarkAgentLineBreaks } from "./remarkAgentLineBreaks";

const AGENT_MARKDOWN_REMARK_PLUGINS = [remarkGfm, remarkAgentLineBreaks];

// Agent chat text can come from a model and must be treated as untrusted:
// - no raw HTML (react-markdown does not render mdast "html" nodes unless
//   rehype-raw is added, and it deliberately is not here)
// - no <img> elements at all (an image URL in model text is a zero-click
//   exfiltration channel) — render the alt text only
// - links are only ever rendered as real anchors for http(s) URLs (opened in
//   a new tab) or same-origin relative paths starting with "/"; anything
//   else (javascript:, mailto:, bare text, …) renders as plain text
const HTTP_URL_PATTERN = /^https?:\/\//i;
// Same-origin check on the exact href value react-markdown renders (after its
// urlTransform), resolved the way a browser would: "//host", "/\\host" and
// similar forms resolve to another origin and are rejected.
const SAME_ORIGIN_SENTINEL = "https://same-origin.invalid";
function isSameOriginPath(href: string): boolean {
    if (!href.startsWith("/")) return false;
    try {
        return new URL(href, SAME_ORIGIN_SENTINEL).origin === SAME_ORIGIN_SENTINEL;
    } catch {
        return false;
    }
}

function AgentMarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
    const url = typeof href === "string" ? href : "";
    if (HTTP_URL_PATTERN.test(url)) {
        return <a href={url} target="_blank" rel="noopener noreferrer">{children}</a>;
    }
    if (isSameOriginPath(url)) {
        // prefetch=false: a same-origin link is model-authored and could be
        // prompt-injected. next/link prefetches on render/viewport by default
        // in production, which would fire an authenticated GET with no click.
        return <Link href={url} prefetch={false}>{children}</Link>;
    }
    return <>{children}</>;
}

const agentMarkdownComponents: Components = {
    a: AgentMarkdownLink,
    img: ({ alt }) => <>{alt ?? ""}</>,
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
