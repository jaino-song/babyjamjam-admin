-- Daily Service Feedback: switch no-login challenge from provider DOB to provider phone.
-- Existing active tokens are preserved by recalculating the expected hash from employee.phone.

CREATE EXTENSION IF NOT EXISTS pgcrypto;

ALTER TABLE "employee_feedback_token"
    RENAME COLUMN "expected_dob_hash" TO "expected_phone_hash";

UPDATE "employee_feedback_token" AS token
SET "expected_phone_hash" = encode(
    digest(regexp_replace(employee."phone", '\D', '', 'g'), 'sha256'),
    'hex'
)
FROM "employee" AS employee
WHERE token."employee_id" = employee."id";
