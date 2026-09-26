"use client";

import { isValidElement, type ReactNode } from "react";
import Link from "next/link";
import type { Components } from "react-markdown";
import { isSameOriginPath } from "@babyjamjam/shared/utils";

// Model-authored text can contain markdown links/images. Images are a
// zero-click exfiltration channel (a bare URL fetch fires on render), so we
// never render an <img> element — only its alt text. Same-origin absolute
// paths render as real (same-tab) links. An external href (http(s) to
// another host, or any other scheme react-markdown's urlTransform did not
// already strip) is never rendered as a clickable anchor: a model-chosen
// label can carry a destination that hides where the click actually goes
// (e.g. exfiltrating data appended to the URL via a prompt-injected link).
// Instead it renders as plain text — the label followed by the destination
// host in parentheses, so the destination is visible but not clickable
// (unless the label already exposes the destination itself — see
// isLabelAlreadyExposingDestination below).
//
// This module is shared by every surface that renders model/assistant
// markdown in this app: the AgentShell part registry (AgentPartRegistry)
// and every legacy chat renderer (AssistantMessage and any other
// ReactMarkdown/ChatMarkdown usage in this directory). Model output reaches
// legacy chat on every branch that has not been switched to the AgentShell,
// so the same link/image restrictions must apply there too.

/**
 * Same-origin check on the exact href value react-markdown renders (after
 * its urlTransform), resolved the way a browser would: "//host",
 * "/\\host" and similar forms resolve to another origin and are rejected.
 */
export { isSameOriginPath };

// Flattens a react-markdown link's children (which may include formatting
// elements like <strong>/<em>) back to plain text, so we can tell whether
// the model wrote the raw URL (or an equivalent label) as its own label.
export function extractLinkText(node: ReactNode): string {
    if (node == null || typeof node === "boolean") return "";
    if (typeof node === "string" || typeof node === "number") return String(node);
    if (Array.isArray(node)) return node.map(extractLinkText).join("");
    if (isValidElement(node)) {
        const props = node.props as { children?: ReactNode };
        return extractLinkText(props?.children);
    }
    return "";
}

// True when the visible label already tells the reader where the link
// goes, so appending "(host)" would only duplicate what is already shown.
// Covers: the label is the raw href; the label is the href with a
// "mailto:"/"http://"/"https://" prefix stripped (remark-gfm's autolink
// literals render exactly this way, e.g. the email "kim@example.com" as
// href "mailto:kim@example.com" with that same string as its label, and
// "www.x.com/y" as href "http://www.x.com/y" with "www.x.com/y" as its
// label). Only exact matches count: a substring rule ("label contains the
// host") would let a label like "babyjamjam.com" hide the host "m.com".
function isLabelAlreadyExposingDestination(label: string, href: string): boolean {
    const trimmedLabel = label.trim();
    const trimmedHref = href.trim();
    if (trimmedLabel === trimmedHref) return true;
    const strippedHref = trimmedHref.replace(/^(mailto:|https?:\/\/)/i, "");
    if (trimmedLabel === strippedHref) return true;
    return false;
}

// Resolves against two different placeholder bases so protocol-relative
// ("//evil.test/…") values yield their host instead of the full href. A value
// with its own host resolves to the same host under both bases; one without
// (a relative path) takes each base's host, so the two differ. This avoids
// mistaking a real destination for the placeholder.
function destinationHost(href: string): string | null {
    try {
        const first = new URL(href, "https://first.invalid").host;
        const second = new URL(href, "https://second.invalid").host;
        return first && first === second ? first : null;
    } catch {
        return null;
    }
}

// Fallback for hrefs with no host (mailto:, tel:): never show the query or
// fragment, which is where exfiltrated data would sit.
function withoutQueryOrFragment(href: string): string {
    return href.split(/[?#]/, 1)[0];
}

// Renders an external link as non-clickable text: the label plus the
// destination host, so the destination is visible without being a click
// away. If the label already exposes the destination (the raw URL, a gfm
// autolink literal, or the URL without its scheme), it is shown
// once, unchanged, with no redundant "(host)" suffix appended.
export function renderExternalLinkAsText(href: string, children: ReactNode) {
    if (isLabelAlreadyExposingDestination(extractLinkText(children), href)) {
        return <>{children}</>;
    }
    const host = destinationHost(href) ?? withoutQueryOrFragment(href);
    return <>{children} ({host})</>;
}

/**
 * `react-markdown` `components` overrides that every chat surface
 * rendering model/assistant markdown must apply: no real `<img>` (alt text
 * only) and no clickable anchor for anything but a same-origin path.
 * Callers merge this with their own overrides (e.g. `code`/`table`), e.g.
 * `{ ...AGENT_SAFE_MARKDOWN_LINK_COMPONENTS, code: ... }`.
 */
export const AGENT_SAFE_MARKDOWN_LINK_COMPONENTS: Components = {
    img: ({ alt }) => <>{alt ?? ""}</>,
    // `node` is react-markdown's AST node; spreading it would add a junk DOM attribute.
    a: ({ href, children, node: _node, ...props }) => {
        if (typeof href === "string" && isSameOriginPath(href)) {
            // prefetch=false: a same-origin link is model-authored and could be
            // prompt-injected. next/link prefetches on render/viewport by default
            // in production, which would fire an authenticated GET with no click.
            return (
                <Link href={href} prefetch={false} {...props}>
                    {children}
                </Link>
            );
        }
        if (typeof href === "string" && href.length > 0) {
            return renderExternalLinkAsText(href, children);
        }
        return <>{children}</>;
    },
};
