import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { buildDatabaseOptionsFromEnv } from './database-options';

@Module({
  imports: [
    TypeOrmModule.forRootAsync({
      useFactory: () => buildDatabaseOptionsFromEnv(process.env),
    }),
  ],
})
export class DatabaseModule {}
