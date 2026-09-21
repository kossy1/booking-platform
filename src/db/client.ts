import { Kysely, MysqlDialect } from 'kysely';
import { createPool } from 'mysql2';
import { config } from '../config.js';
import type { DB } from './types.js';

const pool = createPool({
  uri: config.DATABASE_URL,
  connectionLimit: 20,
  waitForConnections: true,
  timezone: 'Z',        // return dates in UTC
  dateStrings: false,
  supportBigNumbers: true,
  bigNumberStrings: false,
  // MariaDB in XAMPP doesn't support caching_sha2_password (MySQL 8 default)
  // If auth fails, add: authPlugins: { mysql_clear_password: () => () => Buffer.from('') }
});

export const db = new Kysely<DB>({
  dialect: new MysqlDialect({ pool }),
});

process.on('SIGTERM', () => pool.end());
process.on('SIGINT', () => pool.end());