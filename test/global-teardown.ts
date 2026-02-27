import { stopContainers } from './testcontainers.setup';

export default async function globalTeardown(): Promise<void> {
  console.log('\n🧹 Cleaning up E2E test environment...\n');

  try {
    await stopContainers();
    console.log('✅ E2E test environment cleanup complete!\n');
  } catch (error) {
    console.error('❌ Failed to cleanup E2E test environment:', error);
    // Don't throw - cleanup should not fail the test run
  }
}
