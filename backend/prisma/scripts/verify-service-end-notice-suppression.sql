DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1
        FROM information_schema.columns
        WHERE table_schema = 'public'
          AND table_name = 'client'
          AND column_name = 'service_end_notice_sent_at'
    ) THEN
        RAISE EXCEPTION 'client.service_end_notice_sent_at is missing';
    END IF;

    IF EXISTS (
        SELECT 1
        FROM "message_log" AS log
        JOIN "client" AS client
          ON client."id" = log."client_id"
         AND client."branch_id" = log."branch_id"
        WHERE log."template_key" = 'service_end_notice_sms'
          AND log."status" = 'sent'
          AND client."service_end_notice_sent_at" IS NULL
    ) THEN
        RAISE EXCEPTION 'a sent service-end notice is missing its client suppression timestamp';
    END IF;
END $$;
