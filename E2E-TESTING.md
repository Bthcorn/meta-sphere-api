# E2E Testing Guide

This document explains how end-to-end (e2e) tests work in this repository and how to run them.

## Overview

E2E tests in this project validate the complete functionality of API endpoints by:

- Spinning up a real PostgreSQL database in Docker
- Running the full NestJS application
- Making actual HTTP requests to test the API behavior
- Verifying responses and side effects in the database

## Prerequisites

Before running e2e tests locally, ensure you have:

- **Node.js 20+** (or the version specified in `.nvmrc`)
- **pnpm** (package manager)
- **Docker** and **Docker Compose v2** installed
- A `.env.test` file with test database credentials (see [.env.test](.env.test))

### Installing Docker Compose V2

On GitHub Actions runners, Docker Compose V2 comes pre-installed as a Docker CLI plugin. Locally, make sure you have:

```bash
docker compose version
```

If you see `docker: 'compose' is not a docker command`, upgrade Docker Desktop or install Docker Compose V2.

## Running E2E Tests

### Locally

```bash
# Run all e2e tests
pnpm test:e2e
```

## How E2E Tests Work

### Test Lifecycle

1. **Global Setup** ([test/setup-e2e.js](test/setup-e2e.js))
   - Starts a PostgreSQL Docker container
   - Waits for the database to be ready
   - Runs Prisma migrations to set up the schema
   - Prints status messages

2. **Test Execution**
   - Jest loads all `*.e2e-spec.ts` files
   - Each test file creates a NestJS application instance
   - Tests make HTTP requests using supertest
   - Database state is verified with Prisma

3. **Global Teardown** ([test/teardown-e2e.js](test/teardown-e2e.js))
   - Stops and removes the PostgreSQL container
   - Cleans up all docker volumes

### Jest Configuration

Configuration is in [test/jest-e2e.json](test/jest-e2e.json):

```json
{
  "testRegex": ".e2e-spec.ts$", // Matches test files
  "globalSetup": "<rootDir>/setup-e2e.js",
  "globalTeardown": "<rootDir>/teardown-e2e.js",
  "testTimeout": 30000 // 30 second timeout per test
}
```

**Database Cleanup:**

- Database is cleaned after each test to ensure isolation

## Test Database Configuration

### `.env.test` Variables

```env
PORT=3001
JWT_ACCESS_TOKEN_SECRET=test-secret-key-for-testing
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/metasphere_test?schema=public"
```

**Key Points:**

- Test database runs on port **5433** (not 5432) to avoid conflicts with local PostgreSQL
- Database name is **metasphere_test**
- Default PostgreSQL credentials: `postgres:postgres`

### Docker Container Details

The test database runs in a Docker container with:

- **Image:** PostgreSQL (latest)
- **Container Name:** meta-sphere-test-db
- **Port Mapping:** 5433 (host) → 5432 (container)
- **Volume:** Removed after tests complete

See [docker-compose.test.yml](docker-compose.test.yml) for full details.

## Writing New E2E Tests

### Basic Test Structure

```typescript
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';
import { App } from 'supertest/types';

describe('FeatureController (e2e)', () => {
  let app: INestApplication<App>;
  let prismaService: PrismaService;

  beforeAll(async () => {
    // Create NestJS application
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.useGlobalPipes(new ValidationPipe());
    app.setGlobalPrefix('api');

    prismaService = moduleFixture.get<PrismaService>(PrismaService);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  afterEach(async () => {
    // Clean up test data
    await prismaService.yourModel.deleteMany({});
  });

  it('should do something', async () => {
    const response = await request(app.getHttpServer())
      .post('/api/route')
      .send({ data: 'test' })
      .expect(201);

    expect(response.body).toHaveProperty('id');
  });
});
```

### Testing Tips

**Use `afterEach` for cleanup** - Isolate tests by clearing data between runs
