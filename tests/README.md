# Integration Tests

This directory contains integration tests for the Artorizer Core Router.

## Test Structure

- `integration/router.test.ts` - End-to-end integration tests including:
  - Image upload via POST /protect
  - Duplicate detection
  - Job status polling
  - Protected image download
  - Complete upload-to-download workflow

## Requirements

The router depends on external services that must be running for integration tests:

### Required Services

1. **Backend API** (default: `http://localhost:5001`)
   - Handles artwork storage (MongoDB + GridFS)
   - Provides duplicate detection
   - Generates download tokens

2. **Processor Core** (default: `http://localhost:8765`)
   - Processes images (watermarking, hashing, etc.)
   - Uploads results to Backend API
   - Sends callbacks to Router

3. **Redis** (default: `localhost:6379`)
   - Job state tracking
   - Bull queue (prepared for future async processing)

### Environment Configuration

Configure service URLs in `.env`:

```bash
# Backend API
BACKEND_URL=http://localhost:5001

# Processor API
PROCESSOR_URL=http://localhost:8765

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379
```

## Running Tests

### Against Local Services

1. Start all required services:
   ```bash
   # Start Backend API
   cd ../artorizer-backend
   npm run dev

   # Start Processor Core
   cd ../artorizer-processor
   python -m uvicorn main:app --port 8765

   # Redis (should already be running)
   redis-server
   ```

2. Start the Router:
   ```bash
   npm run dev
   ```

3. Run tests:
   ```bash
   # Against local router (port 7001)
   ROUTER_URL=http://localhost:7001 npm test

   # Watch mode
   ROUTER_URL=http://localhost:7001 npm run test:watch

   # With UI
   ROUTER_URL=http://localhost:7001 npm run test:ui
   ```

### Against Production

```bash
# Uses production URL (https://router.artorizer.com) by default
npm test
```

## Test Features

### E2E Test: Upload, Process, Download

The main end-to-end test (`tests/integration/router.test.ts:230-355`) performs:

1. **Upload** - POST multipart image with metadata
2. **Poll** - Check job status every 3 seconds (max 2 minutes)
3. **Fetch Result** - Get complete job data with URLs
4. **Download** - Fetch protected image and mask
5. **Verify** - Validate images using Sharp (format, dimensions)
6. **Save** - Store test results in `output/` directory

### Test Artifacts

Downloaded images are saved to `output/`:
- `e2e_protected_[timestamp].jpg` - Protected/watermarked image
- `e2e_mask_[timestamp].jpg` - Mask used for watermarking

## Current Test Results

When all services are running:
- ✅ Image upload and job creation
- ✅ Duplicate detection
- ✅ Job status polling
- ✅ Protected image download
- ✅ Mask download
- ✅ Image validation

When services are unavailable:
- ❌ 500 errors (ECONNREFUSED to backend/processor)
- ⚠️  Tests will fail but framework is working correctly

## Troubleshooting

### "Internal server error" (500)

**Cause**: Backend API or Processor not running

**Solution**: Start all required services (see above)

### "Connection refused" in router logs

**Cause**: Cannot connect to backend/processor

**Check**:
```bash
# Backend
curl http://localhost:5001/health

# Processor
curl http://localhost:8765/health

# Redis
redis-cli ping
```

### Tests timeout

**Cause**: Processing takes longer than expected

**Solution**: Increase timeout in test or check processor logs

### Blob constructor error

**Fixed**: Using Node.js native Blob from `buffer` module
