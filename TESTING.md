# Testing Guide

## Prerequisites

Before testing, ensure you have:
- Node.js 18+ installed
- MongoDB running (optional for duplicate detection)
- Redis running (optional for queue)

## Quick Start (Without Backend)

Since the processor backend is not available yet, you can test the router in two ways:

### 1. Validation Testing

Test the validation and normalization logic without connecting to external services.

#### Test Health Endpoint

```bash
npm run dev
```

In another terminal:

```bash
curl http://localhost:7000/health
```

Expected response:
```json
{
  "ok": true,
  "uptime": 12.345,
  "timestamp": "2024-01-01T12:00:00.000Z"
}
```

### 2. Mock Mode Testing

You can temporarily modify the code to bypass external dependencies for testing.

#### Test Multipart Upload (will fail at processor step)

```bash
curl -X POST http://localhost:7000/protect \
  -F "image=@test-image.jpg" \
  -F "artist_name=Test Artist" \
  -F "artwork_title=Test Artwork" \
  -F "tags=test,demo" \
  -F "include_hash_analysis=true"
```

Expected: Validation passes, but processor connection fails (503 error).

#### Test JSON Upload

```bash
curl -X POST http://localhost:7000/protect \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://example.com/test.jpg",
    "artist_name": "Test Artist",
    "artwork_title": "Test Artwork",
    "tags": ["test", "demo"]
  }'
```

#### Test Validation Errors

```bash
# Missing required field
curl -X POST http://localhost:7000/protect \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://example.com/test.jpg",
    "artist_name": "Test Artist"
  }'
```

Expected:
```json
{
  "error": "artwork_title: Required",
  "statusCode": 400
}
```

```bash
# Invalid processor name
curl -X POST http://localhost:7000/protect \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://example.com/test.jpg",
    "artist_name": "Test Artist",
    "artwork_title": "Test Artwork",
    "processors": ["invalid_processor"]
  }'
```

Expected:
```json
{
  "error": "Unknown processor: invalid_processor",
  "statusCode": 400
}
```

```bash
# Too many tags
curl -X POST http://localhost:7000/protect \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://example.com/test.jpg",
    "artist_name": "Test Artist",
    "artwork_title": "Test Artwork",
    "tags": ["tag1", "tag2", "tag3", "tag4", "tag5", "tag6", "tag7", "tag8", "tag9", "tag10", "tag11", "tag12", "tag13", "tag14", "tag15", "tag16", "tag17", "tag18", "tag19", "tag20", "tag21", "tag22", "tag23", "tag24", "tag25", "tag26"]
  }'
```

Expected:
```json
{
  "error": "Too many tags (max 25)",
  "statusCode": 400
}
```

## Full Integration Testing

Once the processor backend is running on port 8000:

### 1. Start Services

```bash
# Terminal 1: Start MongoDB
mongod

# Terminal 2: Start Redis
redis-server

# Terminal 3: Start Router
npm run dev
```

### 2. Test Complete Flow

```bash
# Upload with all options
curl -X POST http://localhost:7000/protect \
  -F "image=@test.jpg" \
  -F "artist_name=Jane Doe" \
  -F "artwork_title=Beautiful Landscape" \
  -F "artwork_description=A stunning landscape photograph" \
  -F "tags=landscape,nature,photography" \
  -F "include_hash_analysis=true" \
  -F "processors=metadata,imagehash,blockhash" \
  -F "include_protection=true" \
  -F "enable_fawkes=true" \
  -F "enable_photoguard=true" \
  -F "watermark_strategy=tree-ring" \
  -F "tree_ring_frequency=8.5" \
  -F "tree_ring_amplitude=16.0"
```

Expected response:
```json
{
  "job_id": "abc123def456",
  "status": "queued"
}
```

### 3. Test Duplicate Detection

Upload the same image twice:

```bash
# First upload
curl -X POST http://localhost:7000/protect \
  -F "image=@test.jpg" \
  -F "artist_name=Jane Doe" \
  -F "artwork_title=Beautiful Landscape"

# Second upload (should detect duplicate)
curl -X POST http://localhost:7000/protect \
  -F "image=@test.jpg" \
  -F "artist_name=Jane Doe" \
  -F "artwork_title=Beautiful Landscape"
```

Expected second response:
```json
{
  "job_id": "existing_id",
  "status": "exists",
  "message": "Artwork already exists",
  "artwork": {
    "_id": "existing_id",
    "title": "Beautiful Landscape",
    "artist": "Jane Doe"
  }
}
```

## Load Testing

Test concurrent uploads:

```bash
# Install Apache Bench (ab)
# On Ubuntu: sudo apt-get install apache2-utils
# On macOS: brew install ab

# Test with 100 concurrent requests
ab -n 1000 -c 100 -p test.json -T "application/json" http://localhost:7000/protect
```

Create `test.json`:
```json
{
  "image_url": "https://example.com/test.jpg",
  "artist_name": "Load Test",
  "artwork_title": "Test Artwork",
  "tags": ["test"]
}
```

Expected results:
- Requests per second: 500-1000+ (depending on hardware)
- No failed requests (assuming processor is available)
- Circuit breaker should trigger if processor is overloaded

## Environment Configuration for Testing

Create `.env` for testing:

```env
# Development settings
PORT=7000
NODE_ENV=development
WORKERS=1

# MongoDB (can be optional for basic testing)
MONGODB_URI=mongodb://localhost:27017/artorizer_test

# Redis (can be optional for basic testing)
REDIS_HOST=localhost
REDIS_PORT=6379

# Processor (will fail if not available - expected for now)
PROCESSOR_URL=http://localhost:8000
PROCESSOR_TIMEOUT=30000
```

## Monitoring During Testing

Watch logs in real-time:

```bash
npm run dev
```

The logs will show:
- Request validation
- Duplicate checks
- Processor submission attempts
- Errors with details

## Known Limitations (Until Backend is Available)

1. All requests will fail at processor submission step (503 or 502 error)
2. Duplicate detection requires MongoDB connection
3. Queue functionality requires Redis connection

These are expected behaviors until the processor backend is running.

## Next Steps

Once the processor backend is available:
1. Update `PROCESSOR_URL` in `.env`
2. Start MongoDB and Redis
3. Run full integration tests
4. Test complete end-to-end workflow
