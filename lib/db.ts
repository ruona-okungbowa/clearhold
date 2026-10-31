// Prisma client for the holds database. Server-side only: it reads DATABASE_URL from the environment.

import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from './generated/prisma/client';

// One client per process: Next's dev server re-evaluates modules on every edit.
const globalForDb = globalThis as unknown as { db?: PrismaClient };

export const db =
  globalForDb.db ?? new PrismaClient({ adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL }) });

if (process.env.NODE_ENV !== 'production') globalForDb.db = db;
