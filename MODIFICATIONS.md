# Proposed Performance Modifications

This document outlines potential modifications to the data transfer protocol and architecture that could significantly improve processing speed and efficiency.

## Current Implementation

### Image Transfer
- **Protocol**: HTTP multipart/form-data
- **Flow**: Client → Router → Processor (full image retransmission)
- **Overhead**: ~30% encoding overhead for multipart boundaries
- **Latency**: Double network transfer (once to router, once to processor)

### Config Transfer
- **Protocol**: Form fields or JSON
- **Serialization**: String-based with manual parsing
- **Size**: ~1-2KB per request (text-heavy)

## Performance Issues Identified

### 1. Double Image Transfer
```
Current:
Client ----[10MB image]----> Router ----[10MB image]----> Processor
       (upload time: 2s)            (forward time: 2s)
Total: 4 seconds
```

### 2. Multipart Overhead
- Boundary markers add ~30% size
- Multiple memory copies during parsing
- Base64 encoding for binary data (33% size increase)

### 3. Synchronous Processing
- Router waits for processor response
- Blocks worker thread during upload
- No parallelization opportunity

## Proposed Modifications

### Option 1: Shared Storage with URL Passing (Recommended)

**Description**: Upload images directly to shared object storage, pass URL to processor

**Architecture**:
```
Client ----[image]----> S3/MinIO ----[presigned URL]----> Processor
                              ↑
                              └─── Router (metadata only)
```

**Implementation**:
```typescript
// Router receives image
const imageKey = await s3.upload(imageBuffer);
const presignedUrl = await s3.generatePresignedUrl(imageKey, 3600);

// Forward only URL + metadata to processor
await processor.submitJob({
  image_url: presignedUrl,
  ...metadata
});
```

**Benefits**:
- **50% faster**: Single upload instead of double transfer
- **Reduces router load**: No image forwarding
- **Scalable**: Decoupled storage from processing
- **Parallel processing**: Multiple processors can access same image

**Estimated Impact**: 2-4x faster for large images

**Requirements**:
- S3-compatible storage (MinIO, AWS S3, etc.)
- Presigned URL support
- Processor must support URL-based input

---

### Option 2: gRPC with Protocol Buffers

**Description**: Replace HTTP/JSON with binary protocol

**Architecture**:
```
Client ----[HTTP]----> Router ----[gRPC + Protobuf]----> Processor
```

**Protocol Definition** (`artorizer.proto`):
```protobuf
syntax = "proto3";

message ProtectRequest {
  bytes image_data = 1;
  string artist_name = 2;
  string artwork_title = 3;
  repeated string tags = 4;
  ProtectionConfig config = 5;
}

message ProtectionConfig {
  bool include_hash_analysis = 1;
  bool include_protection = 2;
  repeated string processors = 3;
  WatermarkConfig watermark = 4;
}

message ProtectResponse {
  string job_id = 1;
  string status = 2;
}
```

**Implementation**:
```typescript
import * as grpc from '@grpc/grpc-js';
import * as protoLoader from '@grpc/proto-loader';

// Router to Processor via gRPC
const client = new ProcessorClient('localhost:8000', credentials);
const response = await client.submitJob({
  image_data: imageBuffer,
  artist_name: 'Artist',
  artwork_title: 'Title',
  config: { ... }
});
```

**Benefits**:
- **5-10x faster serialization**: Binary vs JSON
- **Smaller payload**: ~40% size reduction
- **Type safety**: Generated types from proto files
- **Built-in streaming**: Efficient for large files
- **Bidirectional**: Support for progress updates

**Estimated Impact**: 3-5x faster serialization, 40% less bandwidth

**Requirements**:
- Processor must implement gRPC server
- Proto file coordination between services
- Additional dependency (@grpc/grpc-js)

---

### Option 3: Message Queue with Async Processing

**Description**: Decouple request/response with message queue

**Architecture**:
```
Client ----[POST]----> Router ----[Enqueue]----> Redis/RabbitMQ
                          ↓                            ↓
                    [202 Accepted]              Processor Worker
                                                       ↓
                                                   Database
```

**Implementation**:
```typescript
// Router
const jobId = generateId();
await queue.add('process-image', {
  jobId,
  imageUrl: s3Url,
  metadata: { ... }
});

// Return immediately
return { job_id: jobId, status: 'queued' };

// Processor Worker (separate process)
queue.process('process-image', async (job) => {
  const { imageUrl, metadata } = job.data;
  await processImage(imageUrl, metadata);
});
```

**Benefits**:
- **Instant response**: <10ms response time
- **High throughput**: 10,000+ req/s
- **Load leveling**: Queue absorbs traffic spikes
- **Retry logic**: Built-in failure handling
- **Priority queues**: VIP processing

**Estimated Impact**: 10x more concurrent requests, <10ms API response

**Requirements**:
- Message queue (Redis/RabbitMQ)
- Async architecture
- Polling mechanism for status checks

---

### Option 4: WebSocket Streaming

**Description**: Bidirectional streaming for real-time updates

**Architecture**:
```
Client <----[WebSocket]----> Router <----[WebSocket]----> Processor
       (upload + progress)            (forward + status)
```

**Implementation**:
```typescript
// Client to Router
const ws = new WebSocket('ws://localhost:7000/protect');
ws.send(imageChunk1);
ws.send(imageChunk2);
ws.send(metadata);

// Router to Processor
const processorWs = new WebSocket('ws://localhost:8000/v1/jobs');
processorWs.on('message', (progress) => {
  // Forward progress to client
  ws.send(progress);
});
```

**Benefits**:
- **Real-time updates**: Progress tracking
- **Chunked transfer**: Resume interrupted uploads
- **Lower latency**: No HTTP overhead
- **Persistent connection**: Reduced handshakes

**Estimated Impact**: 30% faster for large files, real-time progress

**Requirements**:
- WebSocket support in processor
- Client-side WebSocket implementation
- Connection management complexity

---

## Comparison Matrix

| Modification | Speed Gain | Bandwidth Reduction | Complexity | Implementation Time |
|--------------|------------|---------------------|------------|---------------------|
| Shared Storage (S3) | 2-4x | 50% | Low | 2-3 days |
| gRPC + Protobuf | 3-5x | 40% | Medium | 4-5 days |
| Message Queue | 10x throughput | 0% | Medium | 3-4 days |
| WebSocket | 1.3x | 10% | High | 5-7 days |

## Recommended Implementation Path

### Phase 1: Shared Storage (Quick Win)
**Timeline**: 2-3 days
**Impact**: 2-4x faster, immediate benefits

1. Add MinIO/S3 dependency
2. Implement upload to storage
3. Generate presigned URLs
4. Update processor to accept URLs
5. Keep current flow as fallback

### Phase 2: Message Queue (Scalability)
**Timeline**: 3-4 days
**Impact**: 10x throughput, async processing

1. Already have Bull queue setup
2. Implement job processor workers
3. Add status polling endpoint
4. Migrate from sync to async

### Phase 3: gRPC (Optimization)
**Timeline**: 4-5 days
**Impact**: 3-5x faster serialization

1. Define proto schemas
2. Implement gRPC server in processor
3. Update router to use gRPC client
4. Benchmark improvements

## Code Changes Required

### For Shared Storage (S3)

**Router Changes** (minimal):
```typescript
// Add to package.json
"@aws-sdk/client-s3": "^3.x"
"@aws-sdk/s3-request-presigner": "^3.x"

// New service: src/services/storage.service.ts
export class StorageService {
  async uploadImage(buffer: Buffer, filename: string): Promise<string> {
    const key = `uploads/${Date.now()}-${filename}`;
    await s3.upload({ Bucket, Key: key, Body: buffer });
    return await generatePresignedUrl(key);
  }
}

// Update protect route
const imageUrl = await storageService.uploadImage(imageBuffer, filename);
await processor.submitJobJSON({
  image_url: imageUrl,
  ...metadata
});
```

**Processor Changes** (none if already supports image_url):
- Already accepts `image_url` parameter
- No changes needed

### For gRPC

**Router Changes** (moderate):
```typescript
// Add to package.json
"@grpc/grpc-js": "^1.x"
"@grpc/proto-loader": "^0.7.x"

// New file: proto/artorizer.proto
// New service: src/services/grpc-processor.service.ts
// Update protect route to use gRPC client
```

**Processor Changes** (significant):
- Implement gRPC server
- Create proto definitions
- Add gRPC handlers

## Benchmarks (Estimated)

### Current Performance
```
Small image (1MB):   200ms total (100ms upload + 100ms forward)
Medium image (10MB): 2000ms total (1000ms upload + 1000ms forward)
Large image (50MB):  10000ms total (5000ms upload + 5000ms forward)
```

### With Shared Storage
```
Small image (1MB):   100ms total (100ms upload, 0ms forward)
Medium image (10MB): 1000ms total (1000ms upload, 0ms forward)
Large image (50MB):  5000ms total (5000ms upload, 0ms forward)

Improvement: 50% faster
```

### With gRPC
```
Small image (1MB):   150ms total (60ms upload + 30ms forward + 60ms processing)
Medium image (10MB): 1200ms total (600ms upload + 200ms forward + 400ms processing)
Large image (50MB):  6000ms total (3000ms upload + 1000ms forward + 2000ms processing)

Improvement: 40% faster
```

### With Message Queue (Async)
```
API Response: <10ms (immediate)
Background processing: same as current
Throughput: 10,000 req/s vs 1,000 req/s

Improvement: 10x more requests handled
```

## Conclusion

**Immediate Action**: Implement Shared Storage (Option 1)
- Fastest ROI
- Minimal complexity
- Compatible with current architecture
- 2-4x speed improvement

**Long-term**: Combine Shared Storage + Message Queue + gRPC
- Best of all worlds
- Handles massive scale
- Real-time processing
- 10x throughput improvement

All modifications maintain backward compatibility during transition period.
