# Artorize Processor Core - API Documentation

## API Base URL
`http://localhost:8000`

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

## Unified Job Parameters (Extended)

These parameters may be supplied either as multipart form fields (stringified where needed) or in the JSON body variant.

### Core Source Fields
- `file` (binary, required if no image_url/local_path): Image file
- `image_url` (string, optional): Remote image to fetch
- `local_path` (string, optional): Server-accessible path (internal use)
  At least one of: file | image_url | local_path

### Global Execution Flags
- `include_hash_analysis` (bool/string, default: true)
- `include_protection` (bool/string, default: true)
- `processors` (array or comma-separated string, optional): Subset of analysis processors
- `enable_tineye` (bool/string, default: false)
- `max_stage_dim` (int, default: 512): Longest side resize for protection pipeline

### Artwork / Metadata (optional but recommended)
- `artist_name` (string, 1-120)
- `artwork_title` (string, 1-200)
- `artwork_description` (string, 0-2000)
- `artwork_creation_time` (ISO 8601; defaults to server receipt time)
- `tags` (array|string, <=25 items, each <=50 chars)
- `extra_metadata` (object|JSON string)

### Protection Layer Toggles (override global include_protection)
- `enable_fawkes` (bool, default: true)
- `enable_photoguard` (bool, default: true)
- `enable_mist` (bool, default: true)
- `enable_nightshade` (bool, default: true)
- `enable_stegano_embed` (bool, default: false)
- `enable_c2pa_manifest` (bool, default: true)
- `watermark_strategy` (string enum: invisible-watermark|tree-ring|none, default: invisible-watermark)

### Watermark / Stegano Parameters
- `watermark_text` (string, default: "artscraper")
- `tree_ring_frequency` (float, default: 9.0)
- `tree_ring_amplitude` (float, default: 18.0)
- `stegano_message` (string, default: "Protected by artscraper") used if enable_stegano_embed=true

### C2PA Manifest Parameters
- `c2pa_claim_generator` (string, optional)
- `c2pa_assertions` (array/object JSON, optional)
- `c2pa_vendor` (string, optional)

### TinEye Specific
- Requires environment: `TINEYE_API_KEY`
- Optional throttle env: `TINEYE_MIN_INTERVAL_SEC`

### Hash / Analysis Processor Fine Control
If you supply `processors`, only those listed run (and only if `include_hash_analysis` is true).
Supported names (see next section for detail):
`metadata,imagehash,dhash,blockhash,stegano,tineye`

### JSON Body Full Example (Extended)
```json
{
  "image_url": "https://example.com/image.jpg",
  "processors": ["metadata", "imagehash", "blockhash"],
  "include_hash_analysis": true,
  "include_protection": true,
  "enable_tineye": false,
  "max_stage_dim": 768,
  "artist_name": "Jane Doe",
  "artwork_title": "Shaded Forest",
  "artwork_description": "A moody forest render",
  "artwork_creation_time": "2024-09-01T10:00:00Z",
  "tags": ["forest", "moody"],
  "extra_metadata": { "collection": "AutumnPack" },
  "enable_fawkes": true,
  "enable_photoguard": true,
  "enable_mist": true,
  "enable_nightshade": false,
  "watermark_strategy": "tree-ring",
  "watermark_text": "artscraper",
  "tree_ring_frequency": 8.5,
  "tree_ring_amplitude": 16.0,
  "enable_stegano_embed": true,
  "stegano_message": "Protected by artscraper",
  "enable_c2pa_manifest": true,
  "c2pa_claim_generator": "Artorize Core 1.0.0"
}
```

### Multipart Form Field Mapping Example
```bash
curl -X POST http://localhost:8000/v1/jobs \
 -F "file=@image.jpg" \
 -F "processors=metadata,imagehash,blockhash" \
 -F "include_hash_analysis=true" \
 -F "include_protection=true" \
 -F "enable_nightshade=false" \
 -F "watermark_strategy=tree-ring" \
 -F "tree_ring_frequency=9.0" \
 -F "tree_ring_amplitude=18.0" \
 -F "enable_stegano_embed=true" \
 -F "stegano_message=Protected by artscraper" \
 -F "artist_name=Jane Doe" \
 -F "artwork_title=Shaded Forest"
```

## Analysis Processor Details (Expanded)

| Name | Purpose | Key Outputs |
|------|---------|-------------|
| metadata | Format, size, mode, EXIF | width, height, format, exif |
| imagehash | aHash, pHash, dHash (baseline), wHash, colorhash | multiple hex digests |
| dhash | Row/column variant dHash | dhash_row, dhash_col |
| blockhash | Block-based 8 & 16 precision | blockhash8, blockhash16 |
| stegano | LSB presence & extracted payload | has_stegano, message |
| tineye | Reverse search matches | matches[], total_matches |

Notes:
- `stegano` (analysis) vs `stegano-embed` (protection layer) are distinct.
- `dhash` offered separately for alternative algorithm fidelity.

## Protection Layer Detail

| Layer | Internal Key | Description | Primary Params |
|-------|--------------|-------------|----------------|
| Fawkes | fawkes | Face/feature cloaking noise | enable_fawkes |
| PhotoGuard | photoguard | Blur + edge blending | enable_photoguard |
| Mist | mist | Subtle contrast & color jitter | enable_mist |
| Nightshade | nightshade | Pixel shift adversarial pattern | enable_nightshade |
| Invisible Watermark | invisible-watermark | LSB text embedding (light) | watermark_text, watermark_strategy |
| Tree Ring | tree-ring | Radial frequency watermark | tree_ring_frequency, tree_ring_amplitude |
| Stegano Embed | stegano-embed | LSB hidden message | enable_stegano_embed, stegano_message |
| C2PA Manifest | c2pa-manifest | Provenance metadata bundle | enable_c2pa_manifest, c2pa_* params |

Watermark strategy decision:
- If `watermark_strategy=tree-ring` runs tree-ring
- If `watermark_strategy=invisible-watermark` runs invisible-watermark
- If `none`, no watermark layer unless other layers enabled

## Output Structure Additions

Additional possible analysis result fields (if those processors selected):
```json
"analysis": {
  "processors": [
    {
      "name": "metadata",
      "ok": true,
      "results": { "width": 1920, "height": 1080, "format": "JPEG", "mode": "RGB" }
    },
    {
      "name": "blockhash",
      "ok": true,
      "results": { "blockhash8": "ffeeddccbbaa9988", "blockhash16": "..." }
    }
  ]
}
```

Stegano embed layer example (if enabled):
```json
{
  "stage": "stegano-embed",
  "description": "Hidden message embedded via LSB",
  "path": "/layers/05-stegano/image.png",
  "processing_size": [512,512],
  "mask_path": null
}
```

## Validation & Defaults Summary
- Boolean fields accept: true/false/"true"/"false"/1/0
- Frequencies/amplitudes clamped to reasonable ranges (freq 1–32, amp 1–64)
- `max_stage_dim` minimum 128, maximum 4096
- Empty `processors` means auto-select all analysis processors if `include_hash_analysis=true`

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