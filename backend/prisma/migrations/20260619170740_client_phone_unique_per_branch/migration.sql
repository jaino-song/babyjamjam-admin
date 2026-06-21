-- Enforce one client per (branch_id, phone) within a branch.
-- Postgres treats NULLs as distinct in a unique index, so multiple clients
-- with a NULL phone remain allowed; only non-null phones are deduped per branch.
-- NOTE: this CREATE UNIQUE INDEX fails if existing data already has duplicate
-- (branch_id, phone) rows — run a duplicate scan and remediate before applying
-- to an environment with live data (fresh/CI databases are unaffected).

-- CreateIndex
CREATE UNIQUE INDEX "client_branch_phone_key" ON "client"("branch_id", "phone");
