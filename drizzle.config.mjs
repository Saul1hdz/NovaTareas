import 'dotenv/config';
import { defineConfig } from 'drizzle-kit';

export default defineConfig({
  schema: './src/db/postgres/schema.js',
  out: './migrations/postgresql',
  dialect: 'postgresql',
  dbCredentials: {
    url: process.env.DATABASE_URL
      || 'postgresql://novatareas:devpassword@127.0.0.1:5434/novatareas',
  },
  strict: true,
  verbose: true,
});
