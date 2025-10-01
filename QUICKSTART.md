# Quick Start Guide

## Install & Run (30 seconds)

```bash
# 1. Install dependencies
npm install

# 2. Copy environment config
cp .env.example .env

# 3. Start development server
npm run dev
```

Server starts on `http://localhost:7000`

## Test It Works

```bash
# Health check
curl http://localhost:7000/health
```

## Basic Usage

### Upload Image

```bash
curl -X POST http://localhost:7000/protect \
  -F "image=@yourimage.jpg" \
  -F "artist_name=Your Name" \
  -F "artwork_title=Your Title"
```

### Remote Image (URL)

```bash
curl -X POST http://localhost:7000/protect \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://example.com/image.jpg",
    "artist_name": "Your Name",
    "artwork_title": "Your Title"
  }'
```

## Common Options

```bash
# With tags
-F "tags=nature,landscape,photo"

# Choose processors
-F "processors=metadata,imagehash,blockhash"

# Watermark settings
-F "watermark_strategy=tree-ring"
-F "tree_ring_frequency=9.0"

# Protection layers
-F "enable_fawkes=true"
-F "enable_nightshade=false"
```

## Response

**Success (202)**:
```json
{
  "job_id": "abc123",
  "status": "queued"
}
```

**Duplicate Found (200)**:
```json
{
  "job_id": "existing_id",
  "status": "exists",
  "message": "Artwork already exists"
}
```

**Validation Error (400)**:
```json
{
  "error": "artist_name is required",
  "statusCode": 400
}
```

## What's Next?

- Read [README.md](README.md) for full API documentation
- Check [ARCHITECTURE.md](ARCHITECTURE.md) for system design
- See [TESTING.md](TESTING.md) for testing strategies

## Need Help?

Check logs for detailed error messages:
```bash
npm run dev
# Logs show real-time request processing
```

## Production Build

```bash
npm run build
npm start
```
