import { spawn } from "node:child_process";
import path from "node:path";

const BACKEND_DIR = path.resolve(__dirname, "../../../../..");
const SCRIPT = path.join(__dirname, "pdfjs-page-count.mjs");
const TIMEOUT_MS = 30_000;

/**
 * Opens a PDF file with pdfjs in a separate Node process and returns its page count. pdfjs is never imported
 * inside the Jest VM: a spec that shares a Jest worker with others would fail with "not an instance of Module".
 */
export function pdfjsPageCount(filePath: string): Promise<number> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [SCRIPT, filePath], { cwd: BACKEND_DIR, stdio: ["ignore", "pipe", "pipe"] });
        let stdout = "";
        let stderr = "";
        child.stdout.on("data", (chunk: Buffer) => { stdout += chunk.toString(); });
        child.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
        const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("pdfjs child timed out")); }, TIMEOUT_MS);
        child.once("error", (error) => { clearTimeout(timer); reject(error); });
        child.once("exit", (code) => {
            clearTimeout(timer);
            if (code !== 0) return reject(new Error(`pdfjs child failed: ${stderr.trim()}`));
            try {
                const parsed = JSON.parse(stdout) as { numPages?: unknown };
                if (typeof parsed.numPages !== "number") throw new Error("no numPages");
                resolve(parsed.numPages);
            } catch {
                reject(new Error("pdfjs child printed no page count"));
            }
        });
    });
}
