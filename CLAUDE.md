# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

Artorizer Core Router is a high-performance ingress API for the Artorizer image protection pipeline. It routes client requests, validates metadata, checks for duplicates, and forwards jobs to the processor core.

**Architecture Flow:**
```
Frontend → CDN → Router (this) → Processor Core
                    ↓
                 Storage DB (duplicate check)
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
   - `duplicate.service.ts`: MongoDB duplicate detection by checksum/title/artist
   - `processor.service.ts`: HTTP client with circuit breaker (opens after 5 failures, resets after 30s)
   - `queue.service.ts`: Bull/Redis queue (prepared for future async processing)
6. **Utilities** (`src/utils/normalize.ts`): Field normalization (camelCase ↔ snake_case), boolean parsing, tag validation

### Data Processing Pipeline

```
Request → Content-type detection (multipart/JSON)
       → Image extraction & SHA256 checksum (if file)
       → Field normalization (camelCase → snake_case)
       → Boolean/array parsing ("true" → true, "a,b" → ["a","b"])
       → Zod validation
       → Duplicate check (MongoDB: checksum → title+artist → tags)
       → If duplicate: return existing artwork (200)
       → If new: submit to processor (202)
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
- `MONGODB_URI`: For duplicate detection storage
- `REDIS_HOST`, `REDIS_PORT`: For Bull queue (future async processing)
- `PROCESSOR_URL`: Processor core API endpoint (default: `http://localhost:8000`)

**Performance Tuning:**
- `WORKERS`: Number of worker processes (default: 4)
- `PROCESSOR_TIMEOUT`: HTTP timeout for processor requests (default: 30000ms)
- `MAX_FILE_SIZE`: Upload limit (default: 256MB)

See `.env.example` for all available options.

## API Endpoint

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

## MongoDB Duplicate Detection

`duplicate.service.ts` uses singleton pattern with connection pooling (min: 5, max: 20).

**Search strategies (in order):**
1. By checksum (if provided)
2. By title + artist (exact match)
3. By tags (array intersection)

Returns first match found. Queries are indexed for performance.

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
- **MongoDB**: Duplicate detection storage
- **Bull + Redis**: Job queue (prepared, not actively used yet)
- **Undici**: Fast HTTP client for processor communication

### Code Organization

```
src/
├── index.ts              # Cluster entry point
├── app.ts                # Fastify app factory
├── config.ts             # Zod-validated config
├── routes/
│   └── protect.ts        # POST /protect handler
├── services/
│   ├── duplicate.service.ts   # MongoDB client
│   ├── processor.service.ts   # HTTP client with circuit breaker
│   └── queue.service.ts       # Bull queue (future)
├── types/
│   └── schemas.ts        # Zod schemas
└── utils/
    └── normalize.ts      # Field normalization helpers
```

## Performance Characteristics

- **Throughput**: ~1000 req/s per instance (with 4 workers on 4-core CPU)
- **Memory**: Constant usage regardless of file size (streaming)
- **Database**: Sub-10ms queries (connection pooling)
- **Failover**: Fast fail via circuit breaker (no cascading failures)

## Testing

No test suite currently exists. When adding tests, consider:
- Unit tests for validation/normalization logic
- Integration tests for duplicate detection
- E2E tests for full request flow
- Circuit breaker behavior tests
