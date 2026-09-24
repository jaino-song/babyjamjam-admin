// Minimal local remark plugin: a single newline inside a paragraph (or other
// phrasing content) renders as a line break, matching the model's intent
// without pulling in the `remark-breaks` package (not a dependency of this
// app). Splits `text` mdast nodes on "\n" into text + `break` nodes; never
// descends into `code`/`inlineCode` nodes, so fenced code blocks and inline
// code keep their literal newlines untouched.
//
// Local structural types instead of importing `unist`/`mdast` types, which
// are transitive (not direct) dependencies of this app.
type MdastNode = {
    type: string;
    value?: string;
    children?: MdastNode[];
};

function splitTextNode(node: MdastNode): MdastNode[] {
    if (typeof node.value !== "string" || !node.value.includes("\n")) return [node];
    const segments = node.value.split("\n");
    const result: MdastNode[] = [];
    segments.forEach((segment, index) => {
        if (segment.length > 0) result.push({ type: "text", value: segment });
        if (index < segments.length - 1) result.push({ type: "break" });
    });
    return result;
}

function walk(node: MdastNode): void {
    if (node.type === "code" || node.type === "inlineCode") return;
    if (!Array.isArray(node.children)) return;
    const nextChildren: MdastNode[] = [];
    for (const child of node.children) {
        if (child.type === "text") {
            nextChildren.push(...splitTextNode(child));
        } else {
            walk(child);
            nextChildren.push(child);
        }
    }
    node.children = nextChildren;
}

/** remark plugin: turn single newlines in text into hard breaks. */
export function remarkAgentLineBreaks() {
    return (tree: unknown) => {
        walk(tree as MdastNode);
    };
}
