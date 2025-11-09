# Router API Reference

Complete API reference for the Artorizer Core Router.

**Base URL**: `http://localhost:7000` (configurable via `PORT` and `HOST`)

---

## Table of Contents

1. [Artwork Submission](#artwork-submission)
2. [Job Status](#job-status)
3. [Callback Endpoints](#callback-endpoints)
4. [Health Checks](#health-checks)
5. [Error Codes](#error-codes)

---

## Artwork Submission

### POST /protect

Submit artwork for protection processing. The router validates metadata, checks for duplicates, and forwards jobs to the processor.

**Content-Type**: `multipart/form-data` or `application/json`

#### Required Fields

- `artist_name` (string, 1-120 chars)
- `artwork_title` (string, 1-200 chars)
- One of: `image` (file) | `image_url` (URL) | `local_path` (string)

#### Optional Metadata Fields

- `artwork_description` (string, max 2000 chars)
- `artwork_creation_time` (ISO 8601 datetime)
- `tags` (array or comma-separated, max 25, each max 50 chars)
- `extra_metadata` (JSON object)

#### Optional Processing Fields

- `include_hash_analysis` (boolean, default: true)
- `include_protection` (boolean, default: true)
- `processors` (array: metadata, imagehash, dhash, blockhash, stegano, tineye)
- `enable_tineye` (boolean, default: false)
- `max_stage_dim` (int, 128-4096, default: 512)

#### Optional Protection Layers

- `enable_fawkes` (boolean, default: true)
- `enable_photoguard` (boolean, default: true)
- `enable_mist` (boolean, default: true)
- `enable_nightshade` (boolean, default: true)
- `enable_stegano_embed` (boolean, default: false)
- `enable_c2pa_manifest` (boolean, default: true)

#### Optional Watermark Options

- `watermark_strategy` (invisible-watermark | tree-ring | none)
- `watermark_text` (string, default: "artscraper")
- `tree_ring_frequency` (float, 1-32, default: 9.0)
- `tree_ring_amplitude` (float, 1-64, default: 18.0)

#### Optional Stegano Options

- `stegano_message` (string, default: "Protected by artscraper")

#### Optional C2PA Options

- `c2pa_claim_generator` (string)
- `c2pa_assertions` (array/object)
- `c2pa_vendor` (string)

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

New artwork submitted for processing:

```json
{
  "job_id": "f2dc197c-43b9-404d-b3f3-159282802609",
  "status": "processing"
}
```

#### Duplicate Response (200 OK)

Artwork already exists in the backend:

```json
{
  "job_id": "60f7b3b3b3b3b3b3b3b3b3b3",
  "status": "exists",
  "message": "Artwork already exists",
  "artwork": {
    "_id": "60f7b3b3b3b3b3b3b3b3b3b3",
    "title": "Shaded Forest",
    "artist": "Jane Doe",
    "tags": ["forest", "moody", "autumn"],
    "uploadedAt": "2024-01-01T12:00:00Z"
  }
}
```

#### Error Responses

**400 Bad Request** - Validation error:
```json
{
  "error": "artist_name: Required",
  "statusCode": 400
}
```

**503 Service Unavailable** - Circuit breaker open (processor down):
```json
{
  "error": "Processor service is currently unavailable",
  "statusCode": 503
}
```

---

## Job Status

### GET /jobs/:id

Get job status. Checks Redis first for processing jobs, then falls back to backend for completed jobs.

#### Example

```bash
curl http://localhost:7000/jobs/f2dc197c-43b9-404d-b3f3-159282802609
```

#### Response: Processing (200 OK)

```json
{
  "job_id": "f2dc197c-43b9-404d-b3f3-159282802609",
  "status": "processing",
  "submitted_at": "2024-01-01T12:00:00Z",
  "message": "Job is currently being processed"
}
```

#### Response: Completed (200 OK)

```json
{
  "job_id": "f2dc197c-43b9-404d-b3f3-159282802609",
  "status": "completed",
  "submitted_at": "2024-01-01T12:00:00Z",
  "completed_at": "2024-01-01T12:01:15Z",
  "backend_artwork_id": "60f7b3b3b3b3b3b3b3b3b3b3"
}
```

#### Response: Failed (200 OK)

```json
{
  "job_id": "f2dc197c-43b9-404d-b3f3-159282802609",
  "status": "failed",
  "submitted_at": "2024-01-01T12:00:00Z",
  "completed_at": "2024-01-01T12:01:15Z",
  "error": {
    "code": "PROCESSING_FAILED",
    "message": "Image processing failed"
  }
}
```

#### Response: Not Found (404)

```json
{
  "error": "Job not found",
  "statusCode": 404
}
```

---

### GET /jobs/:id/result

Get complete job result with backend URLs. Returns 409 if job is still processing.

#### Example

```bash
curl http://localhost:7000/jobs/f2dc197c-43b9-404d-b3f3-159282802609/result
```

#### Response: Completed (200 OK)

```json
{
  "job_id": "f2dc197c-43b9-404d-b3f3-159282802609",
  "status": "completed",
  "submitted_at": "2024-01-01T12:00:00Z",
  "completed_at": "2024-01-01T12:01:15Z",
  "backend_artwork_id": "60f7b3b3b3b3b3b3b3b3b3b3",
  "urls": {
    "original": "http://localhost:7000/jobs/f2dc197c-43b9-404d-b3f3-159282802609/download/original",
    "protected": "http://localhost:7000/jobs/f2dc197c-43b9-404d-b3f3-159282802609/download/protected",
    "mask": "http://localhost:7000/jobs/f2dc197c-43b9-404d-b3f3-159282802609/download/mask"
  },
  "metadata": {
    "title": "Shaded Forest",
    "artist": "Jane Doe",
    "description": "A moody forest render",
    "tags": ["forest", "moody", "autumn"]
  }
}
```

#### Response: Failed (200 OK)

```json
{
  "job_id": "f2dc197c-43b9-404d-b3f3-159282802609",
  "status": "failed",
  "submitted_at": "2024-01-01T12:00:00Z",
  "completed_at": "2024-01-01T12:01:15Z",
  "error": {
    "code": "BACKEND_UPLOAD_FAILED",
    "message": "Backend returned 500: Internal Server Error"
  }
}
```

#### Error Responses

**404 Not Found**:
```json
{
  "error": "Job not found",
  "statusCode": 404
}
```

**409 Conflict** - Job still processing:
```json
{
  "error": "Job is still processing",
  "statusCode": 409
}
```

---

### GET /jobs/:id/download/:variant

Proxy download from backend. Fetches the file from backend storage and streams it to the client.

**Variants**: `original`, `protected`, `mask`

#### Example

```bash
# Download protected image
curl http://localhost:7000/jobs/f2dc197c-43b9-404d-b3f3-159282802609/download/protected \
  -o protected.jpg

# Download mask (SAC v1.1 binary format)
curl http://localhost:7000/jobs/f2dc197c-43b9-404d-b3f3-159282802609/download/mask \
  -o mask.sac
```

#### Response: Success (200 OK)

File streamed with appropriate headers:
- `Content-Type`: `image/jpeg`, `image/png`, or `application/octet-stream` (for mask)
- `Content-Disposition`: `inline; filename="shaded-forest-protected.jpg"`
- `Cache-Control`: `public, max-age=31536000, immutable`
- `ETag`: `"{job_id}-{variant}"`

#### Error Responses

**404 Not Found** - Job or variant not found:
```json
{
  "error": "Job not found",
  "statusCode": 404
}
```

**409 Conflict** - Job still processing:
```json
{
  "error": "Job is still processing",
  "statusCode": 409
}
```

**502 Bad Gateway** - Backend download failed:
```json
{
  "error": "Failed to download from backend",
  "statusCode": 502
}
```

---

## Callback Endpoints

### POST /callbacks/process-complete

Receives async completion callback from processor after it uploads artwork to backend.

**Authorization**: Validates `Authorization` header against `CALLBACK_AUTH_TOKEN`

#### Request Headers

```
Authorization: Bearer your-callback-auth-token
Content-Type: application/json
```

#### Request Body (Completed)

```json
{
  "job_id": "f2dc197c-43b9-404d-b3f3-159282802609",
  "status": "completed",
  "backend_artwork_id": "60f7b3b3b3b3b3b3b3b3b3b3",
  "processing_time_ms": 64000,
  "result": {
    "hashes": {
      "perceptual_hash": "0x123abc...",
      "average_hash": "0x456def...",
      "difference_hash": "0x789ghi...",
      "wavelet_hash": "0xabc123..."
    },
    "metadata": {
      "artist_name": "Jane Doe",
      "artwork_title": "Shaded Forest"
    },
    "watermark": {
      "strategy": "tree-ring",
      "strength": 0.5
    }
  }
}
```

#### Request Body (Failed)

```json
{
  "job_id": "f2dc197c-43b9-404d-b3f3-159282802609",
  "status": "failed",
  "processing_time_ms": 12000,
  "error": {
    "code": "BACKEND_UPLOAD_FAILED",
    "message": "Backend returned 500: Internal Server Error"
  }
}
```

#### Response: Success (200 OK)

```json
{
  "received": true,
  "job_id": "f2dc197c-43b9-404d-b3f3-159282802609",
  "artwork_id": "60f7b3b3b3b3b3b3b3b3b3b3",
  "status": "completed"
}
```

#### Error Responses

**401 Unauthorized** - Invalid auth token:
```json
{
  "error": "Unauthorized",
  "statusCode": 401
}
```

**400 Bad Request** - Missing backend_artwork_id:
```json
{
  "error": "Missing backend_artwork_id in callback payload",
  "statusCode": 400
}
```

---

## Health Checks

### GET /health

Comprehensive health check that monitors all dependent services.

#### Example

```bash
curl http://localhost:7000/health
```

#### Response: Healthy (200 OK)

```json
{
  "status": "healthy",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "uptime": 123.45,
  "version": "1.0.0",
  "services": {
    "processor": {
      "status": "up",
      "message": "Processor is operational",
      "responseTime": 45,
      "details": {
        "circuitBreaker": {
          "state": "closed",
          "failureCount": 0
        }
      }
    },
    "backend": {
      "status": "up",
      "message": "Backend and database are operational",
      "responseTime": 32
    },
    "redis": {
      "status": "up",
      "message": "Redis is operational",
      "responseTime": 12,
      "details": {
        "jobs": {
          "waiting": 0,
          "active": 2,
          "completed": 145,
          "failed": 0,
          "delayed": 0
        }
      }
    }
  }
}
```

#### Response: Degraded (200 OK)

```json
{
  "status": "degraded",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "uptime": 123.45,
  "version": "1.0.0",
  "services": {
    "processor": {
      "status": "degraded",
      "message": "Circuit breaker is open",
      "responseTime": 52,
      "details": {
        "circuitBreaker": {
          "state": "open",
          "failureCount": 5
        }
      }
    },
    "backend": {
      "status": "up",
      "message": "Backend and database are operational",
      "responseTime": 32
    },
    "redis": {
      "status": "up",
      "message": "Redis is operational",
      "responseTime": 12
    }
  }
}
```

#### Response: Unhealthy (503 Service Unavailable)

```json
{
  "status": "unhealthy",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "uptime": 123.45,
  "version": "1.0.0",
  "services": {
    "processor": {
      "status": "down",
      "message": "Processor health check failed",
      "responseTime": 5002
    },
    "backend": {
      "status": "down",
      "message": "Backend health check failed (database may be unavailable)"
    },
    "redis": {
      "status": "up",
      "message": "Redis is operational",
      "responseTime": 12
    }
  }
}
```

---

### GET /health/live

Simple liveness probe for container orchestration (Kubernetes/Docker).

#### Example

```bash
curl http://localhost:7000/health/live
```

#### Response (200 OK)

```json
{
  "status": "alive",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

---

### GET /health/ready

Readiness probe that checks if critical services (processor, backend) are available.

#### Example

```bash
curl http://localhost:7000/health/ready
```

#### Response: Ready (200 OK)

```json
{
  "status": "ready",
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

#### Response: Not Ready (503 Service Unavailable)

```json
{
  "status": "not_ready",
  "timestamp": "2024-01-01T12:00:00.000Z",
  "services": {
    "processor": "down",
    "backend": "up"
  }
}
```

---

## Error Codes

### HTTP Status Codes

| Status | Description |
|--------|-------------|
| `200 OK` | Request successful |
| `202 Accepted` | Job queued for processing |
| `400 Bad Request` | Validation error or malformed request |
| `401 Unauthorized` | Invalid authentication token (callbacks) |
| `404 Not Found` | Job or resource not found |
| `409 Conflict` | Job not yet complete (when requesting results) |
| `500 Internal Server Error` | Server error |
| `502 Bad Gateway` | Backend/processor error |
| `503 Service Unavailable` | Circuit breaker open or critical service down |

### Callback Error Codes

| Code | Description |
|------|-------------|
| `PROCESSING_FAILED` | Image processing error |
| `BACKEND_UPLOAD_FAILED` | Backend upload error |
| `UNKNOWN_ERROR` | Unexpected error |

---

## Field Normalization

The router accepts both camelCase and snake_case field names and automatically normalizes them:

- **Case conversion**: `artistName` → `artist_name`
- **Boolean parsing**: `"true"`, `"false"`, `"1"`, `"0"` → boolean
- **Array parsing**: `"tag1,tag2,tag3"` → `["tag1", "tag2", "tag3"]`
- **JSON parsing**: `'{"key":"value"}'` → object

---

## Rate Limiting

Default rate limits (configurable via environment variables):

- **Max requests**: 100 requests per window
- **Window duration**: 60 seconds (1 minute)

Configure in `.env`:
```env
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=60000
```

---

## Configuration

All configuration is via environment variables. See `.env.example` for all options.

**Key settings:**
- `PORT`: Server port (default: `7000`)
- `BACKEND_URL`: Backend storage API endpoint (default: `http://localhost:5001`)
- `PROCESSOR_URL`: Processor core API endpoint (default: `http://localhost:8000`)
- `CALLBACK_AUTH_TOKEN`: Secret token for validating processor callbacks
- `MAX_FILE_SIZE`: Upload limit in bytes (default: `268435456` = 256MB)

---

## Related Documentation

- **[BACKEND-API.md](./BACKEND-API.md)** - Backend storage API reference
- **[PROCESSOR-API.md](./PROCESSOR-API.md)** - Processor core API reference
- **[poison-mask-grayscale-protocol.md](./poison-mask-grayscale-protocol.md)** - Mask encoding protocol
- **[README.md](../README.md)** - Quick start and overview
- **[DEPLOYMENT.md](../DEPLOYMENT.md)** - Deployment guide
