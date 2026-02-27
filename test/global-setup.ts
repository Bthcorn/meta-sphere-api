import { execSync } from 'child_process';
import {
  startContainers,
  getTestEnvironment,
  TestContainers,
} from './testcontainers.setup';

export default async function globalSetup(): Promise<void> {
  console.log('\n🚀 Setting up E2E test environment with testcontainers...\n');

  try {
    // Start containers
    const containers: TestContainers = await startContainers();

    // Get environment variables from containers
    const env = getTestEnvironment(containers);

    // Set environment variables for tests (inherited by worker processes)
    process.env.DATABASE_URL = env.DATABASE_URL;
    process.env.REDIS_URL = env.REDIS_URL;
    process.env.MINIO_ENDPOINT = env.MINIO_ENDPOINT;
    process.env.MINIO_PORT = env.MINIO_PORT;
    process.env.MINIO_ACCESS_KEY = env.MINIO_ACCESS_KEY;
    process.env.MINIO_SECRET_KEY = env.MINIO_SECRET_KEY;
    process.env.MINIO_USE_SSL = env.MINIO_USE_SSL;
    process.env.MINIO_BUCKET = env.MINIO_BUCKET;
    process.env.JWT_ACCESS_TOKEN_SECRET = 'test-jwt-secret';
    process.env.JWT_EXPIRES_IN = '1h';

    // Run database migrations
    console.log('🔄 Running database migrations...');
    execSync('npx prisma migrate deploy', {
      stdio: 'inherit',
      env: {
        ...process.env,
        DATABASE_URL: env.DATABASE_URL,
      },
    });

    console.log('✅ E2E test environment setup complete!\n');
    console.log('📝 Environment:');
    console.log(`   DATABASE_URL: ${env.DATABASE_URL}`);
    console.log(`   REDIS_URL: ${env.REDIS_URL}`);
    console.log(`   MINIO: ${env.MINIO_ENDPOINT}:${env.MINIO_PORT}\n`);
  } catch (error) {
    console.error('❌ Failed to setup E2E test environment:', error);
    throw error;
  }
}
