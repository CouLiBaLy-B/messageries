import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase81717200000000 implements MigrationInterface {
  name = 'Phase81717200000000';

  public async up(q: QueryRunner): Promise<void> {
    // KeyPackages MLS publiés par les clients (pool, consommé à l'ajout dans un groupe)
    await q.query(`
      CREATE TABLE mls_key_packages (
        id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        device_id   varchar(64) NOT NULL,
        cipher_suite varchar(64) NOT NULL,
        key_package bytea NOT NULL,
        consumed_at timestamptz,
        consumed_by uuid REFERENCES users(id) ON DELETE SET NULL,
        expires_at  timestamptz NOT NULL,
        created_at  timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE INDEX idx_kp_user_avail ON mls_key_packages(user_id, expires_at) WHERE consumed_at IS NULL`);

    // Groupe MLS associé à une conversation
    await q.query(`
      CREATE TABLE mls_groups (
        id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        conversation_id uuid NOT NULL UNIQUE REFERENCES conversations(id) ON DELETE CASCADE,
        group_id_mls    bytea NOT NULL,
        cipher_suite    varchar(64) NOT NULL,
        epoch           bigint NOT NULL DEFAULT 0,
        created_by      uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
        created_at      timestamptz NOT NULL DEFAULT now()
      )
    `);

    // Messages MLS opaques (Welcome, Commit, Application Message)
    await q.query(`
      CREATE TABLE mls_messages (
        id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
        group_id        uuid NOT NULL REFERENCES mls_groups(id) ON DELETE CASCADE,
        sender_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
        sender_device_id varchar(64),
        kind            varchar(24) NOT NULL CHECK (kind IN ('welcome','commit','application','proposal','group_info')),
        epoch           bigint NOT NULL,
        sequence        bigint NOT NULL,
        target_user_id  uuid REFERENCES users(id) ON DELETE SET NULL,
        ciphertext      bytea NOT NULL,
        created_at      timestamptz NOT NULL DEFAULT now()
      )
    `);
    await q.query(`CREATE UNIQUE INDEX idx_mls_msg_seq ON mls_messages(group_id, sequence)`);
    await q.query(`CREATE INDEX idx_mls_msg_target ON mls_messages(target_user_id, created_at DESC)`);

    // Flag E2EE par conversation
    await q.query(`ALTER TABLE conversations
      ADD COLUMN e2ee_enabled boolean NOT NULL DEFAULT false,
      ADD COLUMN e2ee_enabled_at timestamptz
    `);
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE conversations DROP COLUMN e2ee_enabled_at, DROP COLUMN e2ee_enabled`);
    await q.query(`DROP TABLE IF EXISTS mls_messages CASCADE`);
    await q.query(`DROP TABLE IF EXISTS mls_groups CASCADE`);
    await q.query(`DROP TABLE IF EXISTS mls_key_packages CASCADE`);
  }
}
