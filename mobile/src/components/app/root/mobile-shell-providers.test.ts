import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";

import { useQueryClient } from "@tanstack/react-query";
import { render } from "@testing-library/react";
import { useEffect } from "react";

import type { AuthUser } from "@/hooks/useGetAuthUser";
import { MobileShellProviders } from "@/components/app/root/mobile-shell-providers";
import { useInitialUser } from "@/providers/UserProvider";

// The probe stands in for the real subscription: it reads the same two
// contexts the real component needs, so it only observes them when the shell
// mounts it inside both providers.
const mockProbe = jest.fn<void, [{ queryClient: unknown; user: unknown }]>();
const mockMounts = jest.fn();

jest.mock("@/components/app/realtime/RealtimeInvalidation", () => ({
  RealtimeInvalidation: () => {
    const queryClient = useQueryClient();
    const user = useInitialUser();
    mockProbe({ queryClient, user });
    useEffect(() => {
      mockMounts();
    }, []);
    return null;
  },
}));

// Siblings of the subscription are irrelevant here and pull in app-wide hooks.
jest.mock("@/components/app/root/contracts-prefetch-coordinator", () => ({ ContractsPrefetchCoordinator: () => null }));
jest.mock("@/components/app/v3/FloatingQuickActions", () => ({ FloatingQuickActions: () => null }));
jest.mock("@/components/app/root/mobile-bottom-nav", () => ({ MobileBottomNav: () => null }));
jest.mock("@/components/app/notification-permission-prompt", () => ({ NotificationPermissionPrompt: () => null }));
jest.mock("@/components/app/v3/V3MainContent", () => ({ V3MainContent: () => null }));
jest.mock("@/components/app/v3/V3MobileHeader", () => ({ V3MobileHeader: () => null }));
jest.mock("@/components/app/v3/V3Sidebar", () => ({ V3Sidebar: () => null }));
jest.mock("@/components/ui/toaster", () => ({ Toaster: () => null }));
jest.mock("@/components/app/ui/OfflineNotice", () => ({ OfflineNotice: () => null }));
jest.mock("@/lib/auth/cookies", () => ({ getCurrentUser: jest.fn() }));

const mobileRoot = process.cwd();
const repositoryRoot = path.resolve(mobileRoot, "..");
const providerPath = path.join(
  mobileRoot,
  "src/components/app/root/mobile-shell-providers.tsx",
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
        exports: ["Toaster"],
      }),
    ]);
  });

  it("mounts Toaster exactly once at the mobile shell root", () => {
    const providerSource = readFileSync(providerPath, "utf8");
    const importMatches = providerSource.match(
      /import\s*\{\s*Toaster\s*\}\s*from\s*["']@\/components\/ui\/toaster["']/g,
    );
    const providerMounts = providerSource.match(/<Toaster\s*\/>/g);
    const allProductionMounts = productionSourceFiles(
      path.join(mobileRoot, "src"),
    ).flatMap((sourcePath) => {
      const source = readFileSync(sourcePath, "utf8");
      return source.match(/<Toaster\s*\/>/g) ?? [];
    });

    expect(importMatches).toHaveLength(1);
    expect(providerMounts).toHaveLength(1);
    expect(allProductionMounts).toHaveLength(1);
  });
});

describe("mobile shell realtime subscription", () => {
  const user = { id: "user-1" } as unknown as AuthUser;

  beforeEach(() => {
    mockProbe.mockClear();
    mockMounts.mockClear();
  });

  it("mounts the realtime subscription exactly once, inside the query and user providers", async () => {
    const shell = await MobileShellProviders({
      children: null,
      locale: "ko",
      userPromise: Promise.resolve(user),
    });

    render(shell);

    expect(mockMounts).toHaveBeenCalledTimes(1);
    expect(mockProbe).toHaveBeenCalled();
    for (const [observed] of mockProbe.mock.calls) {
      expect(observed.queryClient).toBeDefined();
      expect(observed.user).toBe(user);
    }
  });

  it("references the subscription exactly once in the shell source", () => {
    const providerSource = readFileSync(providerPath, "utf8");

    expect(providerSource.match(/<RealtimeInvalidation\s*\/>/g)).toHaveLength(1);
  });
});
