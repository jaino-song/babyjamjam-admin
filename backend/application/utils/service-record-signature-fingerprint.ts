import { createHash } from "node:crypto";

/** Hash the exact stored UTF-8 string; signature image bytes never enter history responses. */
export function serviceRecordSignatureFingerprint(signature: string | null | undefined): string | null {
    return signature ? createHash("sha256").update(signature, "utf8").digest("hex") : null;
}
