-- This migration is also replayed by the database patch workflow.
-- The ALTER TABLE statement is the output of `prisma migrate diff` for the
-- `client.bookingConfirmedAt` field. It is wrapped in a column-existence guard
-- together with a one-time backfill, because the patch workflow re-executes this
-- file on every push: once the column exists, a client with service dates and no
-- confirmation is a legitimate 예약 전 client and must never be backfilled again.
--
-- The backfill leaves a receipt in the column comment. A column that exists
-- WITHOUT the receipt was added some other way (e.g. `prisma db push`) and was
-- never backfilled: every existing client would read as 예약 전. That case fails
-- loudly instead of passing silently.
DO $$
DECLARE
    receipt CONSTANT text := 'backfilled by 20261013000000_add_client_booking_confirmed_at';
    existing_comment text;
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = current_schema()
          AND table_name = 'client'
          AND column_name = 'booking_confirmed_at'
    ) THEN
        -- AlterTable
        ALTER TABLE "client" ADD COLUMN     "booking_confirmed_at" TIMESTAMPTZ(6);

        -- 기존 고객: 날짜가 있거나 이미 중단·교체 요청 상태면 예약 확정된 것으로 본다.
        -- 저장 상태가 '예약 전'인 고객은 날짜가 있어도 미확정으로 둔다.
        UPDATE "client"
        SET "booking_confirmed_at" = "created_at"
        WHERE "service_status" IS DISTINCT FROM 'pre_booking'
          AND (
              ("start_date" IS NOT NULL AND "end_date" IS NOT NULL)
              OR "service_status" IN ('terminated', 'replacement_requested')
          );

        EXECUTE format('COMMENT ON COLUMN "client"."booking_confirmed_at" IS %L', receipt);
    ELSE
        SELECT col_description(a.attrelid, a.attnum)
        INTO existing_comment
        FROM pg_attribute a
        WHERE a.attrelid = to_regclass(format('%I.%I', current_schema(), 'client'))
          AND a.attname = 'booking_confirmed_at'
          AND NOT a.attisdropped;

        IF existing_comment IS DISTINCT FROM receipt THEN
            RAISE EXCEPTION 'client.booking_confirmed_at exists without the backfill receipt'
                USING HINT = 'The column was added outside this migration, so existing clients were never backfilled. '
                    'If no booking has been confirmed through the app yet, run prisma/scripts/rollback-client-booking-confirmed-at.sql '
                    'and re-run this migration; otherwise backfill by hand under review and set the column comment to the receipt.';
        END IF;
    END IF;
END
$$;
