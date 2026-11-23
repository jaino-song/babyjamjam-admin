BEGIN;

CREATE TABLE IF NOT EXISTS message_occurrence_claim (
    branch_id uuid NOT NULL REFERENCES branch(id),
    occurrence_key char(64) NOT NULL,
    template_key text NOT NULL,
    event_type text,
    lifecycle_id integer NOT NULL,
    recipient_kind text NOT NULL CHECK (recipient_kind IN ('client', 'employee')),
    recipient_id integer NOT NULL,
    slot text,
    state text NOT NULL DEFAULT 'released' CHECK (state IN ('in_flight', 'accepted', 'released', 'uncertain')),
    holder_log_id integer REFERENCES message_log(id) ON DELETE SET NULL,
    accepted_via text CHECK (accepted_via IN ('manual', 'automatic')),
    accepted_log_id integer REFERENCES message_log(id) ON DELETE SET NULL,
    proof_source text CHECK (proof_source IN ('provider', 'historical', 'legacy_stamp')),
    epoch integer NOT NULL DEFAULT 0,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (branch_id, occurrence_key)
);

CREATE TABLE IF NOT EXISTS message_occurrence_manual_attempt (
    branch_id uuid NOT NULL,
    occurrence_key char(64) NOT NULL,
    log_id integer NOT NULL REFERENCES message_log(id) ON DELETE RESTRICT,
    state text NOT NULL CHECK (state IN ('in_flight', 'accepted', 'released', 'uncertain')),
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    PRIMARY KEY (branch_id, occurrence_key, log_id),
    FOREIGN KEY (branch_id, occurrence_key)
        REFERENCES message_occurrence_claim(branch_id, occurrence_key) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS message_occurrence_manual_attempt_log_idx ON message_occurrence_manual_attempt(log_id);
CREATE INDEX IF NOT EXISTS message_occurrence_claim_holder_idx ON message_occurrence_claim(holder_log_id);
CREATE INDEX IF NOT EXISTS message_occurrence_claim_accepted_idx ON message_occurrence_claim(accepted_log_id);
CREATE INDEX IF NOT EXISTS message_log_occurrence_history_idx ON message_log(branch_id, client_id, template_key)
    WHERE provider = 'aligo_sms' AND client_id IS NOT NULL;

ALTER TABLE message_occurrence_claim ENABLE ROW LEVEL SECURITY;
ALTER TABLE message_occurrence_manual_attempt ENABLE ROW LEVEL SECURITY;

COMMIT;
