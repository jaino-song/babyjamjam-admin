import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

const mobileRoot = process.cwd();
const repositoryRoot = path.resolve(mobileRoot, "..");
const providerPath = path.join(
  mobileRoot,
  "src/components/app/root/mobile-shell-providers.tsx",
);
const serviceRecordLayoutPath = path.join(
  mobileRoot,
  "src/app/(public)/service-record/[token]/layout.tsx",
);
const manifestPath = path.join(
  repositoryRoot,
  "docs/design-system/component-manifest.json",
);

function productionSourceFiles(directory: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const entryPath = path.join(directory, entry.name);

    if (entry.isDirectory()) {
      return productionSourceFiles(entryPath);
    }

    if (
      !entry.name.match(/\.(?:ts|tsx)$/) ||
      entry.name.match(/\.(?:test|spec)\.(?:ts|tsx)$/) ||
      entryPath.includes(`${path.sep}__tests__${path.sep}`)
    ) {
      return [];
    }

    return [entryPath];
  });
}

describe("mobile shell Toaster registration", () => {
  it("registers the reusable Toaster in the mobile design-system manifest", () => {
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
    const entries = manifest.components.mobile.filter(
      (entry: { name?: string }) => entry.name === "Toaster",
    );

    expect(entries).toEqual([
      expect.objectContaining({
        name: "Toaster",
        import: "@/components/ui/toaster",
        file: "mobile/src/components/ui/toaster.tsx",
        exports: ["Toaster", "ToastAction"],
      }),
    ]);
  });

  it("mounts Toaster exactly twice: the shell root and the public service-record route", () => {
    const providerSource = readFileSync(providerPath, "utf8");
    const importMatches = providerSource.match(
      /import\s*\{\s*Toaster\s*\}\s*from\s*["']@\/components\/ui\/toaster["']/g,
    );
    const providerMounts = providerSource.match(/<Toaster\s*\/>/g);
    const serviceRecordLayoutSource = readFileSync(serviceRecordLayoutPath, "utf8");
    const serviceRecordMounts = serviceRecordLayoutSource.match(/<Toaster\s*\/>/g);
    const allProductionMounts = productionSourceFiles(
      path.join(mobileRoot, "src"),
    ).flatMap((sourcePath) => {
      const source = readFileSync(sourcePath, "utf8");
      return (source.match(/<Toaster\s*\/>/g) ?? []).map(() => sourcePath);
    });

    expect(importMatches).toHaveLength(1);
    expect(providerMounts).toHaveLength(1);
    expect(serviceRecordMounts).toHaveLength(1);
    expect(allProductionMounts.sort()).toEqual(
      [providerPath, serviceRecordLayoutPath].sort(),
    );
  });
});
