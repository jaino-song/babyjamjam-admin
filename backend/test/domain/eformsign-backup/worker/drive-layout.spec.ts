import {
    ARCHIVE_MARKER_KEY, DRIVE_APP_PROPERTY_ARCHIVE_ID, DRIVE_APP_PROPERTY_BINDING_ID, DRIVE_APP_PROPERTY_INSTALLATION_ID,
    DRIVE_FOLDER_MIME, DRIVE_LAYOUT_REVISION_PREFIX, artifactKey, completionKey, driveDestinationIdentity,
    driveDestinationRevision, driveFolderChain, driveMimeOf, driveNameOf, manifestKey, runKey,
} from "domain/eformsign-backup/worker";

const H = "a".repeat(64);
const BIND = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const RUN = "11111111-1111-4111-8111-111111111111";

describe("drive layout (T16-T18 rule level)", () => {
    it("names the constants exactly", () => {
        expect(DRIVE_FOLDER_MIME).toBe("application/vnd.google-apps.folder");
        expect(DRIVE_LAYOUT_REVISION_PREFIX).toBe("drive-layout-v1:");
        expect([DRIVE_APP_PROPERTY_INSTALLATION_ID, DRIVE_APP_PROPERTY_ARCHIVE_ID, DRIVE_APP_PROPERTY_BINDING_ID])
            .toEqual(["bjjInstallationId", "bjjArchiveId", "bjjBindingId"]);
    });

    it("builds the destination identity and revision from the root id and the binding id", () => {
        expect(driveDestinationIdentity("rootFolder0001")).toBe("drive:rootFolder0001");
        expect(driveDestinationRevision(BIND)).toBe(`drive-layout-v1:${BIND}`);
        for (const bad of ["short", "has space 0123456", "../../root0000", "", "x".repeat(129)]) {
            expect(() => driveDestinationIdentity(bad)).toThrow(expect.objectContaining({ reasonCode: "internal" }));
        }
        for (const bad of ["not-a-uuid", "AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA", "aaaaaaaa-aaaa-1aaa-8aaa-aaaaaaaaaaaa", ""]) {
            expect(() => driveDestinationRevision(bad)).toThrow(expect.objectContaining({ reasonCode: "internal" }));
        }
    });

    it("mirrors an artifact key path for path: every folder prefix, outermost first, without the file name", () => {
        const key = artifactKey({ companyId: "co-1", documentId: "D001", artifactType: "document", sha256: H });
        expect(driveFolderChain(key)).toEqual([
            "eformsign", "eformsign/co-1", "eformsign/co-1/D001", "eformsign/co-1/D001/artifacts", "eformsign/co-1/D001/artifacts/document",
        ]);
        expect(driveNameOf(key)).toBe(`${H}.pdf`);
        expect(driveMimeOf(key)).toBe("application/pdf");
    });

    it("mirrors manifests, completions, runs and the archive marker", () => {
        const manifest = manifestKey({ companyId: "co-1", documentId: "D001", metadataRevision: H, manifestSha256: H });
        expect(driveFolderChain(manifest)).toEqual(["eformsign", "eformsign/co-1", "eformsign/co-1/D001", "eformsign/co-1/D001/manifests"]);
        expect(driveNameOf(manifest)).toBe(`${H}-${H}.json`);
        expect(driveMimeOf(manifest)).toBe("application/json");

        const completion = completionKey({ companyId: "co-1", sequence: 3, contentDigest: H });
        expect(driveFolderChain(completion)).toEqual(["eformsign", "eformsign/co-1", "eformsign/co-1/completions"]);
        expect(driveNameOf(completion)).toBe(`000000000003-${H}.json`);

        const run = runKey({ companyId: "co-1", runId: RUN });
        expect(driveFolderChain(run)).toEqual(["eformsign", "eformsign/co-1", "eformsign/co-1/runs"]);
        expect(driveNameOf(run)).toBe(`${RUN}.json`);
        expect(driveMimeOf(run)).toBe("application/json");

        expect(driveFolderChain(ARCHIVE_MARKER_KEY)).toEqual([".bjj-backup"]);
        expect(driveNameOf(ARCHIVE_MARKER_KEY)).toBe("installation.json");
        expect(driveMimeOf(ARCHIVE_MARKER_KEY)).toBe("application/json");
    });

    it("gives every key a chain whose last folder plus the name rebuilds the key", () => {
        const keys = [
            artifactKey({ companyId: "co", documentId: "D", artifactType: "audit-trail", sha256: H }),
            manifestKey({ companyId: "co", documentId: "D", metadataRevision: H }),
            completionKey({ companyId: "co", sequence: 1, contentDigest: H }),
            runKey({ companyId: "co", runId: RUN }), ARCHIVE_MARKER_KEY,
        ];
        for (const key of keys) {
            const chain = driveFolderChain(key);
            expect(`${chain[chain.length - 1]}/${driveNameOf(key)}`).toBe(key);
            chain.forEach((node, index) => {
                expect(key.startsWith(`${node}/`)).toBe(true);
                expect(node.split("/")).toHaveLength(index + 1);
            });
        }
    });

    it("has no folders for a single-segment key", () => {
        expect(driveFolderChain("loose.json")).toEqual([]);
        expect(driveNameOf("loose.json")).toBe("loose.json");
    });

    it("refuses an unsafe key and an unknown file type instead of mapping it", () => {
        for (const bad of ["", "/abs/key.json", "a//b.json", "a/../b.json", "a/./b.json", "a\\b.json", "a/b\u0000.json", `${"x".repeat(256)}.json`]) {
            expect(() => driveFolderChain(bad)).toThrow(expect.objectContaining({ reasonCode: "invalid-path-segment" }));
            expect(() => driveNameOf(bad)).toThrow(expect.objectContaining({ reasonCode: "invalid-path-segment" }));
            expect(() => driveMimeOf(bad)).toThrow(expect.objectContaining({ reasonCode: "invalid-path-segment" }));
        }
        expect(() => driveMimeOf("eformsign/co/file.txt")).toThrow(expect.objectContaining({ reasonCode: "invalid-path-segment" }));
        expect(() => driveMimeOf("eformsign/co/noextension")).toThrow(expect.objectContaining({ reasonCode: "invalid-path-segment" }));
    });
});
