import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

// Every file that renders markdown must use the safe link/img overrides
// (BJJ-352): model-authored markdown reaches chat, legacy chat and the admin
// chat-history viewers, and a plain ReactMarkdown renders live external
// links and <img> (a zero-click exfiltration channel).
const SRC = join(__dirname, "../../../");
const SAFE_MARKERS = ["AGENT_SAFE_MARKDOWN_LINK_COMPONENTS", "AGENT_TEXT_MARKDOWN_COMPONENTS"];
const REACT_MARKDOWN_IMPORT = /from\s+["']react-markdown["']/;

function sourceFiles(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) return name === "node_modules" ? [] : sourceFiles(path);
        return /\.tsx?$/.test(name) && !/\.test\.tsx?$/.test(name) ? [path] : [];
    });
}

describe("markdown surfaces", () => {
    const renderers = sourceFiles(SRC).filter((path) => REACT_MARKDOWN_IMPORT.test(readFileSync(path, "utf8")));

    it("finds the markdown renderers (guards against a vacuous scan)", () => {
        expect(renderers.length).toBeGreaterThan(1);
    });

    it("uses the safe link/img overrides in every file that renders react-markdown", () => {
        const unsafe = renderers
            .filter((path) => !SAFE_MARKERS.some((marker) => readFileSync(path, "utf8").includes(marker)))
            .map((path) => relative(SRC, path));
        expect(unsafe).toEqual([]);
    });
});
