-- Apply before the kind-aware application. Enable standalone issuance only after all
-- workers run that application. Roll back issuance by disabling it and retaining the
-- kind-aware application and schema for as long as standalone rows exist.
DO $$
BEGIN
    ALTER TABLE "receipt_link_token"
        ADD COLUMN IF NOT EXISTS "kind" TEXT NOT NULL DEFAULT 'contract',
        ADD COLUMN IF NOT EXISTS "frozen_client_name" TEXT,
        ALTER COLUMN "eformsign_doc_id" DROP NOT NULL;

    IF NOT EXISTS (
        SELECT 1 FROM pg_constraint
        WHERE conname = 'receipt_link_token_kind_check'
          AND conrelid = 'receipt_link_token'::regclass
    ) THEN
        ALTER TABLE "receipt_link_token" ADD CONSTRAINT "receipt_link_token_kind_check"
            CHECK (
                ("kind" = 'contract' AND "eformsign_doc_id" IS NOT NULL)
                OR (
                    "kind" = 'standalone'
                    AND "eformsign_doc_id" IS NULL
                    AND "frozen_client_name" IS NOT NULL
                    AND "frozen_client_name" ~ '[^[:space:]]'
                )
            );
    END IF;
END $$;
