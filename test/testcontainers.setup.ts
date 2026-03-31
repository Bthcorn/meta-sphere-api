import {
  PostgreSqlContainer,
  StartedPostgreSqlContainer,
} from '@testcontainers/postgresql';
import { RedisContainer, StartedRedisContainer } from '@testcontainers/redis';
import { GenericContainer, StartedTestContainer, Wait } from 'testcontainers';

export interface TestContainers {
  postgres: StartedPostgreSqlContainer;
  redis: StartedRedisContainer;
  minio: StartedTestContainer;
  livekit: StartedTestContainer;
}

export interface TestEnvironment {
  DATABASE_URL: string;
  REDIS_URL: string;
  MINIO_ENDPOINT: string;
  MINIO_PORT: string;
  MINIO_ACCESS_KEY: string;
  MINIO_SECRET_KEY: string;
  MINIO_USE_SSL: string;
  MINIO_BUCKET: string;
  LIVEKIT_URL: string;
  LIVEKIT_API_KEY: string;
  LIVEKIT_API_SECRET: string;
}

// Global storage for containers (accessible across module imports in the same process)
declare global {
  var __TESTCONTAINERS__: TestContainers | undefined;
}

export async function startContainers(): Promise<TestContainers> {
  console.log('\n🚀 Starting testcontainers...\n');

  // Start all containers in parallel for faster setup
  // First, start redis as LiveKit depends on it
  const redis = await new RedisContainer('redis:7-alpine')
    .start()
    .then((container) => {
      console.log('✅ Redis container started');
      return container;
    });

  const redisHost = redis.getHost();
  const redisPort = redis.getMappedPort(6379);

  const [postgres, minio, livekit] = await Promise.all([
    // PostgreSQL container
    new PostgreSqlContainer('postgres:16-alpine')
      .withDatabase('metasphere_test')
      .withUsername('postgres')
      .withPassword('postgres')
      .withTmpFs({ '/var/lib/postgresql/data': 'rw' })
      .start()
      .then((container) => {
        console.log('✅ PostgreSQL container started');
        return container;
      }),

    // MinIO container
    new GenericContainer('minio/minio:latest')
      .withEnvironment({
        MINIO_ROOT_USER: 'minioadmin',
        MINIO_ROOT_PASSWORD: 'minioadmin',
      })
      .withCommand(['server', '/data'])
      .withExposedPorts(9000)
      .withWaitStrategy(
        Wait.forHttp('/minio/health/live', 9000).forStatusCode(200),
      )
      .start()
      .then((container) => {
        console.log('✅ MinIO container started');
        return container;
      }),

    // LiveKit container
    new GenericContainer('livekit/livekit-server:latest')
      .withCommand([
        '--dev',
        '--bind',
        '0.0.0.0',
        '--redis-host',
        'host.testcontainers.internal',
        '--redis-password',
        '""',
      ])
      .withExtraHosts([
        { host: 'host.testcontainers.internal', ipAddress: 'host-gateway' },
      ])
      .withExposedPorts(7880, 7881, 7882)
      .withWaitStrategy(Wait.forLogMessage(/starting LiveKit server/i))
      .start()
      .then((container) => {
        console.log('✅ LiveKit container started');
        return container;
      })
      .catch((e) => {
        console.error(
          'Failed to start LiveKit, falling back to standalone without redis...',
          e,
        );
        return new GenericContainer('livekit/livekit-server:latest')
          .withCommand(['--dev', '--bind', '0.0.0.0'])
          .withExposedPorts(7880, 7881, 7882)
          .withWaitStrategy(Wait.forLogMessage(/starting LiveKit server/i))
          .start()
          .then((c) => {
            console.log('✅ LiveKit container started (Standalone fallback)');
            return c;
          });
      }),
  ]);

  const containers = { postgres, redis, minio, livekit };
  globalThis.__TESTCONTAINERS__ = containers;

  console.log('\n✅ All testcontainers started successfully!\n');

  return containers;
}

export function getTestEnvironment(
  testContainers: TestContainers,
): TestEnvironment {
  const { postgres, redis, minio, livekit } = testContainers;

  return {
    DATABASE_URL: postgres.getConnectionUri(),
    REDIS_URL: redis.getConnectionUrl(),
    MINIO_ENDPOINT: minio.getHost(),
    MINIO_PORT: minio.getMappedPort(9000).toString(),
    MINIO_ACCESS_KEY: 'minioadmin',
    MINIO_SECRET_KEY: 'minioadmin',
    MINIO_USE_SSL: 'false',
    MINIO_BUCKET: 'test-bucket',
    LIVEKIT_URL: `http://${livekit.getHost()}:${livekit.getMappedPort(7880)}`,
    LIVEKIT_API_KEY: 'devkey',
    LIVEKIT_API_SECRET: 'secret',
  };
}

export async function stopContainers(): Promise<void> {
  const containers = globalThis.__TESTCONTAINERS__;
  if (!containers) {
    console.log('No containers to stop');
    return;
  }

  console.log('\n🧹 Stopping testcontainers...\n');

  await Promise.all([
    containers.postgres
      .stop()
      .then(() => console.log('✅ PostgreSQL container stopped')),
    containers.redis
      .stop()
      .then(() => console.log('✅ Redis container stopped')),
    containers.minio
      .stop()
      .then(() => console.log('✅ MinIO container stopped')),
    containers.livekit
      .stop()
      .then(() => console.log('✅ LiveKit container stopped')),
  ]);

  globalThis.__TESTCONTAINERS__ = undefined;

  console.log('\n✅ All testcontainers stopped!\n');
}

export function getContainers(): TestContainers | undefined {
  return globalThis.__TESTCONTAINERS__;
}
