import * as Joi from 'joi';

export const envValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'staging', 'production', 'test').default('development'),
  PORT: Joi.number().default(3000),
  API_PREFIX: Joi.string().default('api/v1'),
  ALLOWED_ORIGINS: Joi.string().required(),
  APP_URL: Joi.string().uri().default('http://localhost:8080'),

  DB_HOST: Joi.string().required(),
  DB_PORT: Joi.number().default(5432),
  DB_USERNAME: Joi.string().required(),
  DB_PASSWORD: Joi.string().required(),
  DB_NAME: Joi.string().required(),
  DB_SSL: Joi.boolean().default(false),
  DB_POOL_MAX: Joi.number().default(10),

  REDIS_HOST: Joi.string().required(),
  REDIS_PORT: Joi.number().default(6379),
  REDIS_PASSWORD: Joi.string().allow('').optional(),
  REDIS_TLS: Joi.boolean().default(false),

  JWT_SECRET: Joi.string().min(32).required(),
  JWT_ACCESS_TTL: Joi.number().default(900),
  JWT_REFRESH_TTL: Joi.number().default(2592000),

  S3_ENDPOINT: Joi.string().uri().required(),
  S3_REGION: Joi.string().default('us-east-1'),
  S3_BUCKET: Joi.string().required(),
  S3_ACCESS_KEY: Joi.string().optional(),
  S3_SECRET_KEY: Joi.string().optional(),
  S3_FORCE_PATH_STYLE: Joi.boolean().default(true),
  S3_USE_IAM_ROLE: Joi.boolean().default(false),

  MAX_MESSAGE_LENGTH: Joi.number().default(4000),
  MAX_ATTACHMENT_MB: Joi.number().default(10),
  MAX_ATTACHMENTS_PER_MESSAGE: Joi.number().default(5),

  RATE_LIMIT_MESSAGES_PER_MINUTE: Joi.number().default(30),
  RATE_LIMIT_WS_EVENTS_PER_MINUTE: Joi.number().default(120),

  CLAMAV_ENABLED: Joi.boolean().default(false),
  CLAMAV_HOST: Joi.string().optional(),
  CLAMAV_PORT: Joi.number().optional(),

  ENCRYPT_MESSAGE_BODY: Joi.boolean().default(true),
  KMS_DRIVER: Joi.string().valid('local', 'aws').default('local'),
  KMS_LOCAL_KEYS: Joi.string().optional(),
  KMS_LOCAL_ACTIVE: Joi.string().optional(),
  AWS_KMS_KEY_ARN: Joi.string().optional(),

  OUTBOX_WORKER_ENABLED: Joi.boolean().default(true),

  EMAIL_DRIVER: Joi.string().valid('log', 'smtp').default('log'),
  EMAIL_FROM: Joi.string().email().default('noreply@example.com'),
  EMAIL_THROTTLE_MINUTES: Joi.number().default(10),

  METRICS_ENABLED: Joi.boolean().default(false),
  METRICS_NAMESPACE: Joi.string().default('Messaging'),
  AWS_REGION: Joi.string().default('eu-west-3'),

  // --- Phase 4 : tracing & logs ---
  TRACING_ENABLED: Joi.boolean().default(false),
  OTEL_EXPORTER_OTLP_ENDPOINT: Joi.string().uri().default('http://localhost:4318/v1/traces'),
  OTEL_SERVICE_NAME: Joi.string().default('messaging-api'),
  LOG_LEVEL: Joi.string().valid('trace', 'debug', 'info', 'warn', 'error', 'fatal').default('info'),
  APP_VERSION: Joi.string().default('0.4.0'),
});
