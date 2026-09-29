import { render, screen } from "@testing-library/react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";

import { AGENT_SAFE_MARKDOWN_LINK_COMPONENTS } from "./agent-markdown-link-components";

function renderMarkdown(source: string) {
    return render(
        <ReactMarkdown remarkPlugins={[remarkGfm]} components={AGENT_SAFE_MARKDOWN_LINK_COMPONENTS}>
            {source}
        </ReactMarkdown>,
    );
}

describe("AGENT_SAFE_MARKDOWN_LINK_COMPONENTS", () => {
    it("never renders a real <img>, only its alt text", () => {
        renderMarkdown("![내부 문서](https://evil.test/x.png)");
        expect(document.querySelector("img")).not.toBeInTheDocument();
        expect(screen.getByText("내부 문서")).toBeInTheDocument();
    });

    it("shows only the host for a rejected protocol-relative link", () => {
        renderMarkdown("[계약서](//evil.test/?d=customer-data)");
        expect(document.querySelector("a")).not.toBeInTheDocument();
        expect(document.body.textContent).toContain("계약서 (evil.test)");
        expect(document.body.textContent).not.toContain("customer-data");
    });

    it.each(["https://first.invalid/?d=customer-data", "//second.invalid/?d=customer-data"])(
        "shows only the host even when it matches a resolution placeholder: %s",
        (href) => {
            renderMarkdown(`[계약서](${href})`);
            expect(document.querySelector("a")).not.toBeInTheDocument();
            expect(document.body.textContent).toMatch(/계약서 \((first|second)\.invalid\)/);
            expect(document.body.textContent).not.toContain("customer-data");
        },
    );

    it("drops the query from a hostless destination such as mailto:", () => {
        renderMarkdown("[메일](mailto:kim@example.com?body=customer-data)");
        expect(document.querySelector("a")).not.toBeInTheDocument();
        expect(document.body.textContent).toContain("메일 (mailto:kim@example.com)");
        expect(document.body.textContent).not.toContain("customer-data");
    });

    it.each(["[details](#details)", "[filter](?tab=open)"])(
        "shows only the label when a fragment- or query-only link leaves no destination: %s",
        (markdown) => {
            renderMarkdown(markdown);
            expect(document.querySelector("a")).not.toBeInTheDocument();
            expect(document.body.textContent).not.toContain("()");
        },
    );

    it("keeps a same-origin path as a real anchor", () => {
        renderMarkdown("[내부](/clients/1)");
        expect(screen.getByRole("link", { name: "내부" })).toHaveAttribute("href", "/clients/1");
    });

    it("renders an external link with a distinct label as text plus the destination host", () => {
        renderMarkdown("[계약서 확인](https://evil.test/?d=customer-data)");
        expect(document.querySelector("a")).not.toBeInTheDocument();
        expect(document.body.textContent).toContain("계약서 확인");
        expect(document.body.textContent).toContain("evil.test");
        expect(document.body.textContent).not.toContain("customer-data");
    });

    it("still shows the host when the label merely contains it as a substring", () => {
        renderMarkdown("[babyjamjam.com](https://m.com/x)");
        expect(document.querySelector("a")).not.toBeInTheDocument();
        expect(document.body.textContent).toBe("babyjamjam.com (m.com)");
    });

    it("shows the raw URL once, not duplicated, when the label is the URL itself", () => {
        renderMarkdown("[https://evil.test/x](https://evil.test/x)");
        expect(document.querySelector("a")).not.toBeInTheDocument();
        const occurrences = (document.body.textContent ?? "").split("evil.test").length - 1;
        expect(occurrences).toBe(1);
    });

    // m-e: gfm autolink literals render with a label that is the href minus
    // its "mailto:"/"http://" prefix. Before this fix, that pattern always
    // fell through to the "distinct label" branch and appended a redundant
    // "(host)" suffix, e.g. "kim@example.com (mailto:kim@example.com)".
    it("renders a gfm email autolink's label alone, with no appended mailto: suffix", () => {
        renderMarkdown("kim@example.com");
        expect(document.querySelector("a")).not.toBeInTheDocument();
        const text = document.body.textContent ?? "";
        expect(text).toBe("kim@example.com");
    });

    it("renders a gfm www autolink's label alone, with no appended http:// suffix", () => {
        renderMarkdown("www.example.com/y");
        expect(document.querySelector("a")).not.toBeInTheDocument();
        const text = document.body.textContent ?? "";
        expect(text).toBe("www.example.com/y");
    });

    it("negative control: the pre-fix behaviour would have appended a redundant host suffix to an autolink label", () => {
        // Documents what the vulnerable/annoying display looked like before
        // isLabelAlreadyExposingDestination handled the stripped-prefix case:
        // any label not byte-for-byte equal to the href fell through to the
        // "(host)" suffix branch, even when the label already showed the
        // destination.
        const label = "kim@example.com";
        const href = "mailto:kim@example.com";
        expect(label.trim() === href.trim()).toBe(false); // the old exact-match check misses this case
        const host = new URL(href.replace(/^mailto:/, "http://")).host;
        expect(`${label} (${host})`).toBe("kim@example.com (example.com)"); // the annoying duplicate this fix removes
    });
});
