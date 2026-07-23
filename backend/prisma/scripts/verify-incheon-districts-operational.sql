DO $$
DECLARE
    active_district_count INTEGER;
    hq_name TEXT;
BEGIN
    -- All 8 Incheon district branches must exist and be active.
    SELECT COUNT(*) INTO active_district_count
    FROM "branch"
    WHERE "slug" LIKE 'incheon-%' AND "is_active" = true;

    IF active_district_count <> 8 THEN
        RAISE EXCEPTION 'Expected 8 active Incheon district branches, found %', active_district_count;
    END IF;

    -- The HQ branch (slug "incheon") must be renamed to "인천 아이미래로".
    SELECT "name" INTO hq_name FROM "branch" WHERE "slug" = 'incheon';

    IF hq_name IS NULL THEN
        RAISE EXCEPTION 'HQ branch (slug=incheon) is missing';
    END IF;

    IF hq_name <> '인천 아이미래로' THEN
        RAISE EXCEPTION 'HQ branch name is "%", expected "인천 아이미래로"', hq_name;
    END IF;
END $$;
