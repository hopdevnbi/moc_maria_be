# Mộc Maria Backend

Independent NestJS API for the Mộc Maria Wellness Platform.

## Stack

- Node.js 22
- NestJS 11
- PostgreSQL (Supabase)
- TypeORM migrations
- Joi environment validation
- Pino logging
- Swagger/OpenAPI

## Local setup

1. Copy .env.example to .env.
2. Configure PostgreSQL values.
3. npm install
4. npm run migration:run
5. npm run start:dev

API base: http://localhost:3000/api/v1

Health:
- /api/v1/health/live
- /api/v1/health/ready

Swagger:
- /api/v1/docs

## Boundaries

This service owns Mộc Maria business data. It does not share the Acutis Education database.
Chat and Queue are external shared platform services and will be integrated through explicit
contracts in later phases.