import {
  GenericContainer,
  StartedTestContainer,
  Wait,
} from 'testcontainers';

export interface E2eInfra {
  postgres: StartedTestContainer;
  redis: StartedTestContainer;
  minio: StartedTestContainer;
  env: Record<string, string>;
  stop: () => Promise<void>;
}

export async function startInfra(): Promise<E2eInfra> {
  const postgres = await new GenericContainer('postgres:16-alpine')
    .withEnvironment({
      POSTGRES_USER: 'test',
      POSTGRES_PASSWORD: 'test',
      POSTGRES_DB: 'messaging_test',
    })
    .withExposedPorts(5432)
    .withWaitStrategy(Wait.forLogMessage('database system is ready to accept connections', 2))
    .start();

  const redis = await new GenericContainer('redis:7-alpine')
    .withExposedPorts(6379)
    .withWaitStrategy(Wait.forLogMessage('Ready to accept connections'))
    .start();

  const minio = await new GenericContainer('minio/minio:latest')
    .withCommand(['server', '/data'])
    .withEnvironment({
      MINIO_ROOT_USER: 'minio',
      MINIO_ROOT_PASSWORD: 'minio_password',
    })
    .withExposedPorts(9000)
    .withWaitStrategy(Wait.forHttp('/minio/health/live', 9000))
    .start();

  const env: Record<string, string> = {
    DB_HOST: postgres.getHost(),
    DB_PORT: String(postgres.getMappedPort(5432)),
    DB_USERNAME: 'test',
    DB_PASSWORD: 'test',
    DB_NAME: 'messaging_test',
    REDIS_HOST: redis.getHost(),
    REDIS_PORT: String(redis.getMappedPort(6379)),
    S3_ENDPOINT: `http://${minio.getHost()}:${minio.getMappedPort(9000)}`,
    S3_REGION: 'us-east-1',
    S3_BUCKET: 'messaging-test',
    S3_ACCESS_KEY: 'minio',
    S3_SECRET_KEY: 'minio_password',
    S3_FORCE_PATH_STYLE: 'true',
  };
  Object.assign(process.env, env);

  // Création du bucket MinIO
  const {
    S3Client,
    CreateBucketCommand,
  } = await import('@aws-sdk/client-s3');
  const s3 = new S3Client({
    endpoint: env.S3_ENDPOINT,
    region: env.S3_REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: env.S3_ACCESS_KEY, secretAccessKey: env.S3_SECRET_KEY },
  });
  try {
    await s3.send(new CreateBucketCommand({ Bucket: env.S3_BUCKET }));
  } catch {
    /* déjà existant */
  }

  return {
    postgres,
    redis,
    minio,
    env,
    stop: async () => {
      await Promise.allSettled([postgres.stop(), redis.stop(), minio.stop()]);
    },
  };
}
