"use client";

import { isValidElement, type ReactNode } from "react";
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
// - same-origin relative paths (starting with "/") are the only hrefs ever
//   rendered as real (same-tab) anchors. An external href (http(s) to
//   another host, or any other scheme react-markdown's urlTransform did not
//   already strip) is never a clickable anchor with a model-chosen label —
//   that hides where the click actually goes (e.g. exfiltrating data
//   appended to the URL via a prompt-injected link). Instead it renders as
//   plain text: the label followed by the destination host in parentheses.
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
// Flattens a react-markdown link's children (which may include formatting
// elements like <strong>/<em>) back to plain text, so we can tell whether
// the model wrote the raw URL as its own label.
function extractLinkText(node: ReactNode): string {
    if (node == null || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(extractLinkText).join("");
    if (isValidElement(node)) {
        const props = node.props as { children?: ReactNode };
        return extractLinkText(props?.children);
    }
    return "";
}
// Renders an external link as non-clickable text: the label plus the
// destination host, so the destination is visible without being a click
// away. If the label is already the raw URL, it is shown once, unchanged.
function renderExternalLinkAsText(href: string, children: ReactNode) {
    if (extractLinkText(children).trim() === href.trim()) {
        return <>{children}</>;
    }
    let host = href;
    try {
        host = new URL(href).host || href;
    } catch {
        // Not a parseable absolute URL (e.g. mailto:/tel:); fall back to the raw value.
    }
    return <>{children} ({host})</>;
}

function AgentMarkdownLink({ href, children }: { href?: string; children?: ReactNode }) {
    const url = typeof href === "string" ? href : "";
    if (isSameOriginPath(url)) {
        // prefetch=false: a same-origin link is model-authored and could be
        // prompt-injected. next/link prefetches on render/viewport by default
        // in production, which would fire an authenticated GET with no click.
        return <Link href={url} prefetch={false}>{children}</Link>;
    }
    if (url.length > 0) {
        return renderExternalLinkAsText(url, children);
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
