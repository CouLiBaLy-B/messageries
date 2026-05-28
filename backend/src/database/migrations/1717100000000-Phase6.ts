import { MigrationInterface, QueryRunner } from 'typeorm';

export class Phase61717100000000 implements MigrationInterface {
  name = 'Phase61717100000000';

  public async up(q: QueryRunner): Promise<void> {
    // Opt-in conv-level pour indexation
    await q.query(`ALTER TABLE conversations
      ADD COLUMN search_indexed boolean NOT NULL DEFAULT false,
      ADD COLUMN search_indexed_at timestamptz
    `);
    await q.query(`CREATE INDEX idx_conv_searchable ON conversations(search_indexed) WHERE search_indexed = true`);
  }
  public async down(q: QueryRunner): Promise<void> {
    await q.query(`DROP INDEX IF EXISTS idx_conv_searchable`);
    await q.query(`ALTER TABLE conversations DROP COLUMN search_indexed_at, DROP COLUMN search_indexed`);
  }
}
