/**
 * Development seed — creates a default admin user.
 *
 * Safe to run multiple times: uses upsert on username.
 *
 * Credentials are read from environment variables so you can
 * override them in .env without touching this file:
 *
 *   SEED_ADMIN_USERNAME  (default: admin)
 *   SEED_ADMIN_EMAIL     (default: admin@metasphere.dev)
 *   SEED_ADMIN_PASSWORD  (default: Admin1234!)
 *   SEED_ADMIN_FIRSTNAME (default: Super)
 *   SEED_ADMIN_LASTNAME  (default: Admin)
 */

import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient, UserRole } from '../src/generated/prisma/client';
import * as bcrypt from 'bcrypt';

const adapter = new PrismaPg({ connectionString: process.env.DATABASE_URL });
const prisma = new PrismaClient({ adapter });

async function main() {
  const username = process.env.SEED_ADMIN_USERNAME ?? 'admin';
  const email = process.env.SEED_ADMIN_EMAIL ?? 'admin@metasphere.dev';
  const password = process.env.SEED_ADMIN_PASSWORD ?? 'Admin1234!';
  const firstName = process.env.SEED_ADMIN_FIRSTNAME ?? 'Super';
  const lastName = process.env.SEED_ADMIN_LASTNAME ?? 'Admin';

  const hashedPassword = await bcrypt.hash(password, 10);

  const admin = await prisma.user.upsert({
    where: { username },
    create: {
      username,
      email,
      password: hashedPassword,
      firstName,
      lastName,
      role: UserRole.ADMIN,
    },
    update: {
      email,
      password: hashedPassword,
      role: UserRole.ADMIN,
    },
  });

  console.log(`✔  Admin user ready — id: ${admin.id}  username: ${admin.username}  role: ${admin.role}`);
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
