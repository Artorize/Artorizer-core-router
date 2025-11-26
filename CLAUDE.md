# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Artorizer Core Router is a high-performance ingress API for the Artorizer image protection pipeline. It routes client requests, validates metadata, checks for duplicates, and forwards jobs to the processor core.

**Architecture Flow:**
```
Client → Router POST /protect (optional: with auth cookie)
          ↓
    Router extracts user info (if authenticated)
          ↓
    Router POST /artworks/check-exists → Backend (with user headers: X-User-Id, X-User-Email, X-User-Name)
          ↓                                   ↓
    If duplicate found ────────────> Return existing artwork (200)
          ↓
    If new artwork:
          ↓
    1. Router POST /tokens → Backend (generates one-time auth token, with user headers)
          ↓
    2. Router POST /v1/process/artwork → Processor
          (includes backend_url + one-time token + user_id in metadata)
          ↓
    3. Processor processes image
          ↓
    4. Processor POST /artworks → Backend (using one-time token)
          (uploads to GridFS + MongoDB, associates with user_id)
          ↓
    5. Processor POST /callbacks/process-complete → Router
          (sends backend artwork_id)
          ↓
    6. Router updates job state in Redis (completed/failed)
          ↓
    7. Client queries: GET /jobs/{id} (via Router → Backend API, with user headers)
```

**User Authentication Flow (Optional - Better Auth via Backend):**
```
Client → GET /auth/signin/google (or /github) [proxied to backend]
          ↓
    Router proxies request to Backend
          ↓
    OAuth Provider (Google/GitHub)
          ↓
    GET /auth/callback/google [backend handles OAuth]
          ↓
    Backend Better Auth creates session → Sets httpOnly cookie (better-auth.session_token)
          ↓
    Cookie returned to client via router proxy
          ↓
    Client makes requests with session cookie
          ↓
    Router middleware (optionalAuth) validates session via backend API
          ↓
    User info extracted and forwarded to Backend (X-User-Id, X-User-Email, X-User-Name)
          ↓
    Backend associates operations with authenticated user
```

## Common Commands

### Development
```bash
npm run dev          # Start with hot reload (tsx watch)
```

### Production
```bash
npm run build        # Compile TypeScript to dist/
npm start            # Run compiled code (node dist/index.js)
```

### Testing
```bash
npm test             # Run integration tests once
npm run test:watch   # Run tests in watch mode
npm run test:ui      # Run tests with UI
```

### Maintenance
```bash
npm run clean        # Remove dist/ folder
```

## Architecture

### Clustering Model

The router uses Node.js cluster module for multi-process concurrency:
- **Primary Process**: Manages worker processes, handles crashes, graceful shutdown
- **Worker Processes**: Each runs a full Fastify instance on the same port (OS handles load balancing)
- **Number of Workers**: Configured via `WORKERS` env var (default: 4), capped at CPU core count

The clustering is implemented in `src/index.ts`. When `WORKERS > 1`, the primary process forks workers. When `WORKERS = 1`, runs as single process.

### Request Flow

1. **Entry** (`src/index.ts`): Cluster orchestration, worker management
2. **Application** (`src/app.ts`): Fastify setup, middleware, CORS, multipart handling, auth proxy to backend
3. **Authentication** (`src/services/auth.service.ts`, `src/middleware/auth.middleware.ts`): Session validation via backend API, user extraction
4. **Routing** (`src/routes/protect.ts`): Main `/protect` endpoint logic with optional auth
5. **Validation** (`src/types/schemas.ts`): Zod schemas for type-safe validation
6. **Services**:
   - `job-tracker.service.ts`: Redis-based job state tracking (processing/completed/failed status)
   - `duplicate.service.ts`: Backend API client for duplicate detection + artwork queries (with user header forwarding)
   - `processor.service.ts`: HTTP client with circuit breaker + callback-based workflow (includes backend URL for direct upload)
   - `backend.service.ts`: HTTP client for backend interactions (token generation, with user header forwarding)
   - `upload.service.ts`: Deprecated - no longer needed (processor uploads directly to backend)
   - `queue.service.ts`: Bull/Redis queue (prepared for future async processing)
7. **Utilities** (`src/utils/normalize.ts`): Field normalization (camelCase ↔ snake_case), boolean parsing, tag validation

### Data Processing Pipeline

```
Request → Content-type detection (multipart/JSON)
       → Image extraction & SHA256 checksum (if file)
       → Field normalization (camelCase → snake_case)
       → Boolean/array parsing ("true" → true, "a,b" → ["a","b"])
       → Zod validation
       → Duplicate check (Backend API: checksum → title+artist → tags)
       → If duplicate: return existing artwork (200)
       → If new:
           → Generate UUID job_id
           → Generate one-time auth token (Backend POST /tokens)
           → Track job in Redis with "processing" status
           → Submit to processor with backend_url + one-time token (202 with status: "processing")
           → Processor processes and uploads directly to backend (using token)
           → Processor sends callback with backend artwork_id
           → Update job state in Redis with "completed" or "failed" status
```

### Circuit Breaker Pattern

`processor.service.ts` implements a circuit breaker:
- **Closed** (normal): Forwards all requests
- **Open** (triggered after 5 consecutive failures): Immediately returns 503
- **Reset**: After 30 seconds, attempts one request (half-open), closes if successful

This prevents cascade failures when the processor is down.

## Configuration

All config is in `src/config.ts` using Zod validation. Environment variables:

**Server Configuration:**
- `PORT`: Server port (default: `7000`)
- `HOST`: Server host (default: `127.0.0.1`)
- `NODE_ENV`: Environment mode - `development`, `production`, or `test` (default: `development`)
- `WORKERS`: Number of worker processes (default: `4`, or set to `auto` for CPU count)

**Authentication Configuration (Optional - via Backend):**
- `AUTH_ENABLED`: Enable/disable authentication (default: `false`)
- `ALLOWED_ORIGINS`: CORS allowed origins (default: `http://localhost:8080`)

**Note:** Router delegates all authentication to the backend. OAuth configuration, Better Auth setup, and database storage are all handled by the backend service. See [AUTH_README.md](AUTH_README.md) for complete authentication setup guide.

**External Services:**
- `BACKEND_URL`: Backend storage API endpoint - handles all database operations (default: `http://localhost:5001`)
- `BACKEND_TIMEOUT`: HTTP timeout for backend requests (default: `30000` ms)
- `PROCESSOR_URL`: Processor core API endpoint (default: `http://localhost:8000`)
- `PROCESSOR_TIMEOUT`: HTTP timeout for processor requests (default: `30000` ms)

**Redis Configuration:**
- `REDIS_HOST`: Redis host for Bull queue and job tracking (default: `localhost`)
- `REDIS_PORT`: Redis port (default: `6379`)
- `REDIS_PASSWORD`: Redis password (optional)

**Router Configuration:**
- `ROUTER_BASE_URL`: Router's own base URL for callbacks and public download URLs (default: `http://localhost:7000`)
- `CALLBACK_AUTH_TOKEN`: Secret token for validating processor callbacks (default: `change-this-to-a-secure-random-token`)

**Upload Configuration:**
- `MAX_FILE_SIZE`: Upload limit in bytes (default: `268435456` = 256MB)

**Rate Limiting:**
- `RATE_LIMIT_MAX`: Maximum requests per window (default: `100`)
- `RATE_LIMIT_WINDOW`: Time window in milliseconds (default: `60000` = 1 minute)

**Note:** All environment variables have defaults and are technically optional, but you should configure external service URLs and secrets for production use.

See `.env.example` for all available options.

## API Endpoints

### Authentication Endpoints (Optional - Proxied to Backend)

When `AUTH_ENABLED=true`, authentication endpoints are proxied to the backend:

- **`GET /auth/signin/google`** - Initiate Google OAuth flow (proxied to backend)
- **`GET /auth/signin/github`** - Initiate GitHub OAuth flow (proxied to backend)
- **`GET /auth/callback/google`** - Google OAuth callback (proxied to backend)
- **`GET /auth/callback/github`** - GitHub OAuth callback (proxied to backend)
- **`GET /auth/session`** - Get current user session (proxied to backend)
- **`POST /auth/sign-out`** - Sign out and clear session (proxied to backend)

**User Object Structure:**
```typescript
{
  id: string;              // UUID
  email: string;
  name?: string;
  image?: string;         // Profile picture URL
  emailVerified: boolean;
  createdAt: string;      // ISO 8601 timestamp
}
```

**Session Management:**
- Sessions stored in MongoDB via Backend's Better Auth instance
- 7-day session duration with 1-day refresh window
- httpOnly cookies for security (`better-auth.session_token`)
- Secure cookies in production (HTTPS required)
- Router validates sessions by calling backend's `/auth/validate-session` endpoint

### POST /protect

Accepts `multipart/form-data` or `application/json`.

**Authentication:** Optional - uses `optionalAuth` middleware.

**Authentication Details:**
- When user is authenticated (session cookie present), user info is extracted and forwarded to backend via HTTP headers:
  - `X-User-Id`: User's unique identifier
  - `X-User-Email`: User's email address
  - `X-User-Name`: User's display name
- Backend uses these headers to:
  - Associate uploaded artwork with the authenticated user
  - Enable user-specific queries and access control
  - Track artwork ownership
- Anonymous uploads (no session) are still accepted and processed
- If artwork is associated with a user, it can be retrieved via `GET /artworks/me` (backend endpoint)

**Required fields:**
- `artist_name` (string, 1-120 chars)
- `artwork_title` (string, 1-200 chars)
- One of: `image` (file) | `image_url` (URL) | `local_path` (string)

**Response:**
- `202 Accepted`: `{"job_id": "...", "status": "processing"}` (new job submitted for processing)
- `200 OK`: `{"job_id": "...", "status": "exists", "artwork": {...}}` (duplicate)
- `400 Bad Request`: Validation error
- `503 Service Unavailable`: Circuit breaker open

### POST /callbacks/process-complete

Receives async completion callback from processor after it uploads artwork to backend.

**Authorization:** Validates `Authorization` header against `CALLBACK_AUTH_TOKEN`

**Request body:**
```json
{
  "job_id": "uuid",
  "status": "completed|failed",
  "backend_artwork_id": "60f7b3b3b3b3b3b3b3b3b3b3",
  "processing_time_ms": 1234,
  "result": {
    "hashes": { "perceptual_hash": "0x...", ... },
    "metadata": { "artist_name": "...", "artwork_title": "..." },
    "watermark": { "strategy": "tree-ring", ... }
  }
}
```

**Processing:**
1. Validates authorization token
2. Updates job state in Redis with completion status
3. Logs job completion with backend artwork ID
4. Returns acknowledgment (no file transfers needed)

**Response:**
- `200 OK`: `{"received": true, "job_id": "...", "artwork_id": "...", "status": "completed"}`
- `401 Unauthorized`: Invalid auth token
- `400 Bad Request`: Missing backend_artwork_id (processor should upload to backend first)

### POST /callbacks/process-progress

Receives progress updates from processor during processing (step-by-step tracking).

**Authorization:** Validates `Authorization` header against `CALLBACK_AUTH_TOKEN`

**Request body:**
```json
{
  "job_id": "uuid",
  "current_step": "Extracting image features",
  "step_number": 2,
  "total_steps": 5,
  "percentage": 40,
  "details": {
    "optional": "additional context about current step"
  }
}
```

**Processing:**
1. Validates authorization token
2. Updates job progress in Redis
3. Clients can poll GET /jobs/{id} to see current progress
4. Returns acknowledgment

**Response:**
- `200 OK`: `{"received": true, "job_id": "...", "message": "Progress update received"}`
- `401 Unauthorized`: Invalid auth token
- `400 Bad Request`: Missing required fields (job_id, current_step)

**Usage by Processor:**
The processor should call this endpoint at the start of each major processing step to provide real-time progress updates to clients. The `current_step` should describe which processor or layer is currently executing. Example progress updates:

```json
// Step 1: Metadata processor
{
  "job_id": "uuid",
  "current_step": "Processing metadata extraction",
  "step_number": 1,
  "total_steps": 8,
  "percentage": 12,
  "details": {"processor": "metadata", "operation": "extract_exif"}
}

// Step 2: ImageHash processor
{
  "job_id": "uuid",
  "current_step": "Processing imagehash",
  "step_number": 2,
  "total_steps": 8,
  "percentage": 25,
  "details": {"processor": "imagehash", "hash_type": "perceptual"}
}

// Step 3: DHash processor
{
  "job_id": "uuid",
  "current_step": "Processing dhash",
  "step_number": 3,
  "total_steps": 8,
  "percentage": 37,
  "details": {"processor": "dhash"}
}

// Step 4: Fawkes protection layer
{
  "job_id": "uuid",
  "current_step": "Applying Fawkes protection",
  "step_number": 4,
  "total_steps": 8,
  "percentage": 50,
  "details": {"protection_layer": "fawkes"}
}

// Step 5: Tree-ring watermark
{
  "job_id": "uuid",
  "current_step": "Applying tree-ring watermark",
  "step_number": 5,
  "total_steps": 8,
  "percentage": 62,
  "details": {"watermark_strategy": "tree-ring", "strength": 0.5}
}

// Final step: Upload to backend
{
  "job_id": "uuid",
  "current_step": "Uploading results to backend",
  "step_number": 8,
  "total_steps": 8,
  "percentage": 95,
  "details": {"operation": "upload"}
}
```

### GET /jobs/{id}

Get job status. Checks Redis first for processing jobs, then falls back to backend for completed jobs.

**Authentication:** Optional - uses `optionalAuth` middleware.

**Authentication Details:**
- When user is authenticated, user context is forwarded to backend via headers for access control
- Backend may restrict job details based on artwork ownership
- Anonymous users can query their jobs by job_id
- Authenticated users can retrieve more detailed information about their artwork

**Response:**
- `200 OK` (processing):
```json
{
  "job_id": "...",
  "status": "processing",
  "submitted_at": "...",
  "message": "Job is currently being processed",
  "processor_config": {
    "processors": ["metadata", "imagehash", "dhash"],
    "watermark_strategy": "tree-ring",
    "protection_layers": {
      "fawkes": true,
      "photoguard": true,
      "mist": true,
      "nightshade": true
    },
    "total_steps": 8
  },
  "progress": {
    "current_step": "Processing imagehash",
    "step_number": 2,
    "total_steps": 8,
    "percentage": 25,
    "updated_at": "...",
    "details": {
      "processor": "imagehash",
      "hash_type": "perceptual"
    }
  }
}
```
  - `processor_config`: Shows which processors/layers will be executed and expected total_steps
  - `progress`: Included if the processor has sent progress updates
- `200 OK` (completed): `{"job_id": "...", "status": "completed", "submitted_at": "...", "completed_at": "...", "backend_artwork_id": "..."}`
- `200 OK` (failed): `{"job_id": "...", "status": "failed", "submitted_at": "...", "completed_at": "...", "error": {...}}`
- `404 Not Found`: Job doesn't exist

### GET /jobs/{id}/result

Get complete job result with backend URLs. Returns 409 if job is still processing.

**Authentication:** Optional - uses `optionalAuth` middleware.

**Authentication Details:**
- When user is authenticated, user context is forwarded to backend for access control
- Backend may restrict result access based on artwork ownership or job creator
- Anonymous users can retrieve results by job_id
- Authenticated users get additional metadata about their artwork

**Response:**
- `200 OK`: Full artwork metadata + URLs to backend files (when completed)
- `200 OK`: Failed job details (when failed)
- `404 Not Found`: Job doesn't exist
- `409 Conflict`: Job is still processing (includes `processor_config` and `progress` fields if available)

### GET /jobs/{id}/download/{variant}

Proxy download from backend. Fetches the file from backend storage and streams it to the client.

**Variants:** `original`, `protected`, `mask`

**Authentication:** Optional - uses `optionalAuth` middleware.

**Authentication Details:**
- When user is authenticated, download access is controlled by backend based on artwork ownership
- Anonymous users can download by job_id if the artwork is public
- Authenticated users can download their own artwork
- Backend enforces access control on file availability

**Response:**
- `200 OK`: File streamed with appropriate `content-type` and `content-disposition` headers
- `404 Not Found`: Job not found or file unavailable
- `409 Conflict`: Job is still processing
- `502 Bad Gateway`: Backend download failed

### GET /health

Comprehensive health check endpoint that monitors all dependent services.

**Response:**
- `200 OK`: System healthy or degraded (with detailed service status)
- `503 Service Unavailable`: Critical services down

**Response structure:**
```json
{
  "status": "healthy|degraded|unhealthy",
  "timestamp": "ISO 8601 timestamp",
  "uptime": 123.45,
  "version": "1.0.0",
  "services": {
    "processor": {
      "status": "up|down|degraded",
      "message": "Status description",
      "responseTime": 45,
      "details": { "circuitBreaker": {...} }
    },
    "backend": {
      "status": "up|down",
      "message": "Backend and database are operational",
      "responseTime": 32
    },
    "redis": {
      "status": "up|down",
      "message": "Redis is operational",
      "responseTime": 12,
      "details": { "jobs": {...} }
    }
  }
}
```

**Service checks:**
- **Processor**: Calls `/health` on processor service, checks circuit breaker status
- **Backend**: Calls `/health` on backend service (implicitly verifies database connectivity)
- **Redis**: Tests connection via Bull queue metrics

### GET /health/live

Simple liveness probe for container orchestration (Kubernetes/Docker).

**Response:** `200 OK` with `{"status": "alive", "timestamp": "..."}`

### GET /health/ready

Readiness probe that checks if critical services (processor, backend) are available.

**Response:**
- `200 OK`: Service ready to accept traffic
- `503 Service Unavailable`: Critical dependencies unavailable

## Field Normalization

The router accepts both camelCase and snake_case field names:
- Converts camelCase → snake_case internally
- Parses boolean strings: `"true"`, `"false"`, `"1"`, `"0"` → boolean
- Parses comma-separated strings: `"tag1,tag2"` → `["tag1", "tag2"]`
- Parses JSON strings: `'{"key":"value"}'` → object

See `src/utils/normalize.ts` for implementation details.

## Validation

Uses Zod for runtime type validation (`src/types/schemas.ts`):
- `protectRequestSchema`: Main request validation with coercion, defaults, ranges
- `ALLOWED_PROCESSORS`: `['metadata', 'imagehash', 'dhash', 'blockhash', 'stegano', 'tineye']`
- `WATERMARK_STRATEGIES`: `['invisible-watermark', 'tree-ring', 'none']`

Validation errors return 400 with format: `"{field_path}: {error_message}"`

## Image Handling

Uses Sharp for image validation:
1. Stream multipart file to buffer (memory-efficient, handles 256MB)
2. Extract metadata (format, dimensions)
3. Calculate SHA256 checksum for duplicate detection
4. Forward buffer to processor via multipart

## Duplicate Detection via Backend API

`duplicate.service.ts` is an HTTP client that queries the backend API for duplicate checking and artwork retrieval.

**Backend API endpoint:** `GET /artworks/check-exists`

**Search strategies (in order):**
1. By checksum (if provided)
2. By title + artist (exact match)
3. By tags (array intersection)

Returns first match found. The backend handles all database operations, indexing, and query optimization.

**User Header Forwarding:**
When authenticated users make requests, the router forwards user context to backend via HTTP headers:
- `X-User-Id`: User's UUID
- `X-User-Email`: User's email address
- `X-User-Name`: User's display name (if available)

This allows the backend to:
- Associate artworks with specific users
- Implement user-based access control
- Track user activity and ownership
- Enable multi-tenant artwork management

## Job State Tracking

`job-tracker.service.ts` manages job states using Redis for real-time status updates:

**Job States:**
- `processing`: Job submitted to processor, work in progress
- `completed`: Processor finished successfully, artwork uploaded to backend
- `failed`: Processing encountered an error

**Processor Configuration Tracking:**
Jobs store the processor configuration from the initial request, including:
- `processors`: Array of processor names to execute (e.g., `['metadata', 'imagehash', 'dhash']`)
- `watermark_strategy`: Watermark strategy to apply (e.g., `'tree-ring'`, `'invisible-watermark'`, `'none'`)
- `protection_layers`: Which protection layers are enabled (fawkes, photoguard, mist, nightshade, stegano_embed, c2pa_manifest)
- `total_steps`: Automatically calculated based on enabled processors and layers

This allows clients to see exactly what processing will be performed and track progress against expected steps.

**Progress Tracking:**
Jobs in `processing` state can include real-time progress information:
- `current_step`: Human-readable description of current processing step (e.g., "Processing imagehash")
- `step_number`: Current step number (1-based)
- `total_steps`: Total number of processing steps (matches processor_config.total_steps)
- `percentage`: Overall progress percentage (0-100)
- `updated_at`: Timestamp of last progress update
- `details`: Optional additional context about the current step (e.g., `{"processor": "imagehash", "hash_type": "perceptual"}`)

**Redis Storage:**
- Key format: `job:{jobId}`
- TTL: 1 hour (automatic cleanup)
- Stored data: job_id, status, submitted_at, completed_at, backend_artwork_id, processor_config, progress, error

**Flow:**
1. When job submitted via POST /protect → track with "processing" status + processor configuration
2. When progress callback received (POST /callbacks/process-progress) → update progress in real-time
3. When completion callback received (POST /callbacks/process-complete) → update with "completed" or "failed" status
4. When GET /jobs/{id} queried → check Redis first (includes processor_config and progress), then fall back to backend
5. Redis failures are silent - system degrades gracefully to backend-only queries

This allows clients to poll GET /jobs/{id} and receive both "processing" status with detailed processor configuration and real-time progress information (which specific processor/layer is running, current step, percentage complete, etc.), providing a much better user experience than generic "processing" messages.

## Token Generation Security

`backend.service.ts` implements secure one-time token generation for processor-to-backend uploads:

**Security Model:**
- Router generates a one-time authentication token before submitting jobs to processor
- Token is passed to processor in job metadata
- Processor uses token to authenticate when uploading results to backend
- Token expires after 1 hour and can only be used once

**Backend API endpoint:** `POST /tokens`

**Token Properties:**
- 16-character random string
- Single-use only (invalidated after first use)
- 1-hour expiration
- Associated with job metadata (source: 'router', jobId)

**Flow:**
1. Router calls `backend.generateToken({ source: 'router', jobId })`
2. Backend creates token and returns: `{ token, tokenId, expiresAt }`
3. Router includes token in processor job submission metadata (`backend_auth_token`)
4. Processor uses token when uploading to backend (`POST /artworks`)
5. Backend validates and invalidates token after use

This prevents unauthorized uploads to the backend and ensures only the router can initiate processing workflows.

## Error Handling

Structured error responses:
- **400**: Zod validation errors, malformed requests
- **404**: Route or job not found
- **409**: Job still processing (when requesting results)
- **500**: Internal errors (details logged, generic message returned)
- **503**: Circuit breaker open (fast fail)

All errors logged via Pino with request ID for tracing.

## Development Notes

### TypeScript Configuration

- Target: ES2022, CommonJS modules
- Strict mode enabled
- Source maps generated
- Unused locals/parameters checked
- No implicit returns

### Logging

Uses Pino structured logging with journald-friendly output:
- **Development**: Pretty-printed with colors via `pino-pretty`
- **Production**: Clean JSON format for systemd/journald (no emojis, no special characters)
- Request IDs (`reqId`) for distributed tracing
- All log messages use structured fields for better filtering and analysis
- No console.log/console.error usage - all logging goes through Pino

### Dependencies

Key libraries:
- **Fastify**: HTTP server (chosen for performance)
- **Zod**: Runtime validation
- **Sharp**: Image processing/validation
- **Undici**: Fast HTTP client for backend/processor communication
- **Bull + Redis**: Job queue (prepared, not actively used yet)

### Code Organization

```
src/
├── index.ts              # Cluster entry point
├── app.ts                # Fastify app factory + auth proxy to backend
├── config.ts             # Zod-validated config
├── middleware/
│   └── auth.middleware.ts        # requireAuth & optionalAuth middleware (validates via backend)
├── routes/
│   ├── protect.ts        # POST /protect handler (with optionalAuth)
│   ├── callback.ts       # POST /callbacks/process-complete handler
│   ├── jobs.ts           # GET /jobs/{id}, GET /jobs/{id}/result (with optionalAuth)
│   └── health.ts         # GET /health, /health/live, /health/ready
├── services/
│   ├── auth.service.ts            # Session validation via backend API
│   ├── job-tracker.service.ts     # Redis-based job state tracking
│   ├── duplicate.service.ts       # Backend API client (duplicates + artwork queries) + user header forwarding
│   ├── processor.service.ts       # HTTP client with callback workflow + backend URL injection
│   ├── backend.service.ts         # HTTP client for backend storage (token generation) + user header forwarding
│   ├── upload.service.ts      # Deprecated - no longer needed
│   └── queue.service.ts       # Bull queue (future)
├── types/
│   └── schemas.ts        # Zod schemas
└── utils/
    └── normalize.ts      # Field normalization helpers
```

## Performance Characteristics

- **Throughput**: ~1000 req/s per instance (with 4 workers on 4-core CPU)
- **Memory**: Minimal router memory usage - no temporary storage (processor uploads directly to backend)
- **Backend API**: HTTP calls for duplicate detection and artwork queries (latency depends on backend performance)
- **Failover**: Fast fail via circuit breaker (no cascading failures)
- **Optimization**: Zero file transfers through router - processor handles all uploads to backend directly

## Testing

An integration test suite exists using Vitest (`tests/integration/router.test.ts`).

**Running tests:**
```bash
npm test              # Run tests once
npm run test:watch    # Run in watch mode
npm run test:ui       # Run with UI
```

**Test coverage includes:**
- POST /protect endpoint (upload, duplicate detection, validation)
- GET /jobs/:id endpoint (job status queries)
- GET /jobs/:id/result endpoint (complete job results with URLs)
- GET /jobs/:id/download/:variant endpoint (file downloads via proxy)
- Full end-to-end workflow (upload → process → download protected image)
- Health checks and edge cases (404 errors, invalid requests)

**Test configuration:**
- Tests run against a live router instance (configured via `ROUTER_URL` env var)
- Default target: `https://router.artorizer.com`
- Includes comprehensive E2E test that uploads, waits for processing, and downloads protected images
- Test images stored in `input/` directory, output saved to `output/` directory
