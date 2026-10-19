-- Generated with Prisma migrate diff; idempotent for the database-patches workflow.
-- Tombstone marker for a deleted client that still has history (고객-06). A non-null value
-- hides the row from every client list, search and lookup; the row stays for history joins.
-- AlterTable
ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "deleted_at" TIMESTAMPTZ(6);
