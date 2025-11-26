# Artorizer Core Router

High-performance ingress API for the Artorizer image protection pipeline. Routes client requests, validates metadata, checks for duplicates, and forwards jobs to the processor core.

## Authentication (Better Auth via Storage Backend)

**Overview:**
- Router is the only public ingress; it proxies all `/auth/*` calls to the storage backend where Better Auth (Mongo) runs.
- Supported authentication flows: email + username + password, Google OAuth, GitHub OAuth.
- Session-based authentication via httpOnly cookies (`better-auth.session_token`)

**Authentication Status:**
- **When AUTH_ENABLED=false (default):** All endpoints accept anonymous requests. User context is optional.
- **When AUTH_ENABLED=true:** Authentication endpoints are available (`/auth/*`). Some endpoints may require authentication.

**Key Features:**
- Stateless router design - validates sessions by calling backend API
- Caches one `/auth/me` per request and forwards `X-User-Id`, `X-User-Email`, `X-User-Name` headers to backend
- Session cookie name: `better-auth.session_token` (HttpOnly, Secure in prod, SameSite=Lax)
- Session duration: 7 days with 1-day refresh window
- User context automatically forwarded to backend for user-associated operations

## Architecture

```
Client → Router → Processor → Backend
          ↓                       ↑
     Check for            Upload artwork
     duplicates           (with token)
```

**Workflow:**
1. Client submits artwork → Router validates and checks for duplicates
2. If duplicate → return existing artwork (200 OK)
3. If new → Router generates auth token and submits to Processor (202 Accepted)
4. Processor processes image → uploads directly to Backend (using token)
5. Processor sends callback to Router with Backend artwork ID
6. Client polls Router for status → downloads results when complete

## Features

- **High Performance**: Fastify-based with clustering (1000+ req/s)
- **Optional Authentication**: Better Auth with OAuth (Google, GitHub) for user management
- **User Context Forwarding**: Automatic user header forwarding to backend for access control
- **Secure Pipeline**: Token-based authentication for processor uploads
- **Smart Deduplication**: Backend API integration prevents duplicate processing
- **Circuit Breaker**: Automatic failover when processor unavailable
- **Streaming Uploads**: Memory-efficient handling up to 256MB
- **Full Validation**: Zod schemas with comprehensive error messages

---

## Quick Start

### Automated Deployment (Debian/Ubuntu)

Deploy the entire stack with a single command:

```bash
curl -fsSL https://raw.githubusercontent.com/Artorize/Artorizer-core-router/master/deploy.sh | sudo bash
```

This script installs Node.js, Redis, Nginx, configures systemd, and starts the service.

**Post-deployment:** Edit `/opt/artorizer-router/shared/.env` with your configuration, then restart:
```bash
sudo systemctl restart artoize-router
```

See **[DEPLOYMENT.md](DEPLOYMENT.md)** for complete deployment guide.

---

### Manual Installation

#### Prerequisites

- Node.js 18+
- Redis (for job tracking)
- Backend API running (for storage)
- Processor Core running (for image processing)

#### Install

```bash
npm install
cp .env.example .env
# Edit .env with your configuration
npm run build
npm start
```

#### Development

```bash
npm run dev
```

---

## Basic Usage

### Submit Artwork for Protection

**Authentication:** Optional - but recommended for tracking artwork ownership and managing uploads.

When authentication is enabled and a user is authenticated:
- Artwork is associated with the authenticated user
- User can retrieve their artworks via `GET /artworks/me` (backend endpoint)
- User context is forwarded to the backend for access control

**Anonymous Upload (no authentication):**
```bash
curl -X POST http://localhost:7000/protect \
  -F "image=@artwork.jpg" \
  -F "artist_name=Jane Doe" \
  -F "artwork_title=Forest Scene" \
  -F "tags=nature,forest" \
  -F "watermark_strategy=tree-ring"
```

**Authenticated Upload (with session cookie):**
```bash
curl -X POST http://localhost:7000/protect \
  --cookie "better-auth.session_token=your_session_token" \
  -F "image=@artwork.jpg" \
  -F "artist_name=Jane Doe" \
  -F "artwork_title=Forest Scene" \
  -F "tags=nature,forest" \
  -F "watermark_strategy=tree-ring"
```

**Response (202 Accepted):**
```json
{
  "job_id": "f2dc197c-43b9-404d-b3f3-159282802609",
  "status": "processing",
  "message": "Job queued for processing. Results will be available via callback."
}
```

**Response (200 OK - duplicate found):**
```json
{
  "job_id": "60f7b3b3b3b3b3b3b3b3b3b3",
  "status": "exists",
  "message": "Artwork already exists",
  "artwork": { /* existing artwork details */ }
}
```

### Check Job Status

```bash
curl http://localhost:7000/jobs/f2dc197c-43b9-404d-b3f3-159282802609
```

### Get Complete Result with URLs

```bash
curl http://localhost:7000/jobs/f2dc197c-43b9-404d-b3f3-159282802609/result
```

### Download Protected Image

```bash
curl http://localhost:7000/jobs/f2dc197c-43b9-404d-b3f3-159282802609/download/protected -o protected.jpg
```

---

## Authentication Guide

### Enable Authentication

To enable authentication, set the following environment variables:

```env
# Enable authentication
AUTH_ENABLED=true

# Backend service URL (handles all auth operations)
BACKEND_URL=https://backend.artorizer.com

# Allowed origins for CORS (required with AUTH_ENABLED=true)
ALLOWED_ORIGINS=https://artorizer.com,http://localhost:8080
```

### Authentication Endpoints

When `AUTH_ENABLED=true`, the following endpoints are available via the router (proxied to backend):

#### Sign In with Google
```bash
# Redirect user to this URL
https://router.artorizer.com/auth/signin/google

# Backend processes OAuth, sets session cookie, redirects to redirect_url param
```

#### Sign In with GitHub
```bash
# Redirect user to this URL
https://router.artorizer.com/auth/signin/github

# Backend processes OAuth, sets session cookie, redirects to redirect_url param
```

#### Get Current Session
```bash
curl -X GET https://router.artorizer.com/auth/session \
  --cookie "better-auth.session_token=your_token"

# Response:
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "image": "https://...",
    "emailVerified": true,
    "createdAt": "2024-01-15T10:30:00Z"
  },
  "session": {
    "token": "...",
    "expiresAt": "2024-01-22T10:30:00Z"
  }
}
```

#### Sign Out
```bash
curl -X POST https://router.artorizer.com/auth/sign-out \
  --cookie "better-auth.session_token=your_token"

# Response: Clears session cookie and logs out user
```

### Using Authentication in API Requests

Once authenticated, include the session cookie in your requests:

```bash
# Example: Get authenticated user's artworks
curl -X GET https://router.artorizer.com/artworks/me \
  --cookie "better-auth.session_token=your_token"

# Example: Submit artwork as authenticated user
curl -X POST https://router.artorizer.com/protect \
  --cookie "better-auth.session_token=your_token" \
  -F "image=@artwork.jpg" \
  -F "artist_name=Jane Doe" \
  -F "artwork_title=Forest Scene"
```

### Authenticating from JavaScript

```javascript
// Sign in with Google (from browser)
const response = await fetch('https://router.artorizer.com/auth/signin/google', {
  method: 'GET',
  credentials: 'include', // Important: Include cookies
});
// Browser will redirect and set session cookie

// Get current session
const session = await fetch('https://router.artorizer.com/auth/session', {
  credentials: 'include', // Include session cookie
});
const data = await session.json();
console.log('Authenticated as:', data.user.email);

// Submit artwork as authenticated user
const formData = new FormData();
formData.append('image', imageFile);
formData.append('artist_name', 'Jane Doe');
formData.append('artwork_title', 'Forest Scene');

const upload = await fetch('https://router.artorizer.com/protect', {
  method: 'POST',
  credentials: 'include', // Include session cookie
  body: formData,
});
const result = await upload.json();
console.log('Job ID:', result.job_id);
```

### User Context Forwarding

When a user is authenticated, the router automatically forwards user context to the backend with these headers:

- **X-User-Id**: User's unique identifier (UUID)
- **X-User-Email**: User's email address
- **X-User-Name**: User's display name

The backend uses these headers to:
- Associate artworks with specific users
- Implement user-based access control
- Track user activity and ownership
- Enable user-specific queries (e.g., `GET /artworks/me`)

### Complete Authentication Setup

For complete authentication setup instructions including:
- OAuth provider configuration (Google, GitHub)
- MongoDB schema setup
- Backend configuration
- Troubleshooting

See: **[AUTH_README.md](AUTH_README.md)**

---

## Health Checks

### Comprehensive Health Check

```bash
curl http://localhost:7000/health
```

Returns status of all dependent services (processor, backend, redis).

### Liveness Probe (Kubernetes/Docker)

```bash
curl http://localhost:7000/health/live
```

### Readiness Probe

```bash
curl http://localhost:7000/health/ready
```

---

## Documentation

### API References

- **[Router API](docs/ROUTER-API.md)** - Complete router endpoint documentation
- **[Backend API](docs/BACKEND-API.md)** - Backend storage API reference
- **[Processor API](docs/PROCESSOR-API.md)** - Processor core API reference

### Guides

- **[Deployment Guide](DEPLOYMENT.md)** - Production deployment with systemd, nginx, SSL
- **[Authentication Setup](AUTH_README.md)** - Better Auth configuration and OAuth setup
- **[Project Instructions](CLAUDE.md)** - Architecture overview and development guidelines
- **[Test Documentation](tests/README.md)** - Integration testing guide

### Technical Specs

- **[Poison Mask Protocol](docs/poison-mask-grayscale-protocol.md)** - Grayscale mask encoding specification

---

## Configuration

All configuration via environment variables. See `.env.example` for all options.

**Key settings:**

```env
# Server
PORT=7000
NODE_ENV=production
WORKERS=4

# Authentication (Optional - Better Auth)
AUTH_ENABLED=false
BETTER_AUTH_SECRET=your-secret-here  # Generate with: openssl rand -base64 32
BETTER_AUTH_URL=https://router.artorizer.com
ALLOWED_ORIGINS=https://artorizer.com,http://localhost:8080

# PostgreSQL (Required if AUTH_ENABLED=true)
DB_HOST=localhost
DB_PORT=5432
DB_USER=artorizer
DB_PASSWORD=your-secure-password
DB_NAME=artorizer_db

# OAuth Providers (Optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret

# External Services
BACKEND_URL=http://localhost:5001
PROCESSOR_URL=http://localhost:8000
ROUTER_BASE_URL=http://localhost:7000

# Security
CALLBACK_AUTH_TOKEN=your-secure-token-here

# Redis
REDIS_HOST=localhost
REDIS_PORT=6379

# Limits
MAX_FILE_SIZE=268435456  # 256MB
RATE_LIMIT_MAX=100
RATE_LIMIT_WINDOW=60000
```

**Note:** Authentication is **disabled by default** (`AUTH_ENABLED=false`) for backward compatibility. Enable it only when you have PostgreSQL configured and OAuth providers set up. See **[AUTH_README.md](AUTH_README.md)** for complete setup instructions.

---

## Service Management

```bash
# View logs
sudo journalctl -u artoize-router -f

# Restart service
sudo systemctl restart artoize-router

# Check status
sudo systemctl status artoize-router

# Edit config
sudo nano /opt/artorizer-router/.env
```

---

## Tech Stack

- **Fastify** - High-performance HTTP server
- **TypeScript** - Type-safe development
- **Better Auth** - OAuth authentication (optional)
- **PostgreSQL** - Session storage (optional, for auth)
- **Zod** - Runtime schema validation
- **Sharp** - Image validation
- **Undici** - Fast HTTP client
- **Bull + Redis** - Job queue and state tracking
- **Pino** - Structured logging

---

## Performance

- **Throughput**: ~1000 req/s per instance (4 workers on 4-core CPU)
- **Concurrency**: Multi-process clustering via Node.js cluster module
- **Memory**: Minimal router memory (no file storage)
- **Circuit Breaker**: Fast fail after 5 consecutive processor failures
- **Max Upload**: 256MB (configurable)

---

## License

Private - Artorizer Project
