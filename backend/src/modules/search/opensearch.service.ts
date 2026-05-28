import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Wrapper OpenSearch via API HTTP signée AWS (SigV4) ou basic auth.
 * Lazy import @aws-sdk/client-opensearch-serverless ou @opensearch-project/opensearch.
 * Index: messaging_messages (1 par message), mapping minimal + analyser french.
 */
@Injectable()
export class OpenSearchService implements OnModuleInit {
  private readonly logger = new Logger(OpenSearchService.name);
  private readonly enabled: boolean;
  private readonly endpoint: string;
  private readonly index: string;
  private client: any;

  constructor(private readonly cfg: ConfigService) {
    this.enabled = cfg.get<boolean>('SEARCH_ENABLED', false);
    this.endpoint = cfg.get<string>('OPENSEARCH_ENDPOINT', '');
    this.index = cfg.get<string>('OPENSEARCH_INDEX', 'messaging_messages');
  }

  async onModuleInit() {
    if (!this.enabled) return;
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const { Client } = require('@opensearch-project/opensearch');
      this.client = new Client({
        node: this.endpoint,
        auth: {
          username: this.cfg.get<string>('OPENSEARCH_USERNAME', 'admin'),
          password: this.cfg.get<string>('OPENSEARCH_PASSWORD', ''),
        },
        ssl: { rejectUnauthorized: this.cfg.get<boolean>('OPENSEARCH_VERIFY_TLS', true) },
      });
      await this.ensureIndex();
      this.logger.log(`OpenSearch ready (${this.endpoint})`);
    } catch (e) {
      this.logger.warn(`OpenSearch disabled (sdk missing): ${(e as Error).message}`);
    }
  }

  private async ensureIndex() {
    const exists = await this.client.indices.exists({ index: this.index });
    if (exists.body) return;
    await this.client.indices.create({
      index: this.index,
      body: {
        settings: {
          number_of_shards: 1,
          number_of_replicas: 1,
          analysis: {
            analyzer: {
              fr_text: {
                type: 'custom',
                tokenizer: 'standard',
                filter: ['lowercase', 'asciifolding', 'french_stop', 'french_stemmer'],
              },
            },
            filter: {
              french_stop: { type: 'stop', stopwords: '_french_' },
              french_stemmer: { type: 'stemmer', language: 'light_french' },
            },
          },
        },
        mappings: {
          properties: {
            conversationId: { type: 'keyword' },
            messageId: { type: 'keyword' },
            sequence: { type: 'long' },
            senderId: { type: 'keyword' },
            createdAt: { type: 'date' },
            content: { type: 'text', analyzer: 'fr_text' },
            participants: { type: 'keyword' }, // RBAC : filter by user
          },
        },
      },
    });
  }

  isEnabled() {
    return this.enabled && !!this.client;
  }

  async indexMessage(doc: {
    messageId: string;
    conversationId: string;
    sequence: string;
    senderId: string;
    createdAt: Date;
    content: string;
    participants: string[];
  }) {
    if (!this.isEnabled()) return;
    await this.client.index({
      index: this.index,
      id: doc.messageId,
      body: { ...doc, sequence: Number(doc.sequence) },
      refresh: false,
    });
  }

  async deleteMessage(messageId: string) {
    if (!this.isEnabled()) return;
    try {
      await this.client.delete({ index: this.index, id: messageId });
    } catch (e: any) {
      if (e?.meta?.statusCode !== 404) throw e;
    }
  }

  /**
   * Recherche RBAC-aware : filtre obligatoire participants:userId.
   */
  async search(input: {
    userId: string;
    query: string;
    conversationId?: string;
    limit?: number;
  }) {
    if (!this.isEnabled()) return { hits: [], total: 0 };
    const must: any[] = [
      { match: { content: { query: input.query, operator: 'and' } } },
    ];
    const filter: any[] = [{ term: { participants: input.userId } }];
    if (input.conversationId) filter.push({ term: { conversationId: input.conversationId } });

    const res = await this.client.search({
      index: this.index,
      body: {
        size: Math.min(input.limit ?? 20, 100),
        query: { bool: { must, filter } },
        highlight: { fields: { content: { fragment_size: 120, number_of_fragments: 2 } } },
        sort: [{ createdAt: 'desc' }],
      },
    });
    return {
      total: res.body.hits.total.value,
      hits: res.body.hits.hits.map((h: any) => ({
        messageId: h._source.messageId,
        conversationId: h._source.conversationId,
        sequence: String(h._source.sequence),
        senderId: h._source.senderId,
        createdAt: h._source.createdAt,
        highlight: h.highlight?.content ?? [],
      })),
    };
  }

  async deleteByConversation(conversationId: string) {
    if (!this.isEnabled()) return;
    await this.client.deleteByQuery({
      index: this.index,
      body: { query: { term: { conversationId } } },
      refresh: true,
    });
  }
}
