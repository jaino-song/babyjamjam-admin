-- This migration is also replayed by the database patch workflow.
-- The ALTER TABLE statement is the output of `prisma migrate diff` for the
-- `client.bookingConfirmedAt` field. It is wrapped in a column-existence guard
-- together with a one-time backfill, because the patch workflow re-executes this
-- file on every push: once the column exists, a client with service dates and no
-- confirmation is a legitimate 예약 전 client and must never be backfilled again.
DO $$
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
    END IF;
END
$$;
