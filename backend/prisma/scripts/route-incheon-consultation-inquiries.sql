BEGIN;

CREATE OR REPLACE FUNCTION route_incheon_consultation_inquiries_to_main_branch()
RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  main_branch_id UUID;
  resolved_branch_slug TEXT;
BEGIN
  SELECT id
  INTO main_branch_id
  FROM "branch"
  WHERE "slug" = 'incheon'
  LIMIT 1;

  IF main_branch_id IS NULL THEN
    RETURN NEW;
  END IF;

  IF NEW."public_branch_slug" LIKE 'incheon-%' THEN
    NEW."branch_id" = main_branch_id;
    RETURN NEW;
  END IF;

  IF NEW."branch_id" IS NOT NULL THEN
    SELECT "slug"
    INTO resolved_branch_slug
    FROM "branch"
    WHERE "id" = NEW."branch_id";

    IF resolved_branch_slug LIKE 'incheon-%' THEN
      NEW."branch_id" = main_branch_id;
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS consultation_inquiry_route_incheon_to_main_branch
ON "consultation_inquiry";

CREATE TRIGGER consultation_inquiry_route_incheon_to_main_branch
BEFORE INSERT OR UPDATE OF "branch_id", "public_branch_slug"
ON "consultation_inquiry"
FOR EACH ROW
EXECUTE FUNCTION route_incheon_consultation_inquiries_to_main_branch();

WITH main_branch AS (
  SELECT id
  FROM "branch"
  WHERE "slug" = 'incheon'
  LIMIT 1
),
district_inquiries AS (
  SELECT ci.id
  FROM "consultation_inquiry" ci
  JOIN "branch" b
    ON b.id = ci.branch_id
  WHERE b.slug LIKE 'incheon-%'
)
UPDATE "consultation_inquiry" ci
SET "branch_id" = mb.id
FROM main_branch mb
WHERE ci.id IN (SELECT id FROM district_inquiries)
  AND ci.branch_id <> mb.id;

WITH main_branch AS (
  SELECT id
  FROM "branch"
  WHERE "slug" = 'incheon'
  LIMIT 1
),
district_notification_ids AS (
  SELECT n.id
  FROM "notification" n
  JOIN "branch" b
    ON b.id = n.branch_id
  WHERE b.slug LIKE 'incheon-%'
    AND n.data ->> 'type' = 'consultation-inquiry'
)
UPDATE "notification" n
SET "branch_id" = mb.id
FROM main_branch mb
WHERE n.id IN (SELECT id FROM district_notification_ids)
  AND n.branch_id <> mb.id;

COMMIT;
