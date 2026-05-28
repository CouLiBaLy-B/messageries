import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase21717000000000 implements MigrationInterface {
  name = 'Phase21717000000000';

  public async up(q: QueryRunner): Promise<void> {
    // --- Chiffrement enveloppe ---
    await q.query(`ALTER TABLE messages
      ADD COLUMN body_ciphertext bytea,
      ADD COLUMN body_dek_id     varchar(128),
      ADD COLUMN body_alg        varchar(32),
      ADD COLUMN body_iv         bytea,
      ADD COLUMN body_tag        bytea,
      ALTER COLUMN body DROP NOT NULL
    `);

    // --- Modération ---
    await q.query(`
      CREATE TABLE message_reports (
        id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        message_id      uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        reporter_id     uuid NOT NULL REFERENCES users(id) ON DELETE SET NULL,
        reason          varchar(64) NOT NULL,
        details         text,
        status          varchar(16) NOT NULL DEFAULT 'open',
        resolved_by     uuid REFERENCES users(id) ON DELETE SET NULL,
        resolved_at     timestamptz,
        created_at      timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_reports_msg ON message_reports(message_id)`);
    await q.query(`CREATE INDEX idx_reports_status ON message_reports(status, created_at DESC)`);

    await q.query(`ALTER TABLE messages
      ADD COLUMN moderation_flags jsonb,
      ADD COLUMN moderation_score real DEFAULT 0,
      ADD COLUMN moderated_by uuid REFERENCES users(id) ON DELETE SET NULL,
      ADD COLUMN moderated_at timestamptz
    `);

    // --- Refresh tokens persistés (rotation + révocation) ---
    await q.query(`
      CREATE TABLE refresh_tokens (
        id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        token_hash   varchar(128) NOT NULL UNIQUE,
        parent_id    uuid REFERENCES refresh_tokens(id) ON DELETE SET NULL,
        user_agent   text,
        ip           inet,
        expires_at   timestamptz NOT NULL,
        revoked_at   timestamptz,
        revoked_reason varchar(64),
        created_at   timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_rt_user ON refresh_tokens(user_id) WHERE revoked_at IS NULL`);

    // --- Outbox worker : tracking retries ---
    await q.query(`ALTER TABLE message_events_outbox
      ADD COLUMN attempts      int NOT NULL DEFAULT 0,
      ADD COLUMN next_attempt_at timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN last_error    text,
      ADD COLUMN locked_by     varchar(64),
      ADD COLUMN locked_until  timestamptz
    `);
    await q.query(`
      CREATE INDEX idx_outbox_due ON message_events_outbox(next_attempt_at)
       WHERE processed_at IS NULL
    `);

    // --- Notifications email log (anti-spam, déduplication) ---
    await q.query(`
      CREATE TABLE email_notifications (
        id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id         uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        conversation_id uuid REFERENCES conversations(id) ON DELETE CASCADE,
        kind            varchar(48) NOT NULL,
        sent_at         timestamptz NOT NULL DEFAULT now(),
        dedup_key       varchar(128) NOT NULL UNIQUE
      )
    `);
    await q.query(`CREATE INDEX idx_email_user_kind ON email_notifications(user_id, kind, sent_at DESC)`);

    // --- RGPD : anonymisation users ---
    await q.query(`ALTER TABLE users
      ADD COLUMN anonymized_at timestamptz,
      ADD COLUMN data_export_requested_at timestamptz
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE users DROP COLUMN data_export_requested_at, DROP COLUMN anonymized_at`);
    await q.query(`DROP TABLE IF EXISTS email_notifications CASCADE`);
    await q.query(`DROP INDEX IF EXISTS idx_outbox_due`);
    await q.query(`ALTER TABLE message_events_outbox
      DROP COLUMN locked_until, DROP COLUMN locked_by, DROP COLUMN last_error,
      DROP COLUMN next_attempt_at, DROP COLUMN attempts
    `);
    await q.query(`DROP TABLE IF EXISTS refresh_tokens CASCADE`);
    await q.query(`ALTER TABLE messages
      DROP COLUMN moderated_at, DROP COLUMN moderated_by,
      DROP COLUMN moderation_score, DROP COLUMN moderation_flags
    `);
    await q.query(`DROP TABLE IF EXISTS message_reports CASCADE`);
    await q.query(`ALTER TABLE messages
      ALTER COLUMN body SET NOT NULL,
      DROP COLUMN body_tag, DROP COLUMN body_iv, DROP COLUMN body_alg,
      DROP COLUMN body_dek_id, DROP COLUMN body_ciphertext
    `);
  }
}
