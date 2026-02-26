const { execSync } = require('child_process');

module.exports = async function globalTeardown() {
  console.log('\n🧹 Cleaning up E2E test environment...\n');

  try {
    // Stop and remove the test database
    console.log('🛑 Stopping PostgreSQL test container...');
    execSync(
      'docker compose -p meta-sphere-test -f docker-compose.test.yml down -v',
      {
        stdio: 'inherit',
      },
    );

    console.log('✅ E2E test environment cleanup complete!\n');
  } catch (error) {
    console.error('❌ Failed to cleanup E2E test environment:', error);
  }
};
