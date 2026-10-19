// Plain Node ESM child of the PDF specs: pdfjs-dist is ESM-only and breaks inside a shared Jest VM
// ("Provided module is not an instance of Module"), so it is only ever loaded in this separate process.
import { readFileSync } from "node:fs";

try {
    const file = process.argv[2];
    if (typeof file !== "string" || file.length === 0) throw new TypeError("missing-file");
    const data = new Uint8Array(readFileSync(file));
    const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
    const document = await pdfjs.getDocument({ data, useSystemFonts: false, isEvalSupported: false }).promise;
    const numPages = document.numPages;
    await document.destroy();
    process.stdout.write(`${JSON.stringify({ numPages })}\n`);
    process.exit(0);
} catch (error) {
    process.stderr.write(`${error instanceof Error ? error.name : "Error"}\n`);
    process.exit(1);
}
