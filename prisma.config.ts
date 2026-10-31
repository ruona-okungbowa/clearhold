import { defineConfig } from 'prisma/config';

// The CLI does not read .env files; locally DATABASE_URL lives in .env.local, on Vercel in the environment.
try {
  process.loadEnvFile('.env.local');
} catch {}

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL },
});
