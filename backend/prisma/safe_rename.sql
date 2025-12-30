-- Safe rename migration: Preserves all data
-- Run this in Supabase SQL Editor

BEGIN;

-- 1. Create new area table first
CREATE TABLE IF NOT EXISTS "area" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "name" TEXT NOT NULL,
  "korean_name" TEXT NOT NULL
);

-- 2. Populate area table from existing data
INSERT INTO "area" ("id", "name", "korean_name")
SELECT DISTINCT "area", "area", "area" FROM "bankAccountInfo"
ON CONFLICT ("id") DO NOTHING;

INSERT INTO "area" ("id", "name", "korean_name")
SELECT DISTINCT "area", "area", "area" FROM "area_template"
ON CONFLICT ("id") DO NOTHING;

-- 3. Rename bankAccountInfo -> bank_account_info
ALTER TABLE "bankAccountInfo" RENAME TO "bank_account_info";
ALTER TABLE "bank_account_info" RENAME COLUMN "area" TO "area_id";
ALTER TABLE "bank_account_info" RENAME COLUMN "bankName" TO "bank_name";
ALTER TABLE "bank_account_info" RENAME COLUMN "accNum" TO "acc_num";

-- 4. Rename voucherPriceInfo -> voucher_price_info
ALTER TABLE "voucherPriceInfo" RENAME TO "voucher_price_info";
ALTER TABLE "voucher_price_info" RENAME COLUMN "fullPrice" TO "full_price";
ALTER TABLE "voucher_price_info" RENAME COLUMN "actualPrice" TO "actual_price";

-- 5. Rename user.kakaoId -> kakao_id
ALTER TABLE "user" RENAME COLUMN "kakaoId" TO "kakao_id";

-- 6. Transform area_template -> doc_template
ALTER TABLE "area_template" RENAME TO "doc_template";
ALTER TABLE "doc_template" RENAME COLUMN "area" TO "area_id";
ALTER TABLE "doc_template" DROP CONSTRAINT IF EXISTS "area_template_pkey";
ALTER TABLE "doc_template" ADD COLUMN "id" TEXT DEFAULT gen_random_uuid()::text;
UPDATE "doc_template" SET "id" = gen_random_uuid()::text WHERE "id" IS NULL;
ALTER TABLE "doc_template" ALTER COLUMN "id" SET NOT NULL;
ALTER TABLE "doc_template" ADD PRIMARY KEY ("id");

-- 7. Add foreign key constraints
ALTER TABLE "bank_account_info"
  ADD CONSTRAINT "bank_account_info_area_id_fkey"
  FOREIGN KEY ("area_id") REFERENCES "area"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

ALTER TABLE "doc_template"
  ADD CONSTRAINT "doc_template_area_id_fkey"
  FOREIGN KEY ("area_id") REFERENCES "area"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

COMMIT;
