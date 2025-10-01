# Backend Storage Modifications for Hash-Based Similarity Search

## Overview
The backend storage service needs to support perceptual hash-based image similarity search. This requires storing image hashes, creating appropriate indexes, and implementing efficient similarity comparison algorithms.

## Required API Modifications

### 1. New Endpoint: Find Similar Images by Hashes
**Endpoint**: `POST /artworks/find-similar`

**Purpose**: Find artworks with similar perceptual hashes

**Request**:
```http
POST /artworks/find-similar
Content-Type: application/json
```

```json
{
  "hashes": {
    "perceptual_hash": "0xfedcba0987654321",
    "average_hash": "0x1234567890abcdef",
    "difference_hash": "0xabcdef1234567890",
    "wavelet_hash": "0x9876543210fedcba",
    "color_hash": "0x1122334455667788",
    "blockhash8": "0xaabbccddee112233",
    "blockhash16": "0x1234567890abcdef1234567890abcdef"
  },
  "threshold": 0.85,
  "limit": 10,
  "hash_weights": {
    "perceptual_hash": 1.0,
    "average_hash": 0.8,
    "difference_hash": 0.6,
    "wavelet_hash": 0.5,
    "color_hash": 0.3,
    "blockhash8": 0.4,
    "blockhash16": 0.7
  }
}
```

**Parameters**:
- `hashes` (object, required): Hash values to search for
  - At least one hash type must be provided
  - All hash values must be hex strings with `0x` prefix
- `threshold` (float, optional, default: 0.85): Similarity threshold (0.0-1.0)
- `limit` (int, optional, default: 10, max: 100): Maximum results to return
- `hash_weights` (object, optional): Weight for each hash type in similarity score calculation
  - Defaults: pHash=1.0, aHash=0.8, dHash=0.6, wHash=0.5, colorHash=0.3

**Response (200)**:
```json
{
  "matches": [
    {
      "_id": "60f7b3b3b3b3b3b3b3b3b3b3",
      "title": "Similar Artwork 1",
      "artist": "Artist Name",
      "tags": ["abstract", "modern"],
      "similarity_score": 0.95,
      "hash_distances": {
        "perceptual_hash": 2,
        "average_hash": 5,
        "difference_hash": 3
      },
      "hash_similarities": {
        "perceptual_hash": 0.98,
        "average_hash": 0.92,
        "difference_hash": 0.94
      },
      "thumbnail_url": "/artworks/60f7b3b3b3b3b3b3b3b3b3b3?variant=protected",
      "uploaded_at": "2023-07-21T09:15:00Z",
      "created_at": "2023-07-20T15:30:00Z"
    }
  ],
  "total_matches": 5,
  "search_params": {
    "threshold": 0.85,
    "limit": 10,
    "hash_types_used": ["perceptual_hash", "average_hash", "difference_hash"]
  }
}
```

**Error Responses**:
- `400` - Invalid hash format or parameters
- `429` - Rate limit exceeded

### 2. Bulk Hash Lookup Endpoint
**Endpoint**: `POST /artworks/batch-hash-lookup`

**Purpose**: Check multiple hashes at once (for batch processing)

**Request**:
```json
{
  "queries": [
    {
      "id": "query_1",
      "hashes": {
        "perceptual_hash": "0xfedcba0987654321"
      }
    },
    {
      "id": "query_2",
      "hashes": {
        "perceptual_hash": "0x1234567890abcdef"
      }
    }
  ],
  "threshold": 0.90,
  "limit": 5
}
```

**Response (200)**:
```json
{
  "results": [
    {
      "query_id": "query_1",
      "matches": [ /* array of matches */ ],
      "match_count": 3
    },
    {
      "query_id": "query_2",
      "matches": [],
      "match_count": 0
    }
  ]
}
```

## Database Schema Modifications

### 1. Artwork Collection - Add Hashes Field
**Collection**: `artworks`

**New Field Structure**:
```json
{
  "_id": "60f7b3b3b3b3b3b3b3b3b3b3",
  "title": "Artwork Title",
  "artist": "Artist Name",
  // ... existing fields ...
  "hashes": {
    "perceptual_hash": "0xfedcba0987654321",
    "perceptual_hash_int": 18364758544493064481,
    "average_hash": "0x1234567890abcdef",
    "average_hash_int": 1311768467463790319,
    "difference_hash": "0xabcdef1234567890",
    "difference_hash_int": 12379813738877118608,
    "wavelet_hash": "0x9876543210fedcba",
    "wavelet_hash_int": 10984593091250795450,
    "color_hash": "0x1122334455667788",
    "color_hash_int": 1234605616436508552,
    "blockhash8": "0xaabbccddee112233",
    "blockhash8_int": 12302652060662309427,
    "blockhash16": "0x1234567890abcdef1234567890abcdef",
    "blockhash16_int": 24197857203266734864629346421695
  },
  "hash_metadata": {
    "computed_at": "2023-07-21T09:15:00Z",
    "algorithm_versions": {
      "imagehash": "4.3.1"
    }
  }
}
```

**Notes**:
- Store both hex string and integer representations for efficient comparison
- Integer format enables bitwise operations for Hamming distance calculation
- Hash metadata tracks when and how hashes were computed

### 2. Database Indexes

**Required Indexes**:
```javascript
// MongoDB index creation
db.artworks.createIndex({ "hashes.perceptual_hash_int": 1 })
db.artworks.createIndex({ "hashes.average_hash_int": 1 })
db.artworks.createIndex({ "hashes.difference_hash_int": 1 })
db.artworks.createIndex({ "hashes.wavelet_hash_int": 1 })
db.artworks.createIndex({ "hashes.color_hash_int": 1 })
db.artworks.createIndex({ "hashes.blockhash8_int": 1 })
db.artworks.createIndex({ "hashes.blockhash16_int": 1 })

// Compound index for multi-hash queries
db.artworks.createIndex({
  "hashes.perceptual_hash_int": 1,
  "hashes.average_hash_int": 1
})

// Index for timestamp-based sorting
db.artworks.createIndex({
  "hashes.perceptual_hash_int": 1,
  "uploadedAt": -1
})
```

**Index Strategy**:
- Single-field indexes for individual hash lookups
- Compound indexes for common multi-hash queries
- Consider partial indexes if not all artworks have hashes

## Implementation Requirements

### 1. Hash Storage Module
**File**: `src/services/hash-storage.service.ts` (new)

**Responsibilities**:
- Store and retrieve hash values
- Validate hash formats
- Convert between hex and integer representations
- Update hash metadata

**Key Methods**:
```typescript
class HashStorageService {
  async storeHashes(artworkId: string, hashes: HashSet): Promise<void>
  async getHashesByArtworkId(artworkId: string): Promise<HashSet | null>
  async updateHashes(artworkId: string, hashes: Partial<HashSet>): Promise<void>
}
```

### 2. Similarity Search Engine
**File**: `src/services/similarity-search.service.ts` (new)

**Responsibilities**:
- Implement Hamming distance calculation
- Calculate weighted similarity scores
- Perform efficient database queries
- Rank and filter results

**Key Methods**:
```typescript
class SimilaritySearchService {
  async findSimilarByHashes(
    queryHashes: HashSet,
    options: SearchOptions
  ): Promise<SimilarityResult[]>

  private calculateHammingDistance(hash1: bigint, hash2: bigint): number
  private calculateSimilarityScore(distances: HashDistances, weights: HashWeights): number
  private rankResults(results: SimilarityResult[]): SimilarityResult[]
}
```

**Similarity Algorithm**:
```typescript
// Hamming distance calculation (bit difference count)
function hammingDistance(hash1: bigint, hash2: bigint): number {
  let xor = hash1 ^ hash2
  let distance = 0
  while (xor > 0n) {
    distance += Number(xor & 1n)
    xor >>= 1n
  }
  return distance
}

// Convert Hamming distance to similarity score (0.0 - 1.0)
function distanceToSimilarity(distance: number, hashBitLength: number): number {
  return 1.0 - (distance / hashBitLength)
}

// Weighted average of multiple hash similarities
function calculateWeightedSimilarity(
  similarities: Record<string, number>,
  weights: Record<string, number>
): number {
  let totalWeight = 0
  let weightedSum = 0

  for (const [hashType, similarity] of Object.entries(similarities)) {
    const weight = weights[hashType] || 0
    weightedSum += similarity * weight
    totalWeight += weight
  }

  return totalWeight > 0 ? weightedSum / totalWeight : 0
}
```

### 3. Upload Flow Modification
**File**: `src/routes/artworks.ts`

**Change**: Modify `POST /artworks` to accept and store hashes

**Updated Request**:
```typescript
// Accept hashes in the upload request
interface UploadRequest {
  // ... existing fields ...
  hashes?: {
    perceptual_hash?: string
    average_hash?: string
    difference_hash?: string
    // ... other hash types
  }
}
```

**Processing Flow**:
1. Validate hash format (hex strings with 0x prefix)
2. Convert hex to integer representation
3. Store both formats in artwork document
4. Add hash_metadata with timestamp

### 4. Configuration Updates
**File**: `src/config.ts`

**New Configuration**:
```typescript
export const config = {
  // ... existing config ...
  similarity: {
    defaultThreshold: parseFloat(process.env.SIMILARITY_THRESHOLD || '0.85'),
    defaultLimit: parseInt(process.env.SIMILARITY_LIMIT || '10'),
    maxLimit: parseInt(process.env.SIMILARITY_MAX_LIMIT || '100'),
    defaultHashWeights: {
      perceptual_hash: 1.0,
      average_hash: 0.8,
      difference_hash: 0.6,
      wavelet_hash: 0.5,
      color_hash: 0.3,
      blockhash8: 0.4,
      blockhash16: 0.7,
    },
  },
}
```

### 5. Rate Limiting
**File**: `src/middleware/rate-limit.ts`

**New Limits**:
```typescript
// Similarity search is computationally expensive
const similaritySearchLimiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // 100 requests per window
  message: 'Too many similarity search requests',
})
```

## Performance Optimization

### 1. Query Optimization Strategy
**Approach**: Progressive filtering

```typescript
// Step 1: Find candidates with low Hamming distance (fast index scan)
// MongoDB cannot natively do Hamming distance, so use range queries
// This is an approximation - get artworks with similar hash values

// Step 2: Calculate exact Hamming distance in application code
// Step 3: Filter by threshold
// Step 4: Calculate weighted similarity scores
// Step 5: Sort and limit results
```

### 2. Caching Strategy
**Cache Layer**: Redis

**What to Cache**:
- Frequently queried hash combinations (5-minute TTL)
- Popular artworks' hash values (1-hour TTL)
- Pre-computed similarity scores for common patterns

```typescript
// Cache key format
const cacheKey = `similarity:${hashType}:${hashValue}:${threshold}`
```

### 3. Database Query Optimization

**Efficient Query Pattern**:
```typescript
// For perceptual hash similarity search
// Step 1: Use index to find candidates (approximate)
const candidates = await db.collection('artworks').find({
  'hashes.perceptual_hash_int': {
    // This doesn't directly support Hamming distance,
    // but we can fetch all records and compute in-memory
    // OR use aggregation pipeline with custom expressions
    $exists: true
  }
}).limit(1000).toArray()

// Step 2: Calculate Hamming distance in application
const results = candidates
  .map(artwork => ({
    artwork,
    distance: hammingDistance(queryHash, artwork.hashes.perceptual_hash_int),
  }))
  .filter(result => {
    const similarity = distanceToSimilarity(result.distance, 64)
    return similarity >= threshold
  })
  .sort((a, b) => a.distance - b.distance)
  .slice(0, limit)
```

### 4. Alternative: Specialized Database
**Consideration**: For large-scale similarity search, consider:
- **Milvus**: Vector similarity search database
- **Elasticsearch**: With perceptual hash plugin
- **PostgreSQL**: With bit string operations

**Trade-offs**:
- MongoDB: Simple, already in use, but limited bit operations
- Specialized DB: Better performance, but adds complexity

## Testing Requirements

### 1. Unit Tests
- Hash format validation
- Hamming distance calculation accuracy
- Similarity score calculation
- Weighted average computation

### 2. Integration Tests
- End-to-end similarity search flow
- Multi-hash query correctness
- Threshold filtering accuracy
- Result ranking correctness

### 3. Performance Tests
- Query performance with 10K+ artworks
- Concurrent search request handling
- Cache hit/miss ratios
- Index utilization verification

## Migration Strategy

### 1. Backward Compatibility
**Approach**: Hashes are optional

- Existing artworks without hashes remain queryable by other fields
- New uploads can include hashes
- Batch backfill script for existing artworks (run processor on stored images)

### 2. Data Migration Script
**File**: `scripts/backfill-hashes.ts`

```typescript
// Pseudo-code for backfill script
async function backfillHashes() {
  const artworks = await db.collection('artworks')
    .find({ 'hashes': { $exists: false } })
    .toArray()

  for (const artwork of artworks) {
    // Call processor to compute hashes
    const hashes = await processorClient.extractHashes(artwork._id)

    // Update artwork with hashes
    await db.collection('artworks').updateOne(
      { _id: artwork._id },
      {
        $set: {
          hashes: hashes,
          hash_metadata: { computed_at: new Date() }
        }
      }
    )
  }
}
```

### 3. Deployment Steps
1. Deploy schema changes (add optional `hashes` field)
2. Create database indexes
3. Deploy new API endpoints
4. Update processor to send hashes on upload
5. Run backfill script for existing artworks (optional, can be gradual)

## Environment Variables

```env
# Similarity Search Configuration
SIMILARITY_THRESHOLD=0.85
SIMILARITY_LIMIT=10
SIMILARITY_MAX_LIMIT=100

# Hash Computation
HASH_ALGORITHM_VERSION=4.3.1

# Performance
SIMILARITY_CACHE_TTL=300
SIMILARITY_MAX_CANDIDATES=1000
```

## API Documentation Updates

### Update OpenAPI/Swagger Spec
- Add `/artworks/find-similar` endpoint documentation
- Add hash schema definitions
- Update `POST /artworks` to include optional hash fields
- Add examples for similarity search requests

## Security Considerations

1. **Rate Limiting**: Similarity search is expensive - strict rate limits required
2. **Input Validation**: Validate all hash formats to prevent injection attacks
3. **Result Size Limits**: Cap maximum result size to prevent DoS
4. **Query Complexity**: Monitor and limit concurrent similarity searches

## Future Enhancements

1. **Multi-modal Search**: Combine hash similarity with text/tag matching
2. **Clustering**: Pre-compute artwork clusters for faster lookup
3. **Approximate Nearest Neighbor (ANN)**: Use LSH or other ANN algorithms
4. **GPU Acceleration**: Offload Hamming distance calculation to GPU
5. **Real-time Updates**: Invalidate cache when new artworks uploaded
