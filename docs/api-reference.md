# Artorizer Core Router - API Reference

**Version**: 1.0.0
**Base URL**: `http://localhost:7000` (default, configurable via `PORT`)

The Artorizer Core Router is the ingress API for the image protection pipeline. It validates requests, checks for duplicates, and routes jobs to the processor core.

---

## Table of Contents

- [Overview](#overview)
- [Authentication](#authentication)
- [Rate Limits](#rate-limits)
- [Content Types](#content-types)
- [Endpoints](#endpoints)
  - [GET /health](#get-health)
  - [POST /protect](#post-protect)
- [Field Reference](#field-reference)
- [Error Responses](#error-responses)
- [Examples](#examples)

---

## Overview

**Architecture Flow**:
```
Client → Router (this API) → Processor Core → Storage Backend
            ↓
        MongoDB (duplicate detection)
```

**Key Features**:
- Multipart file uploads (up to 256MB)
- JSON payloads with remote URLs
- Duplicate detection (checksum, title+artist, tags)
- Field normalization (camelCase ↔ snake_case)
- Circuit breaker pattern for processor failover
- Structured validation with detailed error messages

---

## Authentication

**Current Status**: No authentication required

All endpoints are currently public. Future versions may require API keys or JWT tokens.

---

## Rate Limits

**Default Limits** (configurable via environment):
- **100 requests** per **60 seconds** per IP address
- Configurable via `RATE_LIMIT_MAX` and `RATE_LIMIT_WINDOW`

**Rate Limit Headers** (if enabled):
- `X-RateLimit-Limit`: Maximum requests allowed
- `X-RateLimit-Remaining`: Requests remaining in window
- `X-RateLimit-Reset`: Timestamp when limit resets

**Exceeding Rate Limit**:
```json
{
  "error": "Rate limit exceeded",
  "statusCode": 429
}
```

---

## Content Types

### Supported Request Types

1. **`multipart/form-data`** (recommended for file uploads)
   - Use when uploading image file directly
   - Supports binary file transfer
   - Automatic checksum calculation

2. **`application/json`** (recommended for remote URLs)
   - Use when providing `image_url` or `local_path`
   - Smaller payload size
   - Easier to construct programmatically

### Response Type

All responses are **`application/json`** with UTF-8 encoding.

---

## Endpoints

### GET /health

Health check endpoint to verify service availability.

**URL**: `/health`

**Method**: `GET`

**Authentication**: None required

**Rate Limit**: Not rate limited

**Response** (`200 OK`):
```json
{
  "ok": true,
  "uptime": 12345.67,
  "timestamp": "2024-10-01T12:00:00.000Z"
}
```

**Response Fields**:
- `ok` (boolean): Always `true` if service is healthy
- `uptime` (number): Server uptime in seconds
- `timestamp` (string): Current server time in ISO 8601 format

**Example**:
```bash
curl http://localhost:7000/health
```

---

### POST /protect

Submit artwork for protection processing. This endpoint validates metadata, checks for duplicates, and forwards the job to the processor core.

**URL**: `/protect`

**Method**: `POST`

**Content-Type**: `multipart/form-data` or `application/json`

**Authentication**: None required

**Rate Limit**: Subject to default rate limits

---

#### Required Fields

At least **one image source** is required:
- `image` (file) - Binary image file (multipart only)
- `image_url` (string) - Remote image URL (HTTP/HTTPS)
- `local_path` (string) - Local file path (internal use)

**Metadata** (always required):
- `artist_name` (string) - Artist or creator name (1-120 characters)
- `artwork_title` (string) - Artwork title (1-200 characters)

---

#### Optional Metadata Fields

| Field | Type | Max Length | Default | Description |
|-------|------|------------|---------|-------------|
| `artwork_description` | string | 2000 chars | - | Detailed artwork description |
| `artwork_creation_time` | string (ISO 8601) | - | Current time | Creation timestamp |
| `tags` | array or comma-separated string | 25 tags, 50 chars each | `[]` | Categorization tags |
| `extra_metadata` | JSON object or string | - | `{}` | Additional structured metadata |

---

#### Processing Control Flags

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `include_hash_analysis` | boolean | `true` | Enable perceptual hash analysis |
| `include_protection` | boolean | `true` | Enable protection layers |
| `processors` | array or comma-separated string | All (if `include_hash_analysis=true`) | Specific processors to run |
| `enable_tineye` | boolean | `false` | Enable TinEye reverse image search (requires API key) |
| `max_stage_dim` | integer (128-4096) | `512` | Maximum dimension for processing stages |

**Available Processors**:
- `metadata` - EXIF/image metadata extraction
- `imagehash` - Perceptual hashing (pHash, aHash, dHash, wHash)
- `dhash` - Difference hash variants
- `blockhash` - Block-based hashing
- `stegano` - Steganography detection
- `tineye` - Reverse image search (requires API key)

---

#### Protection Layer Toggles

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `enable_fawkes` | boolean | `true` | Gaussian noise cloaking |
| `enable_photoguard` | boolean | `true` | Blur + edge blending |
| `enable_mist` | boolean | `true` | Color/contrast enhancement |
| `enable_nightshade` | boolean | `true` | Pixel shifting + noise |
| `enable_stegano_embed` | boolean | `false` | Steganographic message embedding |
| `enable_c2pa_manifest` | boolean | `true` | C2PA provenance manifest |

**Note**: Protection layers only apply if `include_protection=true`

---

#### Watermark Parameters

| Field | Type | Default | Range/Options | Description |
|-------|------|---------|---------------|-------------|
| `watermark_strategy` | enum | `invisible-watermark` | `invisible-watermark`, `tree-ring`, `none` | Watermark technique |
| `watermark_text` | string | `artscraper` | - | Text to embed in watermark |
| `tree_ring_frequency` | float | `9.0` | 1.0 - 32.0 | Tree ring frequency (radial pattern) |
| `tree_ring_amplitude` | float | `18.0` | 1.0 - 64.0 | Tree ring amplitude (intensity) |

**Watermark Strategy Details**:
- **`invisible-watermark`**: LSB-based imperceptible watermark
- **`tree-ring`**: Radial frequency pattern watermark
- **`none`**: Skip watermarking entirely

---

#### Steganography Parameters

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `stegano_message` | string | `Protected by artscraper` | Message to embed via steganography |

**Note**: Only applies if `enable_stegano_embed=true`

---

#### C2PA Parameters

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `c2pa_claim_generator` | string | - | Claim generator identifier |
| `c2pa_assertions` | array or object | - | Custom C2PA assertions |
| `c2pa_vendor` | string | - | Vendor identifier |

**Note**: Only applies if `enable_c2pa_manifest=true`

---

#### Response: Success (New Job)

**Status**: `202 Accepted`

```json
{
  "job_id": "abc123def456",
  "status": "queued"
}
```

**Fields**:
- `job_id` (string): Unique job identifier for tracking
- `status` (string): Always `"queued"` for new submissions

---

#### Response: Duplicate Detected

**Status**: `200 OK`

```json
{
  "job_id": "existing_id_123",
  "status": "exists",
  "message": "Artwork already exists",
  "artwork": {
    "_id": "existing_id_123",
    "title": "Artwork Title",
    "artist": "Artist Name",
    "tags": ["tag1", "tag2"],
    "uploadedAt": "2024-09-15T10:30:00.000Z",
    "createdAt": "2024-09-15T08:00:00.000Z"
  }
}
```

**Fields**:
- `job_id` (string): ID of the existing artwork
- `status` (string): Always `"exists"` for duplicates
- `message` (string): Human-readable explanation
- `artwork` (object): Existing artwork metadata

**Duplicate Detection Strategy** (in order of priority):
1. **By checksum** (if image file provided)
2. **By title + artist** (exact match)
3. **By tags** (array intersection)

---

#### Response: Validation Error

**Status**: `400 Bad Request`

```json
{
  "error": "artist_name: Required",
  "statusCode": 400
}
```

**Common Validation Errors**:
```json
{ "error": "artwork_title: String must contain at least 1 character(s)" }
{ "error": "Unknown processor: perceptualhash2" }
{ "error": "Invalid image file format" }
{ "error": "Content-Type must be multipart/form-data or application/json" }
{ "error": "Too many tags (max 25)" }
{ "error": "max_stage_dim: Number must be greater than or equal to 128" }
```

---

#### Response: Processor Unavailable

**Status**: `503 Service Unavailable`

```json
{
  "error": "Processor service temporarily unavailable"
}
```

**Cause**: Circuit breaker has opened due to repeated processor failures (5+ consecutive failures)

**Recovery**: Automatic retry after 30 seconds

---

#### Response: Processor Error

**Status**: `502 Bad Gateway`

```json
{
  "error": "Upstream processor error",
  "detail": "Processor returned 500: Internal error"
}
```

**Cause**: Processor core returned an error response

---

## Field Reference

### Field Normalization

The router automatically normalizes field names to support both camelCase and snake_case:

**Examples**:
- `artistName` → `artist_name`
- `artworkTitle` → `artwork_title`
- `enableFawkes` → `enable_fawkes`

### Boolean Parsing

Boolean fields accept multiple formats:
- Strings: `"true"`, `"false"`, `"1"`, `"0"`
- Booleans: `true`, `false`
- Numbers: `1`, `0`

**Examples**:
```json
{
  "include_hash_analysis": "true",    // Parsed as true
  "include_protection": 1,            // Parsed as true
  "enable_tineye": false              // Remains false
}
```

### Array Parsing

Arrays can be provided as:
- JSON arrays: `["tag1", "tag2", "tag3"]`
- Comma-separated strings: `"tag1,tag2,tag3"`

**Examples**:
```json
{
  "tags": ["nature", "landscape"],          // JSON array
  "tags": "nature,landscape",               // Comma-separated (equivalent)
  "processors": ["metadata", "imagehash"]   // JSON array
}
```

### JSON Object Parsing

JSON objects can be provided as:
- Native JSON objects: `{"key": "value"}`
- JSON strings: `"{\"key\": \"value\"}"`

**Example** (`extra_metadata`):
```json
{
  "extra_metadata": {"source": "camera", "lens": "50mm"}  // Native object
}
```

Or in multipart:
```bash
-F 'extra_metadata={"source":"camera","lens":"50mm"}'  # JSON string
```

---

## Error Responses

### Error Response Format

All errors return JSON with consistent structure:

```json
{
  "error": "Human-readable error message",
  "statusCode": 400
}
```

Optional `detail` field for additional context:

```json
{
  "error": "Upstream processor error",
  "detail": "Processor returned 500: Database connection failed",
  "statusCode": 502
}
```

### HTTP Status Codes

| Code | Meaning | Common Causes |
|------|---------|---------------|
| `200` | OK | Duplicate detected (successful, no action needed) |
| `202` | Accepted | Job successfully queued |
| `400` | Bad Request | Validation error, missing fields, invalid format |
| `404` | Not Found | Invalid endpoint |
| `429` | Too Many Requests | Rate limit exceeded |
| `500` | Internal Server Error | Unexpected server error |
| `502` | Bad Gateway | Processor returned error |
| `503` | Service Unavailable | Circuit breaker open, processor down |

---

## Examples

### Example 1: Basic Multipart Upload

```bash
curl -X POST http://localhost:7000/protect \
  -F "image=@artwork.jpg" \
  -F "artist_name=Jane Doe" \
  -F "artwork_title=Digital Sunset"
```

**Response** (`202 Accepted`):
```json
{
  "job_id": "job_abc123",
  "status": "queued"
}
```

---

### Example 2: Full Multipart Upload with All Options

```bash
curl -X POST http://localhost:7000/protect \
  -F "image=@forest.jpg" \
  -F "artist_name=Jane Doe" \
  -F "artwork_title=Shaded Forest" \
  -F "artwork_description=A moody forest render with dramatic lighting" \
  -F "tags=forest,moody,autumn,nature" \
  -F "artwork_creation_time=2024-09-15T10:30:00Z" \
  -F "include_hash_analysis=true" \
  -F "include_protection=true" \
  -F "processors=metadata,imagehash,blockhash" \
  -F "enable_fawkes=true" \
  -F "enable_photoguard=true" \
  -F "enable_nightshade=false" \
  -F "watermark_strategy=tree-ring" \
  -F "tree_ring_frequency=8.5" \
  -F "tree_ring_amplitude=16.0" \
  -F "enable_stegano_embed=true" \
  -F "stegano_message=Protected by Artorizer" \
  -F "max_stage_dim=512"
```

---

### Example 3: JSON with Remote Image URL

```bash
curl -X POST http://localhost:7000/protect \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://example.com/artwork.jpg",
    "artist_name": "Jane Doe",
    "artwork_title": "Scene Study",
    "artwork_description": "Lighting exploration",
    "tags": ["study", "lighting", "digital"],
    "include_hash_analysis": true,
    "processors": ["metadata", "imagehash", "dhash"],
    "include_protection": true,
    "watermark_strategy": "invisible-watermark",
    "watermark_text": "© Jane Doe 2024",
    "enable_c2pa_manifest": true
  }'
```

---

### Example 4: Minimal JSON Upload

```bash
curl -X POST http://localhost:7000/protect \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://example.com/image.jpg",
    "artist_name": "John Smith",
    "artwork_title": "Test Artwork"
  }'
```

**Response** (`202 Accepted`):
```json
{
  "job_id": "job_xyz789",
  "status": "queued"
}
```

---

### Example 5: CamelCase Field Names (Normalized)

```bash
curl -X POST http://localhost:7000/protect \
  -H "Content-Type: application/json" \
  -d '{
    "imageUrl": "https://example.com/image.jpg",
    "artistName": "Jane Doe",
    "artworkTitle": "Modern Art",
    "includeHashAnalysis": "true",
    "watermarkStrategy": "tree-ring"
  }'
```

**Note**: Fields are automatically normalized to `snake_case` internally:
- `imageUrl` → `image_url`
- `artistName` → `artist_name`
- `includeHashAnalysis` → `include_hash_analysis`

---

### Example 6: Duplicate Detection Response

**First Upload**:
```bash
curl -X POST http://localhost:7000/protect \
  -F "image=@artwork.jpg" \
  -F "artist_name=Jane Doe" \
  -F "artwork_title=Forest Scene"
```

**Response** (`202 Accepted`):
```json
{
  "job_id": "job_first123",
  "status": "queued"
}
```

**Second Upload (Same Image)**:
```bash
curl -X POST http://localhost:7000/protect \
  -F "image=@artwork.jpg" \
  -F "artist_name=Jane Doe" \
  -F "artwork_title=Forest Scene"
```

**Response** (`200 OK`):
```json
{
  "job_id": "job_first123",
  "status": "exists",
  "message": "Artwork already exists",
  "artwork": {
    "_id": "job_first123",
    "title": "Forest Scene",
    "artist": "Jane Doe",
    "checksum": "sha256:abc123def456...",
    "tags": [],
    "uploadedAt": "2024-10-01T12:00:00.000Z",
    "createdAt": "2024-10-01T12:00:00.000Z"
  }
}
```

---

### Example 7: Validation Error

```bash
curl -X POST http://localhost:7000/protect \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://example.com/image.jpg",
    "artist_name": "Jane Doe"
  }'
```

**Response** (`400 Bad Request`):
```json
{
  "error": "artwork_title: Required",
  "statusCode": 400
}
```

---

### Example 8: Unknown Processor Error

```bash
curl -X POST http://localhost:7000/protect \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://example.com/image.jpg",
    "artist_name": "Jane Doe",
    "artwork_title": "Test",
    "processors": ["metadata", "unknown_processor"]
  }'
```

**Response** (`400 Bad Request`):
```json
{
  "error": "Unknown processor: unknown_processor",
  "statusCode": 400
}
```

---

### Example 9: Extra Metadata

```bash
curl -X POST http://localhost:7000/protect \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://example.com/image.jpg",
    "artist_name": "Jane Doe",
    "artwork_title": "Landscape Study",
    "extra_metadata": {
      "camera": "Canon EOS R5",
      "lens": "RF 24-70mm f/2.8",
      "iso": 400,
      "shutter_speed": "1/250",
      "aperture": "f/5.6",
      "location": "Yosemite National Park"
    }
  }'
```

---

### Example 10: Disable All Protection Layers

```bash
curl -X POST http://localhost:7000/protect \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://example.com/image.jpg",
    "artist_name": "Jane Doe",
    "artwork_title": "Analysis Only",
    "include_hash_analysis": true,
    "include_protection": false
  }'
```

**Note**: Setting `include_protection=false` disables all protection layers regardless of individual toggles.

---

## Implementation Notes

### Circuit Breaker Behavior

The router implements a circuit breaker pattern to prevent cascade failures:

**States**:
1. **Closed** (normal operation): All requests forwarded to processor
2. **Open** (failure mode): Requests immediately rejected with `503`
3. **Half-open** (testing): Single test request after timeout

**Trigger**: Circuit opens after **5 consecutive failures**

**Recovery**: Circuit resets after **30 seconds** of cool-down

**Example Error** (circuit open):
```json
{
  "error": "Processor service temporarily unavailable",
  "statusCode": 503
}
```

---

### Duplicate Detection Logic

**Detection Order** (first match wins):

1. **Checksum Match** (highest priority)
   - SHA256 hash of image file
   - Only available for file uploads (not URLs)
   - Guarantees exact duplicate

2. **Title + Artist Match**
   - Exact string match (case-sensitive)
   - Checks both `title` and `artist` fields

3. **Tags Match**
   - Array intersection (at least one common tag)
   - Case-sensitive

**Database Query**:
```javascript
// MongoDB query example
{
  $or: [
    { checksum: "sha256:abc123..." },
    { title: "Artwork Title", artist: "Artist Name" },
    { tags: { $in: ["tag1", "tag2"] } }
  ]
}
```

---

### File Upload Limits

| Limit | Value | Configuration |
|-------|-------|---------------|
| Max file size | 256 MB | `MAX_FILE_SIZE` env var |
| Max files per request | 1 | Hardcoded |
| Allowed MIME types | `image/jpeg`, `image/png`, `image/webp`, `image/avif`, `image/gif` | Sharp library |

**Exceeding File Size**:
```json
{
  "error": "File size exceeds limit",
  "statusCode": 413
}
```

---

### Logging

All requests are logged with structured logging (Pino):

**Development** (pretty-printed):
```
[12:00:00] INFO (reqId: abc123): Request received POST /protect
[12:00:00] DEBUG (reqId: abc123): Validating fields
[12:00:00] INFO (reqId: abc123): Job submitted job_id=xyz789
```

**Production** (JSON):
```json
{"level":30,"time":1696176000000,"reqId":"abc123","msg":"Request received"}
{"level":20,"time":1696176001000,"reqId":"abc123","msg":"Validating fields"}
{"level":30,"time":1696176002000,"reqId":"abc123","job_id":"xyz789","msg":"Job submitted"}
```

**Request ID**: Every request receives a unique `reqId` for tracing across logs.

---

### CORS Configuration

**Current Settings**:
- **Origin**: `*` (allow all origins)
- **Credentials**: Enabled
- **Methods**: All HTTP methods
- **Headers**: All headers allowed

**Configurable** in `src/app.ts`:
```typescript
await app.register(cors, {
  origin: true,        // Allow all origins
  credentials: true,   // Allow credentials
});
```

**Production Recommendation**: Restrict `origin` to specific domains:
```typescript
origin: ['https://artorizer.com', 'https://app.artorizer.com']
```

---

## Environment Configuration

Configure the router via environment variables (`.env` file):

```env
# Server Configuration
PORT=7000
NODE_ENV=development
WORKERS=4

# MongoDB Configuration
MONGODB_URI=mongodb://localhost:27017/artorizer_storage

# Redis Configuration
REDIS_HOST=localhost
REDIS_PORT=6379
REDIS_PASSWORD=optional_password

# Processor Configuration
PROCESSOR_URL=http://localhost:8000
PROCESSOR_TIMEOUT=30000

# Rate Limiting
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=60000

# Upload Limits
MAX_FILE_SIZE=268435456  # 256MB in bytes
```

**Default Values**: All fields have sensible defaults. Minimum required: none (all optional).

---

## Troubleshooting

### Common Issues

**Issue**: `503 Service Unavailable` on all requests

**Cause**: Processor core is down or unreachable

**Solution**:
1. Check processor is running: `curl http://localhost:8000/health`
2. Verify `PROCESSOR_URL` in `.env`
3. Wait 30 seconds for circuit breaker to reset

---

**Issue**: `Duplicate artwork detected` for new images

**Cause**: Artwork with same title+artist or tags already exists

**Solution**:
1. Use unique titles/artist combinations
2. Check existing artworks: query MongoDB directly
3. Clear duplicate if error: delete from MongoDB

---

**Issue**: Validation errors on boolean fields

**Cause**: Incorrect boolean format in multipart

**Solution**: Use strings `"true"` or `"false"` (with quotes) in multipart forms:
```bash
-F "include_hash_analysis=true"   # Correct
-F "include_hash_analysis=\"true\""  # Also works
```

---

**Issue**: `Unknown processor` error

**Cause**: Processor name typo or unsupported processor

**Solution**: Use only allowed processors:
- `metadata`, `imagehash`, `dhash`, `blockhash`, `stegano`, `tineye`

---

## Changelog

### Version 1.0.0 (2024-10-01)

**Initial Release**:
- POST /protect endpoint with multipart and JSON support
- GET /health endpoint
- Duplicate detection (checksum, title+artist, tags)
- Field normalization (camelCase ↔ snake_case)
- Circuit breaker pattern
- Comprehensive validation with Zod
- Support for all protection layers and watermarking strategies

---

## Support

**Issues**: For bug reports and feature requests, contact the development team

**Logs**: Check server logs for detailed error information:
```bash
npm run dev  # Development with pretty logs
npm start    # Production with JSON logs
```

**Health Check**: Verify service status:
```bash
curl http://localhost:7000/health
```

---

## Related Documentation

- **Processor API**: See `docs/documentation-processor.md` for processor core endpoints
- **Async Callback Design**: See `mod-processor.md` for architecture details
- **Project Instructions**: See `CLAUDE.md` for development guidelines
- **Main README**: See `README.md` for quick start guide
