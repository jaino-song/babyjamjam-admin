import { DRIVE_FILE_ID_PATTERN, UUID_V4_PATTERN, isSafeRelativeKey } from "./schema-fields";
import { WorkerError } from "./worker-error";

/**
 * The Google Drive tree mirrors the local archive path for path under one root folder (BJJ-456 design §7.2):
 * every archive `relativeKey` is a Drive path and each `/`-separated prefix is a folder node. A node is addressed by
 * its prefix string (`eformsign`, `eformsign/<company>`, ...), so the ledger and the destination agree on one name per node.
 * Pure; no I/O.
 */
export const DRIVE_FOLDER_MIME = "application/vnd.google-apps.folder";
export const DRIVE_LAYOUT_REVISION_PREFIX = "drive-layout-v1:";
export const DRIVE_DESTINATION_IDENTITY_PREFIX = "drive:";

/** appProperties keys the worker sets on Drive folders and reads back for discovery (recover, checkRoot). */
export const DRIVE_APP_PROPERTY_INSTALLATION_ID = "bjjInstallationId";
export const DRIVE_APP_PROPERTY_ARCHIVE_ID = "bjjArchiveId";
export const DRIVE_APP_PROPERTY_BINDING_ID = "bjjBindingId";

/** `drive:<rootFolderId>`; fits the ledger `identifier` shape. */
export function driveDestinationIdentity(rootFolderId: string): string {
    if (!DRIVE_FILE_ID_PATTERN.test(rootFolderId)) throw new WorkerError("internal");
    return `${DRIVE_DESTINATION_IDENTITY_PREFIX}${rootFolderId}`;
}

/** `drive-layout-v1:<bindingId>`; the binding id is the uuid v4 minted by drive-setup, `--rebind` or recover. */
export function driveDestinationRevision(bindingId: string): string {
    if (!UUID_V4_PATTERN.test(bindingId)) throw new WorkerError("internal");
    return `${DRIVE_LAYOUT_REVISION_PREFIX}${bindingId}`;
}

/** Whether a destination identity belongs to the Drive destination (the local one is `local:<archiveId>`). */
export function isDriveDestinationIdentity(value: string): boolean {
    return value.startsWith(DRIVE_DESTINATION_IDENTITY_PREFIX);
}

function safeSegments(relativeKey: string): string[] {
    if (!isSafeRelativeKey(relativeKey)) throw new WorkerError("invalid-path-segment");
    return relativeKey.split("/");
}

/** Every folder prefix of the key, outermost first, without the file name. A single-segment key has none. */
export function driveFolderChain(relativeKey: string): string[] {
    const segments = safeSegments(relativeKey);
    const chain: string[] = [];
    for (let end = 1; end < segments.length; end += 1) chain.push(segments.slice(0, end).join("/"));
    return chain;
}

/** The Drive file name: the last segment of the key. */
export function driveNameOf(relativeKey: string): string {
    const segments = safeSegments(relativeKey);
    return segments[segments.length - 1]!;
}

/** `application/pdf` for an artifact, `application/json` for a record; any other file type is not part of the archive layout. */
export function driveMimeOf(relativeKey: string): string {
    const name = driveNameOf(relativeKey);
    if (name.endsWith(".pdf")) return "application/pdf";
    if (name.endsWith(".json")) return "application/json";
    throw new WorkerError("invalid-path-segment");
}
