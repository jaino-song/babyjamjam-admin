import { createHash } from "node:crypto";

import type { FileStoragePort } from "../../domain/ports/file-storage.port";
import type { VerifiedTenantPrincipal } from "../tenant/tenant.context";
import { isReceiptPng } from "./standalone-receipt-png";

const TEMPLATE_SHA256 = "ab20ef494186f1bc3d480dcb96facc67c753de72d6d03dc3a7b7fc85f639548f";
const TEMPLATE_NAMESPACE = "standalone-receipt-templates";
const BRANCH_UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export class StandaloneReceiptTemplateUnavailableError extends Error {
    constructor() {
        super("Approved standalone receipt template is unavailable");
        this.name = "StandaloneReceiptTemplateUnavailableError";
    }
}

export class StandaloneReceiptTemplateLoader {
    constructor(private readonly storage: Pick<FileStoragePort, "download">) {}

    /** branchId comes from the verified tenant principal. Object presence in that branch is the allow rule. */
    async load(branchId: VerifiedTenantPrincipal["branchId"]): Promise<Buffer> {
        if (typeof branchId !== "string" || branchId.length !== 36 || !BRANCH_UUID.test(branchId)) {
            throw new StandaloneReceiptTemplateUnavailableError();
        }

        const path = `${TEMPLATE_NAMESPACE}/${branchId.toLowerCase()}/${TEMPLATE_SHA256}.png`;
        let downloaded: Buffer;
        try {
            downloaded = await this.storage.download(path);
        } catch {
            throw new StandaloneReceiptTemplateUnavailableError();
        }

        if (!Buffer.isBuffer(downloaded)) {
            throw new StandaloneReceiptTemplateUnavailableError();
        }
        // Verify the same copy that the renderer will receive.
        const bytes = Buffer.from(downloaded);
        if (createHash("sha256").update(bytes).digest("hex") !== TEMPLATE_SHA256
            || !isReceiptPng(bytes)) {
            throw new StandaloneReceiptTemplateUnavailableError();
        }
        return bytes;
    }
}
