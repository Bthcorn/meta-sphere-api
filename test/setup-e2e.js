const { execSync } = require('child_process');
const dotenv = require('dotenv');
const path = require('path');

// Load test environment variables
dotenv.config({ path: path.resolve(__dirname, '../.env.test') });

module.exports = async function globalSetup() {
  console.log('\n🚀 Setting up E2E test environment...\n');

  try {
    // Start the test database
    console.log('📦 Starting PostgreSQL test container...');
    execSync(
      'docker-compose -p meta-sphere-test -f docker-compose.test.yml up -d',
      {
        stdio: 'inherit',
      },
    );

    // Wait for database to be ready
    console.log('⏳ Waiting for database to be ready...');
    let retries = 30;
    while (retries > 0) {
      try {
        execSync('docker exec meta-sphere-test-db pg_isready -U postgres', {
          stdio: 'pipe',
        });
        break;
      } catch {
        retries--;
        if (retries === 0) {
          throw new Error('Database failed to start');
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
    }

    // Run database migrations
    console.log('🔄 Running database migrations...');
    execSync('npx prisma migrate deploy', {
      stdio: 'inherit',
      env: { ...process.env, DATABASE_URL: process.env.DATABASE_URL },
    });

    console.log('✅ E2E test environment setup complete!\n');
  } catch (error) {
    console.error('❌ Failed to setup E2E test environment:', error);
    throw error;
  }
};
