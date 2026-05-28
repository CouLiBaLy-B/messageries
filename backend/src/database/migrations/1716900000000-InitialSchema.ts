import { MigrationInterface, QueryRunner } from 'typeorm';

export class InitialSchema1716900000000 implements MigrationInterface {
  name = 'InitialSchema1716900000000';

  public async up(q: QueryRunner): Promise<void> {
    await q.query(`CREATE EXTENSION IF NOT EXISTS "uuid-ossp"`);
    await q.query(`CREATE EXTENSION IF NOT EXISTS "citext"`);
    await q.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // --- users ---
    await q.query(`
      CREATE TABLE users (
        id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        email         citext NOT NULL UNIQUE,
        password_hash text   NOT NULL,
        role          varchar(32) NOT NULL CHECK (role IN ('customer','seller','support','admin')),
        display_name  varchar(120),
        mfa_secret    text,
        is_suspended  boolean NOT NULL DEFAULT false,
        created_at    timestamptz NOT NULL DEFAULT now(),
        updated_at    timestamptz NOT NULL DEFAULT now()
      )
    `);

    // --- orders (référentiel minimal) ---
    await q.query(`
      CREATE TABLE orders (
        id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        external_ref varchar(64) NOT NULL UNIQUE,
        customer_id  uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        seller_id    uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        status       varchar(32) NOT NULL DEFAULT 'open',
        total_cents  integer NOT NULL DEFAULT 0,
        currency     varchar(3) NOT NULL DEFAULT 'EUR',
        created_at   timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_orders_customer ON orders(customer_id)`);
    await q.query(`CREATE INDEX idx_orders_seller   ON orders(seller_id)`);

    // --- conversations (1 par order) ---
    await q.query(`
      CREATE TABLE conversations (
        id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        order_id         uuid NOT NULL UNIQUE REFERENCES orders(id) ON DELETE CASCADE,
        status           varchar(32) NOT NULL DEFAULT 'open',
        subject          varchar(200),
        last_message_at  timestamptz,
        last_sequence    bigint NOT NULL DEFAULT 0,
        created_at       timestamptz NOT NULL DEFAULT now(),
        updated_at       timestamptz NOT NULL DEFAULT now()
      )
    `);

    // --- participants ---
    await q.query(`
      CREATE TABLE conversation_participants (
        conversation_id     uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        user_id             uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        role                varchar(32) NOT NULL,
        joined_at           timestamptz NOT NULL DEFAULT now(),
        left_at             timestamptz,
        muted               boolean NOT NULL DEFAULT false,
        last_read_sequence  bigint NOT NULL DEFAULT 0,
        PRIMARY KEY (conversation_id, user_id)
      )
    `);
    await q.query(`CREATE INDEX idx_part_user_conv ON conversation_participants(user_id, conversation_id)`);

    // --- messages ---
    await q.query(`
      CREATE TABLE messages (
        id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        conversation_id uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        sender_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        sequence        bigint NOT NULL,
        body            text NOT NULL,
        body_format     varchar(16) NOT NULL DEFAULT 'plain_text',
        status          varchar(16) NOT NULL DEFAULT 'sent',
        idempotency_key varchar(128),
        created_at      timestamptz NOT NULL DEFAULT now(),
        edited_at       timestamptz,
        deleted_at      timestamptz
      )
    `);
    await q.query(`CREATE UNIQUE INDEX idx_msg_conv_seq ON messages(conversation_id, sequence)`);
    await q.query(`CREATE UNIQUE INDEX idx_msg_idem ON messages(conversation_id, sender_id, idempotency_key) WHERE idempotency_key IS NOT NULL`);
    await q.query(`CREATE INDEX idx_msg_sender ON messages(sender_id)`);

    // --- receipts ---
    await q.query(`
      CREATE TABLE message_receipts (
        message_id   uuid NOT NULL REFERENCES messages(id) ON DELETE CASCADE,
        user_id      uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        delivered_at timestamptz,
        read_at      timestamptz,
        PRIMARY KEY (message_id, user_id)
      )
    `);
    await q.query(`CREATE INDEX idx_receipt_user ON message_receipts(user_id, message_id)`);

    // --- attachments ---
    await q.query(`
      CREATE TABLE attachments (
        id                uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        message_id        uuid REFERENCES messages(id) ON DELETE CASCADE,
        conversation_id   uuid NOT NULL REFERENCES conversations(id) ON DELETE CASCADE,
        uploader_id       uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        object_key        text NOT NULL,
        original_filename varchar(255) NOT NULL,
        mime_type         varchar(128) NOT NULL,
        size_bytes        bigint NOT NULL,
        sha256            varchar(64),
        scan_status       varchar(16) NOT NULL DEFAULT 'pending',
        created_at        timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_att_msg ON attachments(message_id)`);
    await q.query(`CREATE INDEX idx_att_conv ON attachments(conversation_id)`);

    // --- outbox ---
    await q.query(`
      CREATE TABLE message_events_outbox (
        id           uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        event_type   varchar(64) NOT NULL,
        aggregate_id uuid NOT NULL,
        payload      jsonb NOT NULL,
        processed_at timestamptz,
        created_at   timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_outbox_aggregate ON message_events_outbox(aggregate_id)`);
    await q.query(`CREATE INDEX idx_outbox_unprocessed ON message_events_outbox(created_at) WHERE processed_at IS NULL`);

    // --- audit ---
    await q.query(`
      CREATE TABLE audit_log (
        id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        actor_id    uuid REFERENCES users(id) ON DELETE SET NULL,
        action      varchar(64) NOT NULL,
        target_type varchar(32) NOT NULL,
        target_id   uuid,
        ip          inet,
        user_agent  text,
        metadata    jsonb,
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_audit_actor_time ON audit_log(actor_id, created_at DESC)`);
    await q.query(`CREATE INDEX idx_audit_action_time ON audit_log(action, created_at DESC)`);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP TABLE IF EXISTS audit_log CASCADE`);
    await q.query(`DROP TABLE IF EXISTS message_events_outbox CASCADE`);
    await q.query(`DROP TABLE IF EXISTS attachments CASCADE`);
    await q.query(`DROP TABLE IF EXISTS message_receipts CASCADE`);
    await q.query(`DROP TABLE IF EXISTS messages CASCADE`);
    await q.query(`DROP TABLE IF EXISTS conversation_participants CASCADE`);
    await q.query(`DROP TABLE IF EXISTS conversations CASCADE`);
    await q.query(`DROP TABLE IF EXISTS orders CASCADE`);
    await q.query(`DROP TABLE IF EXISTS users CASCADE`);
  }
}
