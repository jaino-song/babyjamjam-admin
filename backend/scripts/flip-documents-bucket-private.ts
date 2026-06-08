/**
 * One-shot operator script: flip the Supabase `documents` storage bucket to
 * PRIVATE and (optionally) null out legacy permanent public URLs in the DB.
 *
 * WHY THIS EXISTS
 * The adapter now CREATES the bucket private (supabase-storage.adapter.ts:
 * `public: false`) and every read path serves short-lived signed URLs
 * (createSignedUrl, ~300s) — there are zero getPublicUrl callers left. But a
 * bucket created earlier, when the code still passed `public: true`, stays
 * public until explicitly updated. createBucket() will NOT change an existing
 * bucket. This script performs that one-time flip via the Storage admin API.
 *
 * SAFETY
 * - Idempotent: re-running on an already-private bucket is a no-op.
 * - Verifies the result by reading the bucket back; exits non-zero on mismatch.
 * - Reversible: re-run with BUCKET_PUBLIC=1 to set it public again.
 * - The DB null-out (FLIP_NULL_LEGACY_STORAGE_URL=1) only clears stale links;
 *   reads already regenerate signed URLs from storage_path, so it changes no
 *   user-visible behavior. The column drop is a separate migration.
 *
 * RUN (with PROD credentials in env — e.g. a Railway one-off shell):
 *   SUPABASE_URL=... SUPABASE_SERVICE_KEY=... \
 *     pnpm --filter babyjamjam-staff-backend exec ts-node scripts/flip-documents-bucket-private.ts
 *
 * To also null legacy DB URLs, add DATABASE_URL and FLIP_NULL_LEGACY_STORAGE_URL=1.
 * To revert the bucket to public, add BUCKET_PUBLIC=1.
 */
import { createClient } from "@supabase/supabase-js";

const BUCKET = "documents";

async function main(): Promise<void> {
    const url = process.env["SUPABASE_URL"];
    const serviceKey = process.env["SUPABASE_SERVICE_KEY"];
    if (!url || !serviceKey) {
        throw new Error("SUPABASE_URL and SUPABASE_SERVICE_KEY must be set.");
    }

    const targetPublic = process.env["BUCKET_PUBLIC"] === "1";
    const supabase = createClient(url, serviceKey);

    const { error: updateError } = await supabase.storage.updateBucket(BUCKET, {
        public: targetPublic,
    });
    if (updateError) {
        throw new Error(`updateBucket failed: ${updateError.message}`);
    }

    // Read back and verify — never trust the write blindly.
    const { data: bucket, error: getError } = await supabase.storage.getBucket(BUCKET);
    if (getError) {
        throw new Error(`getBucket (verify) failed: ${getError.message}`);
    }
    if (bucket?.public !== targetPublic) {
        throw new Error(
            `Verification failed: bucket "${BUCKET}" public=${bucket?.public}, expected ${targetPublic}.`,
        );
    }
    console.log(`OK: bucket "${BUCKET}" public=${bucket.public}.`);

    if (process.env["FLIP_NULL_LEGACY_STORAGE_URL"] === "1") {
        // Lazy import: only needed for the optional DB cleanup so the bucket
        // flip itself has no Prisma/DATABASE_URL dependency.
        const { PrismaClient } = await import("@prisma/client");
        const prisma = new PrismaClient();
        try {
            const result = await prisma.document.updateMany({
                where: { storageUrl: { not: null } },
                data: { storageUrl: null },
            });
            console.log(`OK: nulled storage_url on ${result.count} legacy document rows.`);
        } finally {
            await prisma.$disconnect();
        }
    }
}

main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
});
