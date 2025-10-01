# Artorize Storage Backend API Reference

A Node.js/Express service for secure artwork storage and retrieval using MongoDB GridFS.

**Base URL**: `http://localhost:3000` (configurable)

## Quick Start

```bash
# Health check
curl http://localhost:3000/health

# Search artworks
curl "http://localhost:3000/artworks?artist=Picasso&limit=5"

# Get artwork metadata
curl http://localhost:3000/artworks/{id}/metadata

# Stream artwork file
curl http://localhost:3000/artworks/{id}?variant=original
```

## Rate Limits

- **General**: 300 requests/15min per IP
- **Uploads**: 30 uploads/hour per IP
- **Health**: No limits

## Authentication

Currently no authentication required. All endpoints are public.

---

## Endpoints

### `GET /health`
Service health status.

**Response**: `200 OK`
```json
{ "ok": true, "uptime": 12345.67 }
```

---

### `POST /artworks`
Upload artwork with multiple file variants.

**Content-Type**: `multipart/form-data`

**Required Files**:
- `original` - Original image (JPEG/PNG/WebP/AVIF/GIF, max 256MB)
- `protected` - Protected variant (same formats)
- `maskHi` - High-res mask (PNG only)
- `maskLo` - Low-res mask (PNG only)
- `analysis` - Analysis JSON document
- `summary` - Summary JSON document

**Optional Fields**:
- `title` (200 chars max)
- `artist` (120 chars max)
- `description` (2000 chars max)
- `tags` (25 tags max, 50 chars each)
- `createdAt` (ISO date string)
- `extra` (5000 chars max JSON)

**Success**: `201 Created`
```json
{
  "id": "60f7b3b3b3b3b3b3b3b3b3b3",
  "formats": {
    "original": {
      "contentType": "image/jpeg",
      "bytes": 1048576,
      "checksum": "sha256:abc123...",
      "fileId": "60f7b3b3b3b3b3b3b3b3b3b4"
    }
  }
}
```

**Errors**:
- `400` - Missing files, invalid types, malformed JSON
- `429` - Rate limit exceeded

---

### `GET /artworks/{id}`
Stream artwork file.

**Parameters**:
- `variant` (query) - `original|protected|mask_hi|mask_lo` (default: `original`)

**Response**: `200 OK`
- Binary file stream with proper MIME type
- Cache headers: `public, max-age=31536000, immutable`
- ETag: `{id}-{variant}`

**Errors**:
- `400` - Invalid ID format
- `404` - Artwork/variant not found

---

### `GET /artworks/{id}/metadata`
Complete artwork metadata.

**Response**: `200 OK`
```json
{
  "_id": "60f7b3b3b3b3b3b3b3b3b3b3",
  "title": "Artwork Title",
  "artist": "Artist Name",
  "description": "Description...",
  "tags": ["tag1", "tag2"],
  "createdAt": "2023-07-20T15:30:00Z",
  "uploadedAt": "2023-07-21T09:15:00Z",
  "formats": {
    "original": {
      "contentType": "image/jpeg",
      "bytes": 1048576,
      "checksum": "sha256:abc123...",
      "fileId": "60f7b3b3b3b3b3b3b3b3b3b4",
      "bucket": "originals"
    }
  },
  "analysis": { /* JSON payload */ },
  "summary": { /* JSON payload */ },
  "extra": { /* Additional metadata */ }
}
```

---

### `GET /artworks/{id}/variants`
Available variant information.

**Response**: `200 OK`
```json
{
  "id": "60f7b3b3b3b3b3b3b3b3b3b3",
  "title": "Artwork Title",
  "variants": {
    "original": {
      "available": true,
      "contentType": "image/jpeg",
      "size": 1048576,
      "checksum": "sha256:abc123...",
      "url": "/artworks/{id}?variant=original"
    }
  }
}
```

---

### `GET /artworks`
Search artworks.

**Query Parameters**:
- `artist` (120 chars max) - Filter by artist
- `q` (200 chars max) - Full-text search (title/description)
- `tags` - Comma-separated tags
- `limit` (1-10000, default: 20) - Results per page
- `skip` (0-5000, default: 0) - Pagination offset

**Response**: `200 OK`
```json
[
  {
    "_id": "60f7b3b3b3b3b3b3b3b3b3b3",
    "title": "Artwork Title",
    "artist": "Artist Name",
    "description": "Description...",
    "tags": ["tag1", "tag2"],
    "createdAt": "2023-07-20T15:30:00Z",
    "uploadedAt": "2023-07-21T09:15:00Z"
  }
]
```

---

### `GET /artworks/check-exists`
Check if artwork already exists.

**Query Parameters** (at least one required):
- `id` - 24-char hex string
- `checksum` - 64-char SHA256 hash
- `title` + `artist` - Combined search
- `tags` - Comma-separated tags

**Response**: `200 OK`
```json
{
  "exists": true,
  "matchCount": 1,
  "matches": [
    {
      "_id": "60f7b3b3b3b3b3b3b3b3b3b3",
      "title": "Artwork Title",
      "artist": "Artist Name",
      "checksum": "sha256:abc123...",
      "tags": ["tag1", "tag2"],
      "uploadedAt": "2023-07-21T09:15:00Z",
      "createdAt": "2023-07-20T15:30:00Z"
    }
  ]
}
```

---

### `POST /artworks/batch`
Retrieve multiple artworks by IDs.

**Request Body**:
```json
{
  "ids": ["60f7b3b3b3b3b3b3b3b3b3b3", "60f7b3b3b3b3b3b3b3b3b3b4"],
  "fields": "title,artist,tags"
}
```

- `ids` - Array of 1-100 artwork IDs
- `fields` (optional) - Comma-separated field list

**Response**: `200 OK`
```json
{
  "artworks": [
    {
      "_id": "60f7b3b3b3b3b3b3b3b3b3b3",
      "title": "Artwork Title",
      "artist": "Artist Name",
      "tags": ["tag1", "tag2"]
    }
  ]
}
```

---

### `GET /artworks/{id}/download`
Download artwork with attachment headers.

**Parameters**:
- `variant` (query) - File variant (default: `original`)

**Response**: `200 OK`
- Binary file stream
- `Content-Disposition: attachment; filename="title-variant.ext"`
- `Content-Type` and `Content-Length` headers

---

### `GET /artworks/{id}/download-url`
Generate temporary download URLs.

**Parameters**:
- `variant` (query) - File variant (default: `original`)
- `expires` (query) - Expiration seconds (60-86400, default: 3600)

**Response**: `200 OK`
```json
{
  "downloadUrl": "http://localhost:3000/artworks/{id}/download?variant=original",
  "directUrl": "http://localhost:3000/artworks/{id}?variant=original",
  "variant": "original",
  "contentType": "image/jpeg",
  "size": 1048576,
  "checksum": "sha256:abc123...",
  "expiresAt": "2023-07-21T10:15:00.000Z"
}
```

---

## Error Responses

All errors return JSON:
```json
{ "error": "Human-readable error message" }
```

**Status Codes**:
- `400` - Bad Request (validation errors, malformed data)
- `404` - Not Found (artwork/variant doesn't exist)
- `429` - Too Many Requests (rate limit exceeded)
- `500` - Internal Server Error

---

## Storage Architecture

**GridFS Buckets**:
- `artwork_originals` - Original images
- `artwork_protected` - Protected variants
- `artwork_masks` - High/low resolution masks

**Features**:
- 1MB chunk size
- SHA256 checksums for integrity
- Automatic compression (WiredTiger + zstd)

**Database Indexes**:
- `{ artist: 1, createdAt: -1 }` - Artist queries
- `{ tags: 1 }` - Tag filtering
- `{ title: "text", description: "text" }` - Full-text search

---

## File Format Support

**Images**: JPEG, PNG, WebP, AVIF, GIF
**Masks**: PNG only
**Metadata**: JSON only
**Max Size**: 256MB per file

---

## Security Features

- Rate limiting per IP
- Input validation (Zod schemas)
- Security headers (Helmet.js)
- Structured logging with header redaction
- File type validation
- Size limits enforcement

---

## Examples

### Upload Example
```bash
curl -X POST http://localhost:3000/artworks \
  -F "original=@image.jpg" \
  -F "protected=@protected.jpg" \
  -F "maskHi=@mask_hi.png" \
  -F "maskLo=@mask_lo.png" \
  -F "analysis=@analysis.json" \
  -F "summary=@summary.json" \
  -F "title=My Artwork" \
  -F "artist=Artist Name" \
  -F "tags=abstract,modern"
```

### Search Example
```bash
# Search by artist
curl "http://localhost:3000/artworks?artist=Picasso"

# Full-text search
curl "http://localhost:3000/artworks?q=landscape"

# Search by tags
curl "http://localhost:3000/artworks?tags=abstract,modern"

# Combined with pagination
curl "http://localhost:3000/artworks?artist=Picasso&limit=10&skip=20"
```

### Check Existence Example
```bash
# Check by checksum
curl "http://localhost:3000/artworks/check-exists?checksum=abc123..."

# Check by title and artist
curl "http://localhost:3000/artworks/check-exists?title=Mona Lisa&artist=Leonardo"
```