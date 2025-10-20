# Artorizer Core Router

High-performance ingress API for the Artorizer image protection pipeline. Routes client requests, validates metadata, checks for duplicates, and forwards jobs to the processor core.

## Architecture

```
Frontend → CDN → Router (this) → Processor Core
                    ↓
                 Storage DB (duplicate check)
```

## Features

- **High Performance**: Fastify-based with clustering support (1000+ concurrent requests)
- **Streaming Uploads**: Memory-efficient file handling up to 256MB
- **Smart Routing**: Duplicate detection before processing
- **Circuit Breaker**: Automatic failover when processor is unavailable
- **Full Validation**: Zod schemas with comprehensive error messages
- **Field Normalization**: Accepts both camelCase and snake_case
- **Structured Logging**: Pino with request tracing

## Quick Start

### Automated Deployment (Debian/Ubuntu)

Deploy the entire stack with a single command:

```bash
curl -fsSL https://raw.githubusercontent.com/Artorize/artorize-core-router/master/deploy.sh | sudo bash
```

This automated deployment script will:
- ✅ Install Node.js 20.x, Redis, Nginx, and all dependencies
- ✅ Clone the repository from GitHub
- ✅ Build and configure the application
- ✅ Create systemd service `artoize-router`
- ✅ Setup Nginx reverse proxy
- ✅ Configure firewall rules
- ✅ Start all services automatically

**Post-deployment:** Edit `/opt/artorizer-router/shared/.env` with your configuration (BACKEND_URL, PROCESSOR_URL, CALLBACK_AUTH_TOKEN), then restart: `sudo systemctl restart artoize-router`

**Useful commands:**
```bash
# View logs
sudo journalctl -u artoize-router -f

# Restart service
sudo systemctl restart artoize-router

# Check status
sudo systemctl status artoize-router

# View application logs
sudo tail -f /var/log/artorizer/router.log
```

---

### Manual Installation

#### Prerequisites

- Node.js 18+
- MongoDB (for duplicate detection)
- Redis (for job queue)
- Processor Core running on port 8000

#### Installation

```bash
npm install
```

#### Configuration

Create a `.env` file:

```bash
cp .env.example .env
```

Edit `.env` with your configuration:

```env
PORT=7000
NODE_ENV=development
WORKERS=4

MONGODB_URI=mongodb://localhost:27017/artorizer_storage
REDIS_HOST=localhost
REDIS_PORT=6379

PROCESSOR_URL=http://localhost:8000
```

#### Development

```bash
npm run dev
```

#### Production

```bash
npm run build
npm start
```

## API Endpoint

### POST /protect

Submit artwork for protection processing.

**Content-Type**: `multipart/form-data` or `application/json`

#### Required Fields

- `artist_name` (string, 1-120 chars)
- `artwork_title` (string, 1-200 chars)
- One of: `image` (file) | `image_url` (URL) | `local_path` (string)

#### Example: Multipart Upload

```bash
curl -X POST http://localhost:7000/protect \
  -F "image=@forest.jpg" \
  -F "artist_name=Jane Doe" \
  -F "artwork_title=Shaded Forest" \
  -F "artwork_description=A moody forest render" \
  -F "tags=forest,moody,autumn" \
  -F "include_hash_analysis=true" \
  -F "processors=metadata,imagehash,blockhash" \
  -F "include_protection=true" \
  -F "watermark_strategy=tree-ring" \
  -F "tree_ring_frequency=8.5"
```

#### Example: JSON with Remote Image

```bash
curl -X POST http://localhost:7000/protect \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://example.com/image.jpg",
    "artist_name": "Jane Doe",
    "artwork_title": "Scene Study",
    "tags": ["study", "lighting"],
    "include_hash_analysis": true,
    "processors": ["metadata", "imagehash"],
    "watermark_strategy": "invisible-watermark"
  }'
```

#### Success Response (202 Accepted)

```json
{
  "job_id": "abc123def456",
  "status": "queued"
}
```

#### Duplicate Detected (200 OK)

```json
{
  "job_id": "existing_id",
  "status": "exists",
  "message": "Artwork already exists",
  "artwork": {
    "_id": "existing_id",
    "title": "Shaded Forest",
    "artist": "Jane Doe"
  }
}
```

#### Error Response (400)

```json
{
  "error": "artist_name is required",
  "statusCode": 400
}
```

## Optional Parameters

### Metadata Fields

- `artwork_description` (string, max 2000 chars)
- `artwork_creation_time` (ISO 8601 datetime)
- `tags` (array or comma-separated, max 25, each max 50 chars)
- `extra_metadata` (JSON object)

### Processing Control

- `include_hash_analysis` (boolean, default: true)
- `include_protection` (boolean, default: true)
- `processors` (array: metadata, imagehash, dhash, blockhash, stegano, tineye)
- `enable_tineye` (boolean, default: false)
- `max_stage_dim` (int, 128-4096, default: 512)

### Protection Layers

- `enable_fawkes` (boolean, default: true)
- `enable_photoguard` (boolean, default: true)
- `enable_mist` (boolean, default: true)
- `enable_nightshade` (boolean, default: true)
- `enable_stegano_embed` (boolean, default: false)
- `enable_c2pa_manifest` (boolean, default: true)

### Watermark Options

- `watermark_strategy` (invisible-watermark | tree-ring | none)
- `watermark_text` (string, default: "artscraper")
- `tree_ring_frequency` (float, 1-32, default: 9.0)
- `tree_ring_amplitude` (float, 1-64, default: 18.0)

### Stegano Options

- `stegano_message` (string, default: "Protected by artscraper")

### C2PA Options

- `c2pa_claim_generator` (string)
- `c2pa_assertions` (array/object)
- `c2pa_vendor` (string)

## Health Check

```bash
curl http://localhost:7000/health
```

Response:
```json
{
  "ok": true,
  "uptime": 123.45,
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

## Tech Stack

- **Fastify** - High-performance HTTP server
- **TypeScript** - Type-safe development
- **Zod** - Runtime schema validation
- **MongoDB** - Duplicate detection storage
- **Bull + Redis** - Job queue management
- **Sharp** - Image validation
- **Undici** - Fast HTTP client
- **Pino** - Structured logging

## Performance

### Clustering

The router automatically spawns worker processes based on CPU cores:

```env
WORKERS=4  # Number of worker processes
```

### Limits

- Max file size: 256MB (configurable)
- Max tags: 25
- Max tag length: 50 chars
- Max concurrent uploads: Limited by system resources

### Circuit Breaker

Automatically opens after 5 consecutive processor failures, preventing cascade failures. Resets after 30 seconds.

## Error Handling

| Status | Description |
|--------|-------------|
| 400 | Bad Request - validation error |
| 404 | Route not found |
| 502 | Processor error |
| 503 | Circuit breaker open |
| 500 | Internal server error |

## Development

### Project Structure

```
src/
├── index.ts              # Entry point with clustering
├── app.ts                # Fastify app setup
├── config.ts             # Configuration with Zod
├── routes/
│   └── protect.ts        # POST /protect handler
├── services/
│   ├── duplicate.service.ts   # MongoDB duplicate detection
│   ├── processor.service.ts   # Processor API client
│   └── queue.service.ts       # Bull queue (future use)
├── types/
│   └── schemas.ts        # Zod schemas
└── utils/
    └── normalize.ts      # Field normalization helpers
```

### Scripts

- `npm run dev` - Development with hot reload
- `npm run build` - Compile TypeScript
- `npm start` - Production server
- `npm run clean` - Remove dist folder

## Documentation

### Complete API Reference

For comprehensive documentation including all endpoints, parameters, examples, and error handling:

📖 **[API Reference](docs/api-reference.md)** - Complete endpoint documentation with examples

### Additional Documentation

- **[Processor API](docs/documentation-processor.md)** - Processor core endpoints and async callback mode
- **[Architecture Design](mod-processor.md)** - Async callback pattern and optimization strategies
- **[Project Instructions](CLAUDE.md)** - Development guidelines and architecture overview

## License

Private - Artorizer Project
