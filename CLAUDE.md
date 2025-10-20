# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Artorizer Core Router is a high-performance ingress API for the Artorizer image protection pipeline. It routes client requests, validates metadata, checks for duplicates, and forwards jobs to the processor core.

**Architecture Flow:**
```
Client → Router POST /protect → Processor POST /v1/process/artwork
          ↓                       (includes backend_url in metadata)
    Check Backend API                    ↓
    (duplicates)                  Processes image
                                         ↓
                              Processor POST /artworks → Backend (GridFS + MongoDB)
                                         ↓
                              Processor sends callback with backend artwork_id
                                         ↓
                              Router POST /callbacks/process-complete
                                  (receives artwork_id)
                                         ↓
                              Client queries: GET /jobs/{id} (via Backend API)
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
2. **Application** (`src/app.ts`): Fastify setup, middleware, CORS, multipart handling
3. **Routing** (`src/routes/protect.ts`): Main `/protect` endpoint logic
4. **Validation** (`src/types/schemas.ts`): Zod schemas for type-safe validation
5. **Services**:
   - `duplicate.service.ts`: Backend API client for duplicate detection + artwork queries
   - `processor.service.ts`: HTTP client with circuit breaker + callback-based workflow (includes backend URL for direct upload)
   - `backend.service.ts`: HTTP client for backend interactions (not used in optimized flow - processor uploads directly)
   - `upload.service.ts`: Deprecated - no longer needed (processor uploads directly to backend)
   - `queue.service.ts`: Bull/Redis queue (prepared for future async processing)
6. **Utilities** (`src/utils/normalize.ts`): Field normalization (camelCase ↔ snake_case), boolean parsing, tag validation

### Data Processing Pipeline

```
Request → Content-type detection (multipart/JSON)
       → Image extraction & SHA256 checksum (if file)
       → Field normalization (camelCase → snake_case)
       → Boolean/array parsing ("true" → true, "a,b" → ["a","b"])
       → Zod validation
       → Duplicate check (Backend API: checksum → title+artist → tags)
       → If duplicate: return existing artwork (200)
       → If new: submit to processor with backend_url (202)
       → Processor processes and uploads directly to backend
       → Processor sends callback with backend artwork_id
```

### Circuit Breaker Pattern

`processor.service.ts` implements a circuit breaker:
- **Closed** (normal): Forwards all requests
- **Open** (triggered after 5 consecutive failures): Immediately returns 503
- **Reset**: After 30 seconds, attempts one request (half-open), closes if successful

This prevents cascade failures when the processor is down.

## Configuration

All config is in `src/config.ts` using Zod validation. Environment variables:

**Required External Services:**
- `BACKEND_URL`: Backend storage API endpoint - handles all database operations (default: `http://localhost:3000`)
- `PROCESSOR_URL`: Processor core API endpoint (default: `http://localhost:8000`)
- `REDIS_HOST`, `REDIS_PORT`: For Bull queue (future async processing)

**Router Configuration:**
- `ROUTER_BASE_URL`: Router's own base URL for callback (default: `http://localhost:7000`)
- `CALLBACK_AUTH_TOKEN`: Secret token for validating processor callbacks

**Performance Tuning:**
- `WORKERS`: Number of worker processes (default: 4)
- `PROCESSOR_TIMEOUT`: HTTP timeout for processor requests (default: 30000ms)
- `MAX_FILE_SIZE`: Upload limit (default: 256MB)

See `.env.example` for all available options.

## API Endpoints

### POST /protect

Accepts `multipart/form-data` or `application/json`.

**Required fields:**
- `artist_name` (string, 1-120 chars)
- `artwork_title` (string, 1-200 chars)
- One of: `image` (file) | `image_url` (URL) | `local_path` (string)

**Response:**
- `202 Accepted`: `{"job_id": "...", "status": "queued"}` (new job)
- `200 OK`: `{"job_id": "...", "status": "exists", "artwork": {...}}` (duplicate)
- `400 Bad Request`: Validation error
- `502 Bad Gateway`: Processor error
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
2. Logs job completion with backend artwork ID
3. Returns acknowledgment (no file transfers needed)

**Response:**
- `200 OK`: `{"received": true, "job_id": "...", "artwork_id": "...", "status": "completed"}`
- `401 Unauthorized`: Invalid auth token
- `400 Bad Request`: Missing backend_artwork_id (processor should upload to backend first)

### GET /jobs/{id}

Get job status.

**Response:**
- `200 OK`: `{"job_id": "...", "status": "completed", "completedAt": "...", "uploadedAt": "..."}`
- `404 Not Found`: Job doesn't exist

### GET /jobs/{id}/result

Get complete job result with backend URLs.

**Response:**
- `200 OK`: Full artwork metadata + URLs to backend files
- `404 Not Found`: Job doesn't exist
- `409 Conflict`: Job not yet completed

### GET /jobs/{id}/download/{variant}

Proxy download from backend. Redirects (307) to backend storage URL.

**Variants:** `original`, `protected`, `mask_hi`, `mask_lo`

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

## Error Handling

Structured error responses:
- **400**: Zod validation errors, malformed requests
- **404**: Route not found
- **500**: Internal errors (details logged, generic message returned)
- **502**: Processor returned error (wraps upstream error)
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

Uses Pino structured logging:
- **Development**: Pretty-printed with colors via `pino-pretty`
- **Production**: JSON format for log aggregation
- Request IDs (`reqId`) for distributed tracing

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
├── app.ts                # Fastify app factory
├── config.ts             # Zod-validated config
├── routes/
│   ├── protect.ts        # POST /protect handler
│   ├── callback.ts       # POST /callbacks/process-complete handler
│   ├── jobs.ts           # GET /jobs/{id}, GET /jobs/{id}/result
│   └── health.ts         # GET /health, /health/live, /health/ready
├── services/
│   ├── duplicate.service.ts   # Backend API client (duplicates + artwork queries)
│   ├── processor.service.ts   # HTTP client with callback workflow + backend URL injection
│   ├── backend.service.ts     # HTTP client for backend storage (deprecated in optimized flow)
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

No test suite currently exists. When adding tests, consider:
- Unit tests for validation/normalization logic
- Integration tests for duplicate detection
- E2E tests for full request flow
- Circuit breaker behavior tests
