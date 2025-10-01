# Artorize Processor Core - API Documentation

## API Base URL
`http://localhost:8000`

## Architecture Overview

The Processor Core supports two processing modes:

1. **Legacy Synchronous Mode** (endpoints 1-5): Traditional request-response pattern where clients wait for processing to complete. Suitable for development and small-scale deployments.

2. **Async Callback Mode** (endpoint 6, **recommended**): Modern async pattern with callback notification. Eliminates double image transfer by uploading results to S3/CDN and sending only metadata via callback. Recommended for production deployments.

**Benefits of Async Callback Mode:**
- 50% reduction in network bandwidth (image transferred once)
- Non-blocking: Router returns immediately with job ID
- Scalability: Processor can queue jobs without blocking clients
- CDN integration: Processed images served from CDN, not via API
- Resilience: Automatic retry logic prevents lost results

## API Endpoints

### 1. Submit Job (File Upload)
```http
POST /v1/jobs
Content-Type: multipart/form-data
```

**Request Parameters:**
- `file` (binary, required): Image file to process
- `include_hash_analysis` (string, optional): Enable analysis processors ("true"/"false", default: "true")
- `include_protection` (string, optional): Enable protection layers ("true"/"false", default: "true")
- `enable_tineye` (string, optional): Enable TinEye analysis ("true"/"false", default: "false")
- `processors` (string, optional): Comma-separated list of specific processors to run

**Response Body:**
```json
{
  "job_id": "abc123def456",
  "status": "queued"
}
```

### 1b. Submit Job (JSON Payload)
```http
POST /v1/jobs
Content-Type: application/json
```

**Request Body:**
```json
{
  "image_url": "https://example.com/image.jpg",
  "local_path": "/path/to/image.jpg",
  "processors": ["imagehash", "stegano"],
  "include_hash_analysis": true,
  "include_protection": true,
  "enable_tineye": false
}
```

**Response Body:**
```json
{
  "job_id": "abc123def456",
  "status": "queued"
}
```

---

### 2. Get Job Status
```http
GET /v1/jobs/{job_id}
```

**Path Parameters:**
- `job_id` (string, required): Job ID

**Response Body (200):**
```json
{
  "job_id": "abc123def456",
  "status": "queued|running|done|error",
  "submitted_at": "2024-01-01T12:00:00Z",
  "updated_at": "2024-01-01T12:03:00Z",
  "error": null
}
```

**Response Body (404):**
```json
{
  "detail": "job not found"
}
```

---

### 3. Get Job Result
```http
GET /v1/jobs/{job_id}/result
```

**Path Parameters:**
- `job_id` (string, required): Job ID

**Response Body (200):**
```json
{
  "job_id": "abc123def456",
  "summary": {
    "image": "/path/to/input/image.jpg",
    "analysis": "/path/to/analysis.json",
    "layers": [
      {
        "stage": "original",
        "description": "Unmodified input image",
        "path": "/path/to/layers/00-original/image.jpg",
        "processing_size": [1920, 1080],
        "mask_path": null
      },
      {
        "stage": "fawkes",
        "description": "Gaussian cloak perturbation",
        "path": "/path/to/layers/01-fawkes/image.jpg",
        "processing_size": [512, 288],
        "mask_path": "/path/to/layers/01-fawkes/image_fawkes_mask.png"
      }
    ],
    "projects": [
      {
        "name": "Fawkes",
        "notes": "Applied synthetic cloaking perturbation.",
        "applied": true,
        "layer_path": "/path/to/layers/01-fawkes/image.jpg"
      }
    ]
  },
  "analysis": {
    "processors": [
      {
        "name": "imagehash",
        "ok": true,
        "results": {
          "average_hash": "0x1234567890abcdef",
          "perceptual_hash": "0xfedcba0987654321"
        }
      }
    ]
  },
  "output_dir": "/path/to/output/directory"
}
```

### 4. Download Layer Image
```http
GET /v1/jobs/{job_id}/layers/{layer}
```

**Path Parameters:**
- `job_id` (string, required): Job ID
- `layer` (string, required): Layer name (`original`, `fawkes`, `photoguard`, `mist`, `nightshade`, `invisible-watermark`, `tree-ring`, `stegano-embed`, `c2pa-manifest`)

**Response Body (200):**
```
Content-Type: image/jpeg|image/png
[Binary image data]
```

**Response Body (404):**
```json
{
  "detail": "layer not found"
}
```

**Response Body (409):**
```json
{
  "detail": "job not complete"
}
```

---

### 5. Delete Job
```http
DELETE /v1/jobs/{job_id}
```

**Path Parameters:**
- `job_id` (string, required): Job ID

**Response Body (200):**
```json
{
  "job_id": "abc123def456",
  "status": "deleted"
}
```

**Response Body (404):**
```json
{
  "detail": "job not found"
}
```

---

## Processor Control

The API provides granular control over which processors run:

### Analysis Processor Control
- `include_hash_analysis`: Enables/disables all analysis processors (imagehash, stegano detection, etc.)
- `processors`: Comma-separated list to run only specific analysis processors (e.g., "imagehash,stegano")
- `enable_tineye`: Enables TinEye reverse image search (requires API key)

### Protection Layer Control
- `include_protection`: Enables/disables all protection layers
- Individual protection layers can be controlled via configuration files (see Configuration section)

### Available Analysis Processors

The following processor names can be used in the `processors` parameter:

- **`metadata`** - EXIF/image metadata extraction (format, size, mode, EXIF data)
- **`imagehash`** - Perceptual hashing (pHash, aHash, dHash, wHash, colorhash)
- **`dhash`** - Alternative dHash implementation with row/column variants
- **`blockhash`** - Block-based hashing (8-bit and 16-bit variants)
- **`stegano`** - LSB steganography detection and message extraction
- **`tineye`** - Reverse image search (requires `TINEYE_API_KEY` environment variable)

**Example processor filtering:**
```bash
# Run only metadata and perceptual hashing
curl -F "file=@image.jpg" -F "processors=metadata,imagehash" http://localhost:8000/v1/jobs

# Run all hash-related processors
curl -F "file=@image.jpg" -F "processors=imagehash,dhash,blockhash" http://localhost:8000/v1/jobs
```

### Available Protection Layers
- `fawkes`: Gaussian noise cloaking
- `photoguard`: Blur + edge blending
- `mist`: Color/contrast enhancement
- `nightshade`: Pixel shifting + noise
- `invisible-watermark`: LSB text watermark
- `tree-ring`: Radial watermark pattern
- `stegano-embed`: Steganographic message embedding
- `c2pa-manifest`: C2PA provenance manifest

---

### 6. Process Artwork with Callback (Async)
```http
POST /v1/process/artwork
Content-Type: multipart/form-data
```

**Purpose:** Submit artwork for processing with async callback support. This endpoint eliminates double image transfer by uploading results to storage and sending a callback with URLs instead of returning the image data.

**Request Parameters:**
- `file` (binary, required): Image file to process
- `metadata` (string, required): JSON string containing job metadata and callback configuration

**Metadata JSON Schema:**
```json
{
  "job_id": "uuid-generated-by-client",
  "artist_name": "Artist Name",
  "artwork_title": "Artwork Title",
  "callback_url": "http://router.example.com/api/callbacks/process-complete",
  "callback_auth_token": "Bearer secret-token-for-callback",
  "processors": ["metadata", "imagehash", "stegano"],
  "watermark_strategy": "invisible-watermark",
  "watermark_strength": 0.5,
  "tags": ["digital-art", "portrait"]
}
```

**Metadata Fields:**
- `job_id` (string, required): Unique job identifier (UUID recommended, generated by client)
- `artist_name` (string, required): Artist name (1-120 characters)
- `artwork_title` (string, required): Artwork title (1-200 characters)
- `callback_url` (string, required): Full URL to send completion callback to (e.g., "http://router.example.com/api/callbacks/process-complete")
- `callback_auth_token` (string, required): Authorization token for callback authentication (e.g., "Bearer secret-token")
- `processors` (array, optional): List of specific processors to run (e.g., `["metadata", "imagehash", "stegano"]`)
  - Supported: `metadata`, `imagehash`, `dhash`, `blockhash`, `stegano`, `tineye`
- `watermark_strategy` (string, optional): Watermark strategy to apply
  - Supported: `invisible-watermark`, `tree-ring`, `none`
- `watermark_strength` (float, optional): Watermark strength (0.0-1.0, default: 0.5)
- `tags` (array, optional): Tags for categorization (e.g., `["digital-art", "portrait"]`)

**Response Body (202 Accepted):**
```json
{
  "job_id": "uuid-generated-by-client",
  "status": "processing",
  "estimated_time_seconds": 45,
  "message": "Job queued for processing. Callback will be sent upon completion."
}
```

**Callback Payload (Success):**

When processing completes successfully, a POST request is sent to `callback_url` with the `Authorization` header set to `callback_auth_token`:

```http
POST http://router.example.com/api/callbacks/process-complete
Authorization: Bearer secret-token-for-callback
Content-Type: application/json
```

```json
{
  "job_id": "uuid-generated-by-client",
  "status": "completed",
  "processing_time_ms": 42350,
  "result": {
    "protected_image_url": "https://cdn.artorizer.com/protected/abc123.jpg",
    "thumbnail_url": "https://cdn.artorizer.com/thumbnails/abc123_thumb.jpg",
    "metadata": {
      "width": 1920,
      "height": 1080,
      "format": "JPEG",
      "color_profile": "sRGB",
      "dpi": 300,
      "artist_name": "Artist Name",
      "artwork_title": "Artwork Title"
    },
    "hashes": {
      "sha256": "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855",
      "perceptual_hash": "0xfedcba0987654321",
      "average_hash": "0x1234567890abcdef",
      "difference_hash": "0xabcdef1234567890",
      "blockhash8": "0xaabbccddee112233"
    },
    "watermark": {
      "strategy": "invisible-watermark",
      "strength": 0.5,
      "signature": "artorizer-v1-2024-signature-hash"
    },
    "processors_applied": [
      {
        "name": "metadata",
        "success": true,
        "duration_ms": 120
      },
      {
        "name": "imagehash",
        "success": true,
        "duration_ms": 350
      },
      {
        "name": "stegano",
        "success": true,
        "duration_ms": 41880
      }
    ]
  }
}
```

**Callback Response Fields:**
- `job_id` (string): Original job identifier
- `status` (string): Job status (`completed` or `failed`)
- `processing_time_ms` (number): Total processing time in milliseconds
- `result.protected_image_url` (string): CDN/storage URL for the protected image
- `result.thumbnail_url` (string): CDN/storage URL for the thumbnail (typically 256x256 or smaller)
- `result.metadata` (object): Image metadata including dimensions, format, artist info
- `result.hashes` (object): Perceptual hashes computed during processing (for duplicate detection)
- `result.watermark` (object): Watermark configuration applied
- `result.processors_applied` (array): List of processors executed with success status and duration

**Callback Payload (Error):**

If processing fails, the callback payload will contain detailed error information:

```json
{
  "job_id": "uuid-generated-by-client",
  "status": "failed",
  "processing_time_ms": 5200,
  "error": {
    "code": "WATERMARK_INJECTION_FAILED",
    "message": "Failed to inject invisible watermark: insufficient image entropy",
    "processor": "stegano",
    "details": {
      "attempted_strength": 0.5,
      "min_required_entropy": 6.2,
      "actual_entropy": 4.8
    }
  }
}
```

**Error Response Fields:**
- `error.code` (string): Machine-readable error code (e.g., `WATERMARK_INJECTION_FAILED`, `IMAGE_PROCESSING_ERROR`, `STORAGE_UPLOAD_FAILED`)
- `error.message` (string): Human-readable error description
- `error.processor` (string, optional): Name of the processor that failed
- `error.details` (object, optional): Additional error context (processor-specific)

**Error Response Codes:**
- `400` - Invalid metadata, missing required fields, or unsupported image format
- `413` - Image file too large
- `503` - Processor queue full or service unavailable

**Storage Configuration:**

The endpoint supports multiple storage backends for processed images. Configure via environment variables:

- **S3 Storage (recommended for production)**:
  ```bash
  PROCESSED_IMAGE_STORAGE=s3
  S3_BUCKET_NAME=artorizer-protected-images
  S3_REGION=us-east-1
  CDN_BASE_URL=https://cdn.artorizer.com
  ```
  - Uploads images to S3 bucket
  - Returns CDN URLs in callback (e.g., `https://cdn.artorizer.com/protected/abc123.jpg`)
  - Requires AWS credentials configured (IAM role, environment variables, or ~/.aws/credentials)
  - Automatic thumbnail generation (typically 256x256 or proportional)

- **Local Storage (default, development only)**:
  ```bash
  PROCESSED_IMAGE_STORAGE=local
  # No additional config needed
  ```
  - Images stored in `outputs/protected/` and `outputs/thumbnails/`
  - Returns local HTTP URLs (e.g., `http://localhost:8000/v1/storage/protected/{job_id}.jpeg`)
  - **Not recommended for production** (no persistence across container restarts)

- **CDN Direct Upload (advanced)**:
  ```bash
  PROCESSED_IMAGE_STORAGE=cdn
  CDN_BASE_URL=https://cdn.artorizer.com
  CDN_UPLOAD_ENDPOINT=https://upload.cdn.artorizer.com/v1/upload
  CDN_API_KEY=your-cdn-api-key
  ```
  - Direct upload to CDN provider
  - Bypasses S3 for faster distribution

**Example Usage:**

```bash
# Example 1: Basic artwork processing with invisible watermark
METADATA='{
  "job_id": "550e8400-e29b-41d4-a716-446655440000",
  "artist_name": "Jane Doe",
  "artwork_title": "Digital Sunrise",
  "callback_url": "http://router.artorizer.local:3000/api/callbacks/process-complete",
  "callback_auth_token": "Bearer my-secret-callback-token-12345",
  "watermark_strategy": "invisible-watermark",
  "watermark_strength": 0.7
}'

curl -X POST http://localhost:8000/v1/process/artwork \
  -F "file=@artwork.jpg" \
  -F "metadata=$METADATA"

# Example 2: Full processing with all hash analysis and tags
METADATA='{
  "job_id": "c9e1c7b0-8e3f-4d7a-9c6b-5a8e4f3d2c1b",
  "artist_name": "John Smith",
  "artwork_title": "Abstract Expression #42",
  "callback_url": "https://api.artorizer.com/callbacks/process-complete",
  "callback_auth_token": "Bearer prod-secret-token-xyz789",
  "processors": ["metadata", "imagehash", "dhash", "blockhash"],
  "watermark_strategy": "tree-ring",
  "watermark_strength": 0.5,
  "tags": ["abstract", "digital-art", "generative"]
}'

curl -X POST http://localhost:8000/v1/process/artwork \
  -F "file=@abstract_art.png" \
  -F "metadata=$METADATA"

# Example 3: Minimal processing without watermark
METADATA='{
  "job_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
  "artist_name": "Alice Johnson",
  "artwork_title": "Photography Study",
  "callback_url": "http://localhost:3000/api/callbacks/process-complete",
  "callback_auth_token": "Bearer dev-token",
  "processors": ["metadata", "imagehash"],
  "watermark_strategy": "none"
}'

curl -X POST http://localhost:8000/v1/process/artwork \
  -F "file=@photo.jpg" \
  -F "metadata=$METADATA"
```

**Callback Security:**

The callback is sent with the `Authorization` header containing the token provided in `callback_auth_token`. The receiving endpoint **must validate** this token before processing the callback to prevent unauthorized result injection.

**Expected Callback Response:**

The callback endpoint should respond with `200 OK` to confirm receipt:

```json
{
  "status": "received",
  "job_id": "uuid-generated-by-client",
  "message": "Processing result stored successfully"
}
```

Any non-200 response will trigger retry logic.

**Retry Logic:**

The processor implements automatic retry for failed callbacks:

- **Retry attempts**: 3 (configurable via `CALLBACK_RETRY_ATTEMPTS`)
- **Retry delay**: 2 seconds between attempts (configurable via `CALLBACK_RETRY_DELAY_MS`)
- **Timeout**: 10 seconds per callback request (configurable via `CALLBACK_TIMEOUT_MS`)
- **Dead Letter Queue**: Failed callbacks after all retries are logged and stored for manual review

Configuration example:
```bash
CALLBACK_TIMEOUT_MS=10000
CALLBACK_RETRY_ATTEMPTS=3
CALLBACK_RETRY_DELAY_MS=2000
```

---

### 7. Extract Image Hashes
```http
POST /v1/images/extract-hashes
Content-Type: multipart/form-data
```

**Purpose:** Extract perceptual hashes from an image for similarity analysis or storage.

**Request Parameters (Multipart):**
- `file` (binary, required): Image file to analyze
- `hash_types` (string, optional): Comma-separated hash types to compute (default: "all")
  - Supported: `phash`, `ahash`, `dhash`, `whash`, `colorhash`, `blockhash`, `blockhash8`, `blockhash16`, `all`

**Alternative JSON Request:**
```http
POST /v1/images/extract-hashes
Content-Type: application/json
```

```json
{
  "image_url": "https://example.com/image.jpg",
  "local_path": "/path/to/image.jpg",
  "hash_types": ["phash", "ahash", "dhash"]
}
```

**Response Body (200):**
```json
{
  "hashes": {
    "perceptual_hash": "0xccb4e7f2988b310e",
    "average_hash": "0xfff753db98003000",
    "difference_hash": "0x0da6b6b33107e141",
    "wavelet_hash": "0xfff7d3db99003000",
    "color_hash": "0x11640008000",
    "blockhash8": "0xaabbccddee112233",
    "blockhash16": "0x1234567890abcdef1234567890abcdef"
  },
  "metadata": {
    "width": 7479,
    "height": 11146,
    "format": "JPEG",
    "mode": "RGB"
  }
}
```

**Response Body (400):**
```json
{
  "detail": "Failed to open image file"
}
```

**Hash Type Descriptions:**
- `perceptual_hash` (phash): Most robust for similarity detection, resistant to scaling/compression
- `average_hash` (ahash): Fast, good for exact or near-duplicate detection
- `difference_hash` (dhash): Edge-based comparison, detects structural changes
- `wavelet_hash` (whash): Texture-based comparison using wavelet transform
- `color_hash`: Color distribution comparison, detects color palette changes
- `blockhash8`: Block-based hash with 8-bit precision (requires Python 3.12.x)
- `blockhash16`: Block-based hash with 16-bit precision (requires Python 3.12.x)

**Example Usage:**
```bash
# Extract all hashes from uploaded file
curl -F "file=@image.jpg" http://localhost:8000/v1/images/extract-hashes

# Extract only perceptual and average hashes
curl -F "file=@image.jpg" -F "hash_types=phash,ahash" http://localhost:8000/v1/images/extract-hashes

# Extract hashes from local file path (JSON)
curl -X POST http://localhost:8000/v1/images/extract-hashes \
  -H "Content-Type: application/json" \
  -d '{"local_path": "input/image.jpg"}'
```

---

### 8. Find Similar Images
```http
POST /v1/images/find-similar
Content-Type: multipart/form-data
```

**Purpose:** Find similar images in the system based on perceptual hash comparison.

**Request Parameters (Multipart):**
- `file` (binary, required): Query image file
- `threshold` (string, optional): Similarity threshold 0.0-1.0 (default: 0.85)
- `limit` (string, optional): Maximum number of results (default: 10, max: 100)
- `hash_types` (string, optional): Comma-separated hash types to use for comparison

**Alternative JSON Request:**
```http
POST /v1/images/find-similar
Content-Type: application/json
```

```json
{
  "image_url": "https://example.com/image.jpg",
  "local_path": "/path/to/image.jpg",
  "threshold": 0.85,
  "limit": 10,
  "hash_types": ["phash", "ahash", "dhash"]
}
```

**Response Body (200):**
```json
{
  "query_hashes": {
    "perceptual_hash": "0xccb4e7f2988b310e",
    "average_hash": "0xfff753db98003000",
    "difference_hash": "0x0da6b6b33107e141"
  },
  "similar_images": [
    {
      "artwork_id": "60f7b3b3b3b3b3b3b3b3b3b3",
      "title": "Similar Artwork 1",
      "artist": "Artist Name",
      "similarity_score": 0.95,
      "matching_hashes": {
        "perceptual_hash": 0.98,
        "average_hash": 0.92,
        "difference_hash": 0.94
      },
      "thumbnail_url": "/artworks/60f7b3b3b3b3b3b3b3b3b3b3?variant=protected",
      "uploaded_at": "2023-07-21T09:15:00Z"
    }
  ],
  "total_matches": 5,
  "search_time_ms": 142
}
```

**Response Body (400):**
```json
{
  "detail": "threshold must be between 0.0 and 1.0"
}
```

**Response Body (503):**
```json
{
  "detail": {
    "error": "Backend storage service not configured",
    "message": "Set STORAGE_BACKEND_URL environment variable...",
    "query_hashes": { "perceptual_hash": "0x..." },
    "similar_images": [],
    "total_matches": 0
  }
}
```

**Configuration:**

This endpoint requires an external backend storage service. Configure via environment variables:

```bash
STORAGE_BACKEND_URL=http://localhost:3000
STORAGE_BACKEND_TIMEOUT=30  # seconds
```

The backend service must implement the `/v1/similarity/search` endpoint accepting:
```json
{
  "hashes": { "perceptual_hash": "0x...", "average_hash": "0x..." },
  "threshold": 0.85,
  "limit": 10
}
```

**Example Usage:**
```bash
# Find similar images with default settings
curl -F "file=@query_image.jpg" http://localhost:8000/v1/images/find-similar

# Custom threshold and limit
curl -F "file=@query_image.jpg" \
  -F "threshold=0.9" \
  -F "limit=20" \
  http://localhost:8000/v1/images/find-similar

# JSON payload with local path
curl -X POST http://localhost:8000/v1/images/find-similar \
  -H "Content-Type: application/json" \
  -d '{"local_path": "input/image.jpg", "threshold": 0.9, "limit": 5}'
```

**Note:** If the backend storage service is not configured, the endpoint will return a 503 error with the computed hashes but no similarity results.

---

## Configuration Files

Protection layers can be configured via JSON/TOML files or environment variables:

### JSON Configuration Example
```json
{
  "workflow": {
    "enable_fawkes": true,
    "enable_photoguard": true,
    "enable_mist": true,
    "enable_nightshade": true,
    "watermark_strategy": "invisible-watermark",
    "watermark_text": "artscraper",
    "tree_ring_frequency": 9.0,
    "tree_ring_amplitude": 18.0,
    "enable_stegano_embed": false,
    "stegano_message": "Protected by artscraper",
    "enable_c2pa_manifest": true
  },
  "input_dir": "input",
  "output_root": "outputs",
  "include_hash_analysis": true,
  "include_tineye": false,
  "max_stage_dim": 512
}
```

### Environment Variables
```bash
ARTORIZE_RUNNER_WORKFLOW__ENABLE_FAWKES=true
ARTORIZE_RUNNER_WORKFLOW__ENABLE_PHOTOGUARD=false
ARTORIZE_RUNNER_WORKFLOW__WATERMARK_STRATEGY=tree-ring
ARTORIZE_RUNNER_INCLUDE_HASH_ANALYSIS=true
```

### Configuration Loading
Set `ARTORIZE_RUNNER_CONFIG=/path/to/config.json` or pass config path to load functions.

---

## Error Response Format

Error responses include a `detail` field with the error message:
```json
{
  "detail": "job not found"
}
```

---

## FastAPI Documentation

When running the server, interactive API documentation is available at:
- Swagger UI: `http://localhost:8000/docs`
- ReDoc: `http://localhost:8000/redoc`

---

## Workflow Comparison: Sync vs Async

### Legacy Synchronous Workflow (POST /v1/jobs)

```
Client → POST /v1/jobs (upload image)
         ↓
Processor → Process image (client waits)
         ↓
Processor → Return processed image data
         ↓
Client ← Receive processed image (download image)
```

**Issues:**
- Image transferred twice (upload + download)
- Client blocked during processing (30-60 seconds)
- No job queuing (processor must handle request immediately)
- Memory-intensive (holds processed image in memory until download)

### Modern Async Callback Workflow (POST /v1/process/artwork)

```
Client → POST /v1/process/artwork (upload image + callback URL)
         ↓
Processor → Return 202 Accepted with job_id
         ↓
Client ← Receive job_id immediately (non-blocking)

[Meanwhile, processor processes asynchronously]

Processor → Upload results to S3/CDN
         ↓
Processor → POST callback to Client (metadata only, no image)
         ↓
Client ← Receive CDN URLs for protected image
```

**Benefits:**
- Image transferred once (client upload only)
- Client returns immediately (sub-second response)
- Processor queues jobs for optimal resource usage
- Results served from CDN (infinite scalability)
- Automatic retry on callback failure

**Recommendation:** Use async callback mode for all production deployments. Use sync mode only for development, testing, or when callback infrastructure is not available.