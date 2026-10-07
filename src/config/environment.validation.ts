import Joi from 'joi';

export const environmentValidationSchema = Joi.object({
  NODE_ENV: Joi.string().valid('development', 'test', 'production').default('development'),
  PORT: Joi.number().integer().min(1).max(65535).default(3000),
  CORS_ORIGINS: Joi.string().default('http://localhost:3001'),
  SWAGGER_ENABLED: Joi.boolean().truthy('true').falsy('false').default(true),

  DATABASE_URL: Joi.string().allow('').optional(),
  DATABASE_MIGRATION_URL: Joi.string().allow('').optional(),
  DATABASE_HOST: Joi.string().allow('').default(''),
  DATABASE_PORT: Joi.number().integer().min(1).max(65535).default(5432),
  DATABASE_NAME: Joi.string().default('postgres'),
  DATABASE_USER: Joi.string().default('postgres'),
  DATABASE_PASSWORD: Joi.string().allow('').default(''),
  DATABASE_SSL: Joi.boolean().truthy('true').falsy('false').default(true),
  DATABASE_SSL_REJECT_UNAUTHORIZED: Joi.boolean().truthy('true').falsy('false').default(true),
  DATABASE_POOL_MAX: Joi.number().integer().min(1).max(100).default(10),

  APP_ID: Joi.string().valid('MOC_MARIA').default('MOC_MARIA'),
  CHAT_TENANT: Joi.string().valid('MOC_MARIA').default('MOC_MARIA'),
  QUEUE_SOURCE: Joi.string().valid('MOC_MARIA').default('MOC_MARIA'),
  CHAT_SERVICE_URL: Joi.string().uri().allow('').default(''),
  QUEUE_SERVICE_URL: Joi.string().uri().allow('').default(''),
});
