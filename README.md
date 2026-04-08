# Meta Sphere API

Backend API for **Meta Sphere** — a real-time collaborative virtual campus platform where users can join 3D spaces, host sessions, collaborate on whiteboards, share files, and communicate via live chat and voice.

Built with [NestJS](https://nestjs.com/), PostgreSQL, Redis, MinIO, and LiveKit.

---

## Features

- **Virtual Rooms** — persistent 3D spaces with public/private access and capacity management
- **Sessions** — time-boxed events (meetings, study groups) within rooms with full participant management
- **Real-time Presence** — user position and avatar state sync via WebSockets
- **Live Chat** — room chat, session chat, and direct messaging with typing indicators
- **Collaborative Whiteboard** — shared drawing surface with stroke history per session
- **Voice & Video** — LiveKit-powered tokens for rooms and lobby areas
- **File Library** — upload/download with MinIO; presigned URLs, per-room and per-session file access
- **Friend System** — friend requests, acceptance, and online friend tracking
- **Role-based Access** — USER and ADMIN roles with JWT authentication

---

## Tech Stack

| Layer | Technology |
|---|---|
| Framework | NestJS 11, TypeScript 5 |
| Database | PostgreSQL 16 + Prisma ORM |
| Cache / State | Redis 7 |
| File Storage | MinIO (S3-compatible) |
| Real-time | Socket.io 4 |
| Voice / Video | LiveKit |
| Auth | JWT + Passport.js |
| Validation | class-validator, class-transformer |
| API Docs | Swagger / OpenAPI |
| Testing | Jest, Supertest, TestContainers |

---

## Prerequisites

- [Node.js](https://nodejs.org/) >= 22
- [pnpm](https://pnpm.io/) >= 9
- [Docker](https://www.docker.com/) and Docker Compose

---

## Getting Started

### 1. Clone and install dependencies

```bash
git clone <repo-url>
cd meta-sphere-api
pnpm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

Edit `.env` with your values. See [Environment Variables](#environment-variables) for details.

### 3. Start infrastructure services

```bash
docker compose up -d postgres redis minio minio-init livekit
```

### 4. Run database migrations and seed

```bash
npx prisma migrate deploy
pnpm db:seed
```

### 5. Start the API

```bash
# Development (watch mode)
pnpm start:dev

# Production
pnpm build && pnpm start:prod
```

The API will be available at `http://localhost:3000`.
Swagger docs: `http://localhost:3000/api/docs`

---

## Running with Docker Compose

To start the full stack (API + all services):

```bash
docker compose up
```

The app runs database migrations automatically on startup.

---

## Environment Variables

Copy `.env.example` to `.env` and configure the values below.

| Variable | Description | Default |
|---|---|---|
| `PORT` | API listen port | `3000` |
| `NODE_ENV` | Environment (`development` / `production`) | `development` |
| `CORS_ORIGIN` | Allowed CORS origin | `http://localhost:5173` |
| `JWT_ACCESS_TOKEN_SECRET` | JWT signing secret | — |
| `DATABASE_URL` | PostgreSQL connection string | — |
| `POSTGRES_DB` | Database name | `metasphere` |
| `POSTGRES_USER` | Database user | `postgres` |
| `POSTGRES_PASSWORD` | Database password | — |
| `REDIS_URL` | Redis connection URL | `redis://localhost:6379` |
| `MINIO_ENDPOINT` | MinIO host (`localhost` or `minio` in Docker) | `localhost` |
| `MINIO_PORT` | MinIO port | `9000` |
| `MINIO_ACCESS_KEY` | MinIO access key | — |
| `MINIO_SECRET_KEY` | MinIO secret key | — |
| `MINIO_BUCKET` | MinIO bucket name | `metasphere-dev` |
| `MINIO_USE_SSL` | Enable SSL for MinIO | `false` |
| `MINIO_PUBLIC_ENDPOINT` | Public-facing URL for presigned download URLs | `http://localhost:9000` |
| `MAX_FILE_SIZE_BYTES` | Max upload size in bytes | `10485760` (10 MB) |
| `LIVEKIT_URL` | LiveKit server HTTP URL | `http://localhost:7880` |
| `LIVEKIT_PUBLIC_URL` | LiveKit WebSocket URL for clients | `ws://localhost:7880` |
| `LIVEKIT_API_KEY` | LiveKit API key | — |
| `LIVEKIT_API_SECRET` | LiveKit API secret | — |
| `SEED_ADMIN_USERNAME` | Admin username (seed script only) | `admin` |
| `SEED_ADMIN_EMAIL` | Admin email (seed script only) | `admin@metasphere.dev` |
| `SEED_ADMIN_PASSWORD` | Admin password (seed script only) | — |

---

## API Overview

All REST endpoints are prefixed with `/api`. Full interactive documentation is available at `/api/docs`.

| Resource | Base Path | Description |
|---|---|---|
| Auth | `/api/auth` | Register, login, logout, current profile |
| Users | `/api/users` | Profile management, status updates, avatar |
| Rooms | `/api/rooms` | List, join, and leave virtual rooms |
| Sessions | `/api/sessions` | Create/manage sessions, participants, voice tokens |
| Messages | `/api/messages` | Room, session, and direct message history |
| Files | `/api/files` | Upload, download, and manage library files |
| Friends | `/api/friends` | Friend requests, friend list, online friends |
| Voice | `/api/voice` | LiveKit tokens for lobby and room areas |
| Admin | `/api/admin` | Room creation (ADMIN role required) |

### WebSocket Gateways

| Gateway | Events | Description |
|---|---|---|
| Realtime | `request_state`, `update_position`, `update_avatar` | User presence and avatar sync |
| Chat | `chat:send`, `chat:typing` | Real-time messaging and typing indicators |
| Whiteboard | `whiteboard:join`, `whiteboard:stroke`, `whiteboard:undo` | Collaborative drawing |

---

## Scripts

```bash
pnpm start:dev        # Start in watch mode (development)
pnpm start:prod       # Start production build
pnpm build            # Compile TypeScript to dist/

pnpm test             # Run unit tests
pnpm test:cov         # Unit tests with coverage report
pnpm test:e2e         # End-to-end tests (requires Docker)

pnpm db:seed          # Seed database with default admin user
pnpm lint             # Lint and auto-fix
pnpm format           # Format code with Prettier
```

---

## Testing

**Unit tests** use Jest with mocked external dependencies:

```bash
pnpm test
pnpm test:cov
```

**E2E tests** use [TestContainers](https://testcontainers.com/) to spin up isolated PostgreSQL, Redis, MinIO, and LiveKit instances automatically — no manual setup required:

```bash
pnpm test:e2e
```

E2E coverage includes auth, users, rooms, sessions, messages, files, friends, chat, whiteboard, and presence flows.

For detailed information about E2E testing setup and best practices, see [E2E-TESTING.md](E2E-TESTING.md).

---

## Project Structure

```
src/
├── auth/             # JWT authentication, login, register
├── users/            # User profiles, status, avatar
├── rooms/            # Virtual room management
├── sessions/         # Session lifecycle and participants
├── messages/         # Room, session, and direct messages
├── files/            # File uploads and MinIO integration
├── session-files/    # Session-scoped file access
├── friends/          # Friend requests and social graph
├── realtime/         # WebSocket presence gateway
├── chat/             # WebSocket chat gateway
├── whiteboard/       # WebSocket whiteboard gateway
├── livekit/          # Voice/video token generation
├── presence/         # Online status tracking
├── admin/            # Admin-only operations
├── redis/            # Redis service
├── prisma/           # Prisma ORM service
└── common/           # Shared guards and decorators

prisma/
├── schema.prisma     # Database schema
├── migrations/       # Migration history
└── seed.ts           # Database seed script

test/
└── *.e2e-spec.ts     # End-to-end test suites
```
