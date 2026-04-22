import { copyFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const scriptDir = dirname(fileURLToPath(import.meta.url));
const frontendRoot = resolve(scriptDir, "..");
const sourcePath = resolve(frontendRoot, "node_modules/@rhwp/core/rhwp_bg.wasm");
const targetPath = resolve(frontendRoot, "public/vendor/rhwp/rhwp_bg.wasm");

await mkdir(dirname(targetPath), { recursive: true });
await copyFile(sourcePath, targetPath);

console.log(`Copied rhwp WASM to ${targetPath}`);
