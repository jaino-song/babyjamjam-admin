-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateTable
CREATE TABLE "area" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "korean_name" TEXT NOT NULL,
    "branch_id" UUID,

    CONSTRAINT "area_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bank_account_info" (
    "area_id" TEXT NOT NULL,
    "bank_name" TEXT,
    "acc_num" TEXT,

    CONSTRAINT "bankAccountInfo_pkey" PRIMARY KEY ("area_id")
);

-- CreateTable
CREATE TABLE "chat_feedback" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "session_id" TEXT NOT NULL,
    "message_id" TEXT NOT NULL,
    "user_id" UUID NOT NULL,
    "type" TEXT NOT NULL,
    "comment" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_feedback_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_message" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "session_id" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "timestamp" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "chat_session" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "user_id" UUID NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "chat_session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "client" (
    "id" SERIAL NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "phone" TEXT,
    "type" TEXT,
    "duration" SMALLINT,
    "full_price" TEXT,
    "grant" TEXT,
    "actual_price" TEXT,
    "start_date" DATE,
    "end_date" DATE,
    "care_center" BOOLEAN NOT NULL,
    "voucher_client" BOOLEAN NOT NULL,
    "birthday" VARCHAR(6),
    "breast_pump" BOOLEAN NOT NULL DEFAULT false,
    "service_status" TEXT,
    "e_doc_id" TEXT,
    "due_date" DATE,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "branch_id" UUID,
    "area_id" TEXT,

    CONSTRAINT "client_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "doc_template" (
    "area_id" TEXT NOT NULL,
    "template_id" TEXT NOT NULL,
    "template_name" TEXT,
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,

    CONSTRAINT "doc_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "tags" TEXT[],
    "mime_type" TEXT NOT NULL,
    "file_size" INTEGER NOT NULL,
    "storage_path" TEXT NOT NULL,
    "storage_url" TEXT,
    "org_id" TEXT,
    "uploaded_by" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "category_id" TEXT NOT NULL,
    "branch_id" UUID,

    CONSTRAINT "document_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "document_category" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "value" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "color" TEXT NOT NULL,
    "is_custom" BOOLEAN NOT NULL DEFAULT true,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "branch_id" UUID,

    CONSTRAINT "document_category_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "eformsign_doc" (
    "id" SERIAL NOT NULL,
    "document_id" TEXT NOT NULL,
    "created_date" TIMESTAMPTZ(6) NOT NULL,
    "updated_date" TIMESTAMPTZ(6) NOT NULL,
    "status_type" TEXT NOT NULL,
    "status_detail" TEXT NOT NULL,
    "step_type" TEXT NOT NULL,
    "step_index" TEXT NOT NULL,
    "step_name" TEXT NOT NULL,
    "step_recipient_type" TEXT NOT NULL,
    "step_recipient_name" TEXT NOT NULL,
    "step_recipient_sms" TEXT NOT NULL,
    "expired_date" TIMESTAMPTZ(6) NOT NULL,
    "expired" BOOLEAN NOT NULL DEFAULT false,
    "client_id" INTEGER NOT NULL,
    "branch_id" UUID,

    CONSTRAINT "eformsign_doc_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee" (
    "id" SMALLINT NOT NULL,
    "name" TEXT NOT NULL,
    "work_area" TEXT[],
    "phone" TEXT NOT NULL,
    "grade" TEXT NOT NULL,
    "open_to_next_work" BOOLEAN NOT NULL DEFAULT true,
    "company_registered_date" DATE,
    "branch_id" UUID,

    CONSTRAINT "employee_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "employee_schedule" (
    "id" SERIAL NOT NULL,
    "primary_employee_id" SMALLINT NOT NULL,
    "work_address" TEXT NOT NULL,
    "start_date" DATE NOT NULL,
    "end_date" DATE NOT NULL,
    "replaced" BOOLEAN NOT NULL DEFAULT false,
    "client_id" INTEGER NOT NULL,
    "secondary_employee_id" SMALLINT,
    "branch_id" UUID,

    CONSTRAINT "employee_schedule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message" (
    "id" SMALLSERIAL NOT NULL,
    "title" VARCHAR DEFAULT '',
    "text" VARCHAR,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "edited_at" TIMESTAMPTZ(6),
    "branch_id" UUID,

    CONSTRAINT "message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "message_template" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '[]',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,
    "branch_id" UUID,
    "is_custom" BOOLEAN DEFAULT true,

    CONSTRAINT "message_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "notification" (
    "id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "data" JSONB,
    "sent_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "read_at" TIMESTAMPTZ(6),
    "branch_id" UUID,

    CONSTRAINT "notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "branch" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "region" TEXT,
    "district" TEXT,
    "branch_type" TEXT,
    "phone" TEXT,
    "address" TEXT,
    "email" TEXT,
    "business_hours" TEXT,
    "description" TEXT,
    "is_active" BOOLEAN DEFAULT true,
    "sms_sender_phone" VARCHAR(20),
    "sms_sender_approval_status" VARCHAR(20) NOT NULL DEFAULT 'not_requested',
    "sms_sender_approval_requested_at" TIMESTAMPTZ(6),
    "sms_sender_approval_requested_by" UUID,
    "sms_sender_approval_approved_at" TIMESTAMPTZ(6),
    "sms_sender_approval_approved_by" UUID,
    "created_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,
    "owner_id" UUID NOT NULL,

    CONSTRAINT "branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "push_subscription" (
    "id" SERIAL NOT NULL,
    "user_id" UUID NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh_key" TEXT NOT NULL,
    "auth_key" TEXT NOT NULL,
    "user_agent" TEXT,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "push_subscription_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_setting" (
    "key" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "system_template" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "template_key" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMP(3) NOT NULL,
    "custom_variables" JSONB,

    CONSTRAINT "system_template_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "system_template_version" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "template_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "version_number" INTEGER NOT NULL,
    "created_by" TEXT,
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "system_template_version_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "email" VARCHAR,
    "name" VARCHAR,
    "phone" VARCHAR,
    "birth_date" VARCHAR,
    "profile_image" VARCHAR,
    "role" VARCHAR,
    "created_at" TIMESTAMP(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "kakao_id" VARCHAR,
    "password_hash" VARCHAR,
    "email_verified" BOOLEAN NOT NULL DEFAULT false,
    "email_verified_at" TIMESTAMPTZ(6),
    "auth_provider" TEXT NOT NULL DEFAULT 'kakao',

    CONSTRAINT "user_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "user_branch" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "branch_id" UUID NOT NULL,
    "role" TEXT DEFAULT 'user',
    "joined_at" TIMESTAMPTZ(6) DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "user_branch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "consultation_inquiry" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "branch_id" UUID NOT NULL,
    "public_branch_slug" TEXT NOT NULL,
    "mother_name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "address" TEXT NOT NULL,
    "due_date" DATE NOT NULL,
    "birth_experience" TEXT NOT NULL,
    "voucher_type" TEXT,
    "preferred_caregiver_name" TEXT,
    "referral_source" TEXT NOT NULL,
    "privacy_accepted_at" TIMESTAMPTZ(6) NOT NULL,
    "selected_services" JSONB,
    "additional_notes" TEXT,
    "source" TEXT NOT NULL DEFAULT 'website',
    "status" TEXT NOT NULL DEFAULT 'new',
    "read_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "consultation_inquiry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_price_info" (
    "id" SMALLSERIAL NOT NULL,
    "type" TEXT,
    "duration" BIGINT,
    "full_price" TEXT,
    "grant" TEXT,
    "actual_price" TEXT,
    "year" INTEGER NOT NULL,

    CONSTRAINT "voucherPriceInfo_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "voucher_price_info_2025" (
    "id" SMALLINT NOT NULL,
    "type" TEXT,
    "duration" BIGINT,
    "full_price" TEXT,
    "grant" TEXT,
    "actual_price" TEXT,

    CONSTRAINT "voucher_price_info_2025_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_token" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "user_id" UUID NOT NULL,
    "token" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "used_at" TIMESTAMPTZ(6),

    CONSTRAINT "auth_token_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "auth_flow_state" (
    "id" UUID NOT NULL DEFAULT gen_random_uuid(),
    "kind" VARCHAR NOT NULL,
    "token_hash" VARCHAR NOT NULL,
    "user_id" UUID,
    "access_token" TEXT,
    "refresh_token" TEXT,
    "requires_branch_selection" BOOLEAN DEFAULT false,
    "kakao_id" VARCHAR,
    "email" VARCHAR,
    "name" VARCHAR,
    "profile_image" VARCHAR,
    "expires_at" TIMESTAMPTZ(6) NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "consumed_at" TIMESTAMPTZ(6),

    CONSTRAINT "auth_flow_state_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alimtalk_log" (
    "id" SERIAL NOT NULL,
    "branch_id" UUID,
    "provider" TEXT NOT NULL,
    "template_key" TEXT NOT NULL,
    "trigger_job_id" TEXT,
    "receiver" TEXT NOT NULL,
    "client_id" INTEGER,
    "message_body" TEXT NOT NULL,
    "variables" JSONB NOT NULL DEFAULT '{}',
    "status" TEXT NOT NULL DEFAULT 'pending',
    "aligo_mid" TEXT,
    "error_message" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "last_attempt_at" TIMESTAMPTZ(6),
    "next_retry_at" TIMESTAMPTZ(6),
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "alimtalk_log_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alimtalk_trigger_rule" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "branch_id" UUID,
    "name" TEXT NOT NULL,
    "is_active" BOOLEAN NOT NULL DEFAULT true,
    "event_type" TEXT NOT NULL,
    "offset_type" TEXT NOT NULL,
    "offset_days" INTEGER NOT NULL DEFAULT 0,
    "recipient_type" TEXT NOT NULL,
    "template_key" TEXT NOT NULL,
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "alimtalk_trigger_rule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "alimtalk_trigger_job" (
    "id" TEXT NOT NULL DEFAULT (gen_random_uuid())::text,
    "branch_id" UUID,
    "rule_id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduled_for" TIMESTAMPTZ(6) NOT NULL,
    "sent_at" TIMESTAMPTZ(6),
    "canceled_at" TIMESTAMPTZ(6),
    "cancel_reason" TEXT,
    "client_id" INTEGER,
    "employee_schedule_id" INTEGER,
    "recipient_type" TEXT NOT NULL,
    "recipient_phone" TEXT,
    "template_key" TEXT NOT NULL,
    "dedupe_key" TEXT NOT NULL,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updated_at" TIMESTAMPTZ(6) NOT NULL,

    CONSTRAINT "alimtalk_trigger_job_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "idx_area_branch" ON "area"("branch_id");

-- CreateIndex
CREATE INDEX "chat_feedback_created_at_idx" ON "chat_feedback"("created_at");

-- CreateIndex
CREATE INDEX "chat_feedback_session_id_idx" ON "chat_feedback"("session_id");

-- CreateIndex
CREATE INDEX "chat_feedback_type_idx" ON "chat_feedback"("type");

-- CreateIndex
CREATE INDEX "chat_feedback_user_id_idx" ON "chat_feedback"("user_id");

-- CreateIndex
CREATE INDEX "chat_message_session_id_idx" ON "chat_message"("session_id");

-- CreateIndex
CREATE INDEX "chat_message_timestamp_idx" ON "chat_message"("timestamp");

-- CreateIndex
CREATE INDEX "chat_session_created_at_idx" ON "chat_session"("created_at");

-- CreateIndex
CREATE INDEX "chat_session_expires_at_idx" ON "chat_session"("expires_at");

-- CreateIndex
CREATE INDEX "chat_session_user_id_idx" ON "chat_session"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "client_e_doc_id_key" ON "client"("e_doc_id");

-- CreateIndex
CREATE INDEX "idx_client_area" ON "client"("area_id");

-- CreateIndex
CREATE INDEX "idx_client_branch" ON "client"("branch_id");

-- CreateIndex
CREATE INDEX "idx_client_created_at" ON "client"("created_at");

-- CreateIndex
CREATE INDEX "document_category_id_idx" ON "document"("category_id");

-- CreateIndex
CREATE INDEX "document_org_id_idx" ON "document"("org_id");

-- CreateIndex
CREATE INDEX "document_uploaded_by_idx" ON "document"("uploaded_by");

-- CreateIndex
CREATE INDEX "idx_document_branch" ON "document"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "document_category_value_key" ON "document_category"("value");

-- CreateIndex
CREATE INDEX "idx_document_category_branch" ON "document_category"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "eformsign_doc_document_id_key" ON "eformsign_doc"("document_id");

-- CreateIndex
CREATE INDEX "idx_eformsign_doc_branch" ON "eformsign_doc"("branch_id");

-- CreateIndex
CREATE UNIQUE INDEX "employee_phone_key" ON "employee"("phone");

-- CreateIndex
CREATE INDEX "idx_employee_branch" ON "employee"("branch_id");

-- CreateIndex
CREATE INDEX "idx_employee_schedule_branch" ON "employee_schedule"("branch_id");

-- CreateIndex
CREATE INDEX "idx_message_branch" ON "message"("branch_id");

-- CreateIndex
CREATE INDEX "idx_message_template_branch" ON "message_template"("branch_id");

-- CreateIndex
CREATE INDEX "idx_notification_branch" ON "notification"("branch_id");

-- CreateIndex
CREATE INDEX "notification_user_id_sent_at_idx" ON "notification"("user_id", "sent_at");

-- CreateIndex
CREATE UNIQUE INDEX "branch_slug_key" ON "branch"("slug");

-- CreateIndex
CREATE INDEX "idx_branch_is_active" ON "branch"("is_active");

-- CreateIndex
CREATE INDEX "idx_branch_owner" ON "branch"("owner_id");

-- CreateIndex
CREATE INDEX "idx_branch_region" ON "branch"("region");

-- CreateIndex
CREATE INDEX "idx_branch_sms_sender_approval_status" ON "branch"("sms_sender_approval_status");

-- CreateIndex
CREATE INDEX "idx_branch_slug" ON "branch"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "push_subscription_endpoint_key" ON "push_subscription"("endpoint");

-- CreateIndex
CREATE INDEX "push_subscription_user_id_idx" ON "push_subscription"("user_id");

-- CreateIndex
CREATE UNIQUE INDEX "system_template_template_key_key" ON "system_template"("template_key");

-- CreateIndex
CREATE INDEX "system_template_version_template_id_idx" ON "system_template_version"("template_id");

-- CreateIndex
CREATE UNIQUE INDEX "system_template_version_template_id_version_number_key" ON "system_template_version"("template_id", "version_number");

-- CreateIndex
CREATE UNIQUE INDEX "user_email_key" ON "user"("email");

-- CreateIndex
CREATE UNIQUE INDEX "user_kakaoId_key" ON "user"("kakao_id");

-- CreateIndex
CREATE INDEX "idx_user_branch_branch" ON "user_branch"("branch_id");

-- CreateIndex
CREATE INDEX "idx_user_branch_user" ON "user_branch"("user_id");

-- CreateIndex
CREATE INDEX "idx_user_branch_user_branch" ON "user_branch"("user_id", "branch_id");

-- CreateIndex
CREATE INDEX "idx_consultation_inquiry_branch_created" ON "consultation_inquiry"("branch_id", "created_at");

-- CreateIndex
CREATE INDEX "idx_consultation_inquiry_branch_status" ON "consultation_inquiry"("branch_id", "status");

-- CreateIndex
CREATE INDEX "idx_consultation_inquiry_branch_read_at" ON "consultation_inquiry"("branch_id", "read_at");

-- CreateIndex
CREATE INDEX "idx_consultation_inquiry_phone" ON "consultation_inquiry"("phone");

-- CreateIndex
CREATE INDEX "idx_consultation_inquiry_public_branch_slug" ON "consultation_inquiry"("public_branch_slug");

-- CreateIndex
CREATE INDEX "voucher_price_info_type_duration_year_idx" ON "voucher_price_info"("type", "duration", "year");

-- CreateIndex
CREATE UNIQUE INDEX "voucher_price_info_year_type_duration_uniq" ON "voucher_price_info"("year", "type", "duration");

-- CreateIndex
CREATE UNIQUE INDEX "auth_token_token_key" ON "auth_token"("token");

-- CreateIndex
CREATE INDEX "auth_token_user_id_idx" ON "auth_token"("user_id");

-- CreateIndex
CREATE INDEX "auth_token_token_idx" ON "auth_token"("token");

-- CreateIndex
CREATE UNIQUE INDEX "auth_flow_state_token_hash_key" ON "auth_flow_state"("token_hash");

-- CreateIndex
CREATE INDEX "idx_auth_flow_state_kind_expires_at" ON "auth_flow_state"("kind", "expires_at");

-- CreateIndex
CREATE INDEX "idx_alimtalk_log_branch" ON "alimtalk_log"("branch_id");

-- CreateIndex
CREATE INDEX "idx_alimtalk_log_trigger_job_id" ON "alimtalk_log"("trigger_job_id");

-- CreateIndex
CREATE INDEX "idx_alimtalk_log_status" ON "alimtalk_log"("status");

-- CreateIndex
CREATE INDEX "idx_alimtalk_log_receiver" ON "alimtalk_log"("receiver");

-- CreateIndex
CREATE INDEX "idx_alimtalk_log_created_at" ON "alimtalk_log"("created_at");

-- CreateIndex
CREATE INDEX "idx_alimtalk_log_next_retry_at" ON "alimtalk_log"("next_retry_at");

-- CreateIndex
CREATE INDEX "idx_alimtalk_trigger_rule_branch" ON "alimtalk_trigger_rule"("branch_id");

-- CreateIndex
CREATE INDEX "idx_alimtalk_trigger_rule_active" ON "alimtalk_trigger_rule"("branch_id", "is_active");

-- CreateIndex
CREATE INDEX "idx_alimtalk_trigger_rule_event_type" ON "alimtalk_trigger_rule"("event_type");

-- CreateIndex
CREATE UNIQUE INDEX "alimtalk_trigger_job_dedupe_key_key" ON "alimtalk_trigger_job"("dedupe_key");

-- CreateIndex
CREATE INDEX "idx_alimtalk_trigger_job_branch" ON "alimtalk_trigger_job"("branch_id");

-- CreateIndex
CREATE INDEX "idx_alimtalk_trigger_job_rule_id" ON "alimtalk_trigger_job"("rule_id");

-- CreateIndex
CREATE INDEX "idx_alimtalk_trigger_job_status_scheduled_for" ON "alimtalk_trigger_job"("status", "scheduled_for");

-- CreateIndex
CREATE INDEX "idx_alimtalk_trigger_job_client_id" ON "alimtalk_trigger_job"("client_id");

-- CreateIndex
CREATE INDEX "idx_alimtalk_trigger_job_employee_schedule_id" ON "alimtalk_trigger_job"("employee_schedule_id");

-- AddForeignKey
ALTER TABLE "area" ADD CONSTRAINT "area_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "bank_account_info" ADD CONSTRAINT "bank_account_info_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "area"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "chat_feedback" ADD CONSTRAINT "chat_feedback_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "chat_message"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_feedback" ADD CONSTRAINT "chat_feedback_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_feedback" ADD CONSTRAINT "chat_feedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_message" ADD CONSTRAINT "chat_message_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "chat_session"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "chat_session" ADD CONSTRAINT "chat_session_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "client" ADD CONSTRAINT "client_e_doc_id_fkey" FOREIGN KEY ("e_doc_id") REFERENCES "eformsign_doc"("document_id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "client" ADD CONSTRAINT "client_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "client" ADD CONSTRAINT "client_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "area"("id") ON DELETE SET NULL ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "doc_template" ADD CONSTRAINT "doc_template_area_id_fkey" FOREIGN KEY ("area_id") REFERENCES "area"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "document_category"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "document" ADD CONSTRAINT "document_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "document_category" ADD CONSTRAINT "document_category_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "eformsign_doc" ADD CONSTRAINT "eformsign_doc_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "eformsign_doc" ADD CONSTRAINT "eformsign_doc_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "employee" ADD CONSTRAINT "employee_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "employee_schedule" ADD CONSTRAINT "employee_schedule_client_id_fkey" FOREIGN KEY ("client_id") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "employee_schedule" ADD CONSTRAINT "employee_schedule_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "employee_schedule" ADD CONSTRAINT "employee_schedule_primary_employee_id_fkey" FOREIGN KEY ("primary_employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "employee_schedule" ADD CONSTRAINT "employee_schedule_secondary_employee_id_fkey" FOREIGN KEY ("secondary_employee_id") REFERENCES "employee"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "message" ADD CONSTRAINT "message_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "message_template" ADD CONSTRAINT "message_template_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "notification" ADD CONSTRAINT "notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "branch" ADD CONSTRAINT "branch_owner_id_fkey" FOREIGN KEY ("owner_id") REFERENCES "user"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "push_subscription" ADD CONSTRAINT "push_subscription_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "system_template_version" ADD CONSTRAINT "system_template_version_template_id_fkey" FOREIGN KEY ("template_id") REFERENCES "system_template"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "user_branch" ADD CONSTRAINT "user_branch_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "user_branch" ADD CONSTRAINT "user_branch_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "consultation_inquiry" ADD CONSTRAINT "consultation_inquiry_branch_id_fkey" FOREIGN KEY ("branch_id") REFERENCES "branch"("id") ON DELETE NO ACTION ON UPDATE NO ACTION;

-- AddForeignKey
ALTER TABLE "auth_token" ADD CONSTRAINT "auth_token_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user"("id") ON DELETE CASCADE ON UPDATE CASCADE;

