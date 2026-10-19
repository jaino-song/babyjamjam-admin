import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";

import { artifactKey } from "domain/eformsign-backup/worker";

import {
    makeArchive, makeDestination, makeTestBase, publishInput, sha256Of, snapshotTree, streamOf,
} from "./helpers/destination-support";
import { buildMinimalPdf } from "./helpers/pdf-fixture-minimal";

const POINTS = ["write", "file-sync", "publish", "directory-sync", "cleanup"] as const;
const BACKEND_DIR = path.resolve(__dirname, "../../../..");
const pdf = buildMinimalPdf("kill");
const key = artifactKey({ companyId: "C001", documentId: "D001", artifactType: "document", sha256: sha256Of(pdf) });

function runChild(args: string[]): Promise<{ code: number | null; signal: NodeJS.Signals | null }> {
    return new Promise((resolve, reject) => {
        const child = spawn(process.execPath, [
            "-r", "ts-node/register/transpile-only",
            path.join(__dirname, "helpers", "destination-kill-helper.ts"), ...args,
        ], { cwd: BACKEND_DIR, env: { ...process.env, NODE_PATH: "." }, stdio: ["ignore", "ignore", "inherit"] });
        const timer = setTimeout(() => { child.kill("SIGKILL"); reject(new Error("child timed out")); }, 100_000);
        child.once("error", error => { clearTimeout(timer); reject(error); });
        child.once("exit", (code, signal) => { clearTimeout(timer); resolve({ code, signal }); });
    });
}

describe("T-WRK-07: SIGKILL at every publish point", () => {
    let base: string;
    beforeAll(async () => { base = await makeTestBase(); });
    afterAll(async () => { await fs.rm(base, { recursive: true, force: true }); });

    it.each(POINTS)("should never leave a partial final file and should converge on a second publish (kill at %s)", async point => {
        const fixture = await makeArchive(base, { name: `archive-${point}` });
        const { code, signal } = await runChild([fixture.root, String(fixture.dev), String(fixture.ino), point]);
        expect(signal).toBe("SIGKILL");
        expect(code).toBeNull();

        const finalPath = path.join(fixture.root, key);
        const exists = await fs.lstat(finalPath).then(() => true, () => false);
        if (exists) expect((await fs.readFile(finalPath)).equals(pdf)).toBe(true);
        // The final file is published by link(): only from `publish` onward can it exist.
        expect(exists).toBe(point === "cleanup" || point === "directory-sync");

        const leftovers = (await snapshotTree(path.dirname(finalPath))).filter(line => /\.archive-[0-9a-f]+\.tmp\|/.test(line));
        // Allowed and counted, never deleted by the worker: only a kill before cleanup leaves the temp behind.
        expect(leftovers.length).toBe(point === "directory-sync" ? 0 : 1);

        const second = await makeDestination(fixture).publishArtifact(publishInput(pdf), streamOf(pdf));
        expect(second.ok).toBe(true);
        expect(second.ok && second.disposition).toBe(exists ? "reused" : "created");
        expect((await fs.readFile(finalPath)).equals(pdf)).toBe(true);
        expect((await fs.readdir(path.dirname(finalPath))).filter(name => name.endsWith(".pdf"))).toEqual([`${sha256Of(pdf)}.pdf`]);
    }, 120_000);
});
