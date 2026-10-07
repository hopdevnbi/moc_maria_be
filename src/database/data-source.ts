import 'dotenv/config';
import { DataSource } from 'typeorm';
import { buildDatabaseOptionsFromEnv } from './database-options';

const AppDataSource = new DataSource(buildDatabaseOptionsFromEnv(process.env, true));

export default AppDataSource;
