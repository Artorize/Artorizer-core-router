# Authentication Implementation Guide

This guide explains how authentication is implemented across the Artorizer architecture using [Better Auth](https://www.better-auth.com/) with MongoDB.

## Architecture Overview

```
┌─────────────────┐
│     Client      │
│  (Web Browser)  │
└────────┬────────┘
         │ 1. OAuth flow / Session cookie
         ▼
┌─────────────────┐
│  Router (7000)  │  ← Session validation only (stateless)
│  ─────────────  │
│  • Validates    │
│    session via  │
│    backend API  │
│  • Extracts     │
│    user info    │
│  • Forwards     │
│    user headers │
└────────┬────────┘
         │ 2. Validate session
         │ 3. Get user info
         ▼
┌─────────────────┐
│  Backend (5001) │  ← Auth source of truth
│  ─────────────  │
│  • Better Auth  │
│    with MongoDB │
│  • OAuth flows  │
│  • Session mgmt │
│  • User storage │
└─────────────────┘
```

## Key Principles

1. **Backend is Auth Authority**: All authentication logic, OAuth flows, and session management happen in the backend
2. **Router is Stateless**: Router only validates sessions by calling the backend - no local database, no Better Auth instance
3. **MongoDB for Everything**: Backend uses the existing MongoDB database for users, sessions, and accounts
4. **User Header Forwarding**: Router extracts user info and forwards it via HTTP headers (`X-User-Id`, `X-User-Email`, `X-User-Name`)

## Features

- ✅ OAuth authentication (Google, GitHub)
- ✅ Session management via httpOnly cookies
- ✅ MongoDB database storage (no PostgreSQL needed)
- ✅ Centralized auth in backend
- ✅ Stateless router design
- ✅ Optional authentication (backward compatible)

---

# Backend Implementation

The backend handles all authentication operations using Better Auth with MongoDB.

## 1. Install Dependencies

```bash
npm install better-auth mongodb
```

## 2. Database Schema

Better Auth will create the following MongoDB collections:

- `users` - User account information
- `accounts` - OAuth provider links
- `sessions` - Active user sessions
- `verification_tokens` - Email verification (if enabled)

## 3. Backend Configuration

### Environment Variables

Add to backend `.env`:

```bash
# Enable authentication
AUTH_ENABLED=true

# Generate a secure secret (32+ characters)
BETTER_AUTH_SECRET=$(openssl rand -base64 32)

# Set your backend's public URL
BETTER_AUTH_URL=https://backend.artorizer.com

# MongoDB connection (reuse existing)
MONGODB_URI=mongodb://localhost:27017/artorizer_db

# Set allowed frontend origins
ALLOWED_ORIGINS=https://artorizer.com,https://router.artorizer.com,http://localhost:8080

# OAuth providers (optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
```

### OAuth Provider Setup

#### Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project or select existing
3. Navigate to **APIs & Services → Credentials**
4. Create **OAuth 2.0 Client ID**
5. Add authorized redirect URIs:
   ```
   https://backend.artorizer.com/api/auth/callback/google
   https://router.artorizer.com/api/auth/callback/google
   ```
6. Copy Client ID and Client Secret to `.env`

#### GitHub OAuth

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Set **Authorization callback URL**:
   ```
   https://backend.artorizer.com/api/auth/callback/github
   https://router.artorizer.com/api/auth/callback/github
   ```
4. Copy Client ID and generate Client Secret
5. Add credentials to `.env`

## 4. Better Auth Setup (Backend)

Create `src/auth.ts`:

```typescript
import { betterAuth } from 'better-auth';
import { MongoClient } from 'mongodb';

const client = new MongoClient(process.env.MONGODB_URI!);
await client.connect();

export const auth = betterAuth({
  database: {
    type: 'mongodb',
    client: client.db(),
  },

  secret: process.env.BETTER_AUTH_SECRET!,
  baseURL: process.env.BETTER_AUTH_URL!,
  trustedOrigins: process.env.ALLOWED_ORIGINS!.split(','),

  socialProviders: {
    google: {
      clientId: process.env.GOOGLE_CLIENT_ID!,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET!,
    },
    github: {
      clientId: process.env.GITHUB_CLIENT_ID!,
      clientSecret: process.env.GITHUB_CLIENT_SECRET!,
    },
  },

  session: {
    expiresIn: 60 * 60 * 24 * 7, // 7 days
    updateAge: 60 * 60 * 24, // Refresh if < 1 day remaining
    cookieCache: {
      enabled: true,
      maxAge: 5 * 60, // 5 minutes
    },
  },

  advanced: {
    cookiePrefix: 'better-auth',
    useSecureCookies: process.env.NODE_ENV === 'production',
  },
});
```

## 5. Backend API Endpoints

The backend must expose the following endpoints:

### Auth Flow Endpoints (Better Auth)

Mount Better Auth handler at `/api/auth/*`:

```typescript
import { auth } from './auth';

app.all('/api/auth/*', async (req, res) => {
  return auth.handler(req, res);
});
```

This provides:
- `GET /api/auth/signin/google` - Initiate Google OAuth
- `GET /api/auth/signin/github` - Initiate GitHub OAuth
- `GET /api/auth/callback/google` - Google OAuth callback
- `GET /api/auth/callback/github` - GitHub OAuth callback
- `GET /api/auth/session` - Get current session
- `POST /api/auth/sign-out` - Sign out

### Session Validation Endpoint (for Router)

Create `POST /api/auth/validate-session`:

```typescript
/**
 * Validate session token and return user info
 * Used by the router to validate sessions
 */
app.post('/api/auth/validate-session', async (req, res) => {
  try {
    const session = await auth.api.getSession({
      headers: req.headers,
    });

    if (!session || !session.user) {
      return res.status(401).json({
        error: 'Invalid session',
        valid: false,
      });
    }

    return res.json({
      valid: true,
      user: {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name,
        image: session.user.image,
        emailVerified: session.user.emailVerified,
        createdAt: session.user.createdAt,
      },
      session: {
        token: session.session.token,
        expiresAt: session.session.expiresAt,
      },
    });
  } catch (error) {
    return res.status(401).json({
      error: 'Session validation failed',
      valid: false,
    });
  }
});
```

### User Lookup Endpoint (Optional)

Create `GET /api/users/:id` for user details:

```typescript
/**
 * Get user by ID
 * Used when user headers are forwarded
 */
app.get('/api/users/:id', async (req, res) => {
  const user = await db.collection('users').findOne({
    id: req.params.id
  });

  if (!user) {
    return res.status(404).json({ error: 'User not found' });
  }

  return res.json({
    id: user.id,
    email: user.email,
    name: user.name,
    image: user.image,
    emailVerified: user.emailVerified,
    createdAt: user.createdAt,
  });
});
```

## 6. Associate Artworks with Users

Update artwork schema to include `user_id`:

```typescript
// MongoDB schema
{
  _id: ObjectId,
  user_id: String,  // UUID from auth.users.id
  artist_name: String,
  artwork_title: String,
  // ... other fields
}
```

Create index:

```typescript
db.collection('artworks').createIndex({ user_id: 1 });
```

Handle user headers in artwork creation:

```typescript
app.post('/artworks', async (req, res) => {
  const userId = req.headers['x-user-id'];

  const artwork = {
    user_id: userId || null,  // Optional - support anonymous uploads
    artist_name: req.body.artist_name,
    artwork_title: req.body.artwork_title,
    // ... other fields
  };

  const result = await db.collection('artworks').insertOne(artwork);
  return res.json({ artwork_id: result.insertedId });
});
```

## 7. CORS Configuration

Configure CORS to allow cookies:

```typescript
app.use(cors({
  origin: process.env.ALLOWED_ORIGINS!.split(','),
  credentials: true, // Critical for cookies
}));
```

---

# Router Implementation

The router validates sessions by calling the backend API. It does not run Better Auth locally.

## 1. Remove Dependencies

The router **does NOT** need:
- ❌ `better-auth` package
- ❌ `pg` (PostgreSQL)
- ❌ MongoDB client
- ❌ Database connections

## 2. Router Configuration

### Environment Variables

Update router `.env`:

```bash
# Enable authentication
AUTH_ENABLED=true

# Backend URL (where auth is handled)
BACKEND_URL=https://backend.artorizer.com

# Allowed origins for CORS
ALLOWED_ORIGINS=https://artorizer.com,http://localhost:8080
```

Remove PostgreSQL and Better Auth config:
- ❌ `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`
- ❌ `BETTER_AUTH_SECRET`, `BETTER_AUTH_URL`
- ❌ `GOOGLE_CLIENT_ID`, `GITHUB_CLIENT_ID`, etc.

## 3. Session Validation Service

Create `src/services/auth.service.ts`:

```typescript
import { request } from 'undici';
import { config } from '../config';

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  image?: string;
  emailVerified: boolean;
  createdAt: string;
}

export interface ValidateSessionResponse {
  valid: boolean;
  user?: AuthUser;
  session?: {
    token: string;
    expiresAt: string;
  };
  error?: string;
}

/**
 * Validate session by calling backend API
 */
export async function validateSession(
  cookies: Record<string, string>
): Promise<ValidateSessionResponse> {
  try {
    const { statusCode, body } = await request(
      `${config.backend.url}/api/auth/validate-session`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          // Forward session cookie to backend
          'Cookie': Object.entries(cookies)
            .map(([key, value]) => `${key}=${value}`)
            .join('; '),
        },
      }
    );

    const response = await body.json();

    if (statusCode === 200 && response.valid) {
      return {
        valid: true,
        user: response.user,
        session: response.session,
      };
    }

    return {
      valid: false,
      error: response.error || 'Invalid session',
    };
  } catch (error) {
    return {
      valid: false,
      error: 'Session validation failed',
    };
  }
}
```

## 4. Auth Middleware

Update `src/middleware/auth.middleware.ts`:

```typescript
import { FastifyRequest, FastifyReply } from 'fastify';
import { validateSession, AuthUser } from '../services/auth.service';
import { config } from '../config';

// Extend Fastify request type
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
  }
}

/**
 * Middleware to require authentication
 * Returns 401 if no valid session is found
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  if (!config.auth.enabled) {
    return; // Auth disabled, allow request
  }

  const result = await validateSession(request.cookies);

  if (!result.valid || !result.user) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Authentication required',
      code: 'AUTH_REQUIRED',
    });
  }

  // Attach user to request
  request.user = result.user;
}

/**
 * Middleware to optionally attach user if authenticated
 * Does not require authentication
 */
export async function optionalAuth(
  request: FastifyRequest
): Promise<void> {
  if (!config.auth.enabled) {
    return;
  }

  try {
    const result = await validateSession(request.cookies);
    if (result.valid && result.user) {
      request.user = result.user;
    }
  } catch (error) {
    // Silent fail - optional auth doesn't block requests
    request.log.debug({ error }, 'Optional auth failed');
  }
}
```

## 5. Forward User Headers

Update `src/services/backend.service.ts` to forward user info:

```typescript
import { FastifyRequest } from 'fastify';

/**
 * Get user headers from authenticated request
 */
function getUserHeaders(request: FastifyRequest): Record<string, string> {
  if (!request.user) {
    return {};
  }

  return {
    'X-User-Id': request.user.id,
    'X-User-Email': request.user.email,
    'X-User-Name': request.user.name || '',
  };
}

/**
 * Call backend API with user headers
 */
export async function callBackend(
  endpoint: string,
  request: FastifyRequest,
  options: any = {}
) {
  const userHeaders = getUserHeaders(request);

  const { statusCode, body } = await undiciRequest(
    `${config.backend.url}${endpoint}`,
    {
      ...options,
      headers: {
        ...options.headers,
        ...userHeaders, // Forward user context
      },
    }
  );

  return { statusCode, body };
}
```

## 6. Protect Routes

Use middleware on routes:

```typescript
import { requireAuth, optionalAuth } from '../middleware/auth.middleware';

// Optional auth - allows anonymous + authenticated users
app.post('/protect', {
  preHandler: optionalAuth,
}, async (request, reply) => {
  // request.user might be undefined (anonymous)
  // request.user will be populated if authenticated
});

// Required auth - only authenticated users
app.get('/artworks/me', {
  preHandler: requireAuth,
}, async (request, reply) => {
  // request.user is guaranteed to exist
  const userId = request.user!.id;
});
```

## 7. Proxy Auth Endpoints to Backend

Route auth requests to the backend:

```typescript
/**
 * Proxy all /api/auth/* requests to backend
 * This allows OAuth flows to work through the router
 */
app.all('/api/auth/*', async (request, reply) => {
  const path = request.url; // e.g., /api/auth/signin/google

  const { statusCode, headers, body } = await request(
    `${config.backend.url}${path}`,
    {
      method: request.method,
      headers: request.headers,
      body: request.body,
    }
  );

  // Forward cookies from backend to client
  if (headers['set-cookie']) {
    reply.header('set-cookie', headers['set-cookie']);
  }

  return reply.status(statusCode).send(body);
});
```

This allows users to authenticate via:
- `https://router.artorizer.com/api/auth/signin/google`
- `https://router.artorizer.com/api/auth/session`

And the router proxies these to the backend.

---

# Testing

## Backend Testing

### 1. Test OAuth Flow

```bash
# Start backend
npm start

# Open browser to:
https://backend.artorizer.com/api/auth/signin/google

# Complete OAuth, then check session:
curl -X GET https://backend.artorizer.com/api/auth/session \
  --cookie "better-auth.session_token=xxx"
```

### 2. Test Session Validation Endpoint

```bash
# Validate session
curl -X POST https://backend.artorizer.com/api/auth/validate-session \
  -H "Cookie: better-auth.session_token=xxx"

# Response (valid):
{
  "valid": true,
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe"
  }
}

# Response (invalid):
{
  "valid": false,
  "error": "Invalid session"
}
```

## Router Testing

### 1. Test Auth Proxy

```bash
# OAuth via router (proxied to backend)
# Open browser to:
https://router.artorizer.com/api/auth/signin/google

# Check session via router:
curl -X GET https://router.artorizer.com/api/auth/session \
  --cookie "better-auth.session_token=xxx"
```

### 2. Test Protected Route

```bash
# Without auth (should fail)
curl -X POST https://router.artorizer.com/protect

# Response: {"error": "Unauthorized", "code": "AUTH_REQUIRED"}

# With auth
curl -X POST https://router.artorizer.com/protect \
  --cookie "better-auth.session_token=xxx" \
  -F "image=@test.png" \
  -F "artist_name=Test Artist" \
  -F "artwork_title=Test Artwork"

# User headers forwarded to backend:
# X-User-Id: uuid
# X-User-Email: user@example.com
# X-User-Name: John Doe
```

---

# Migration Checklist

## Backend Tasks

- [ ] Install `better-auth` and update MongoDB schema
- [ ] Add auth configuration to `.env`
- [ ] Create `src/auth.ts` with Better Auth + MongoDB
- [ ] Implement `/api/auth/*` handler (Better Auth)
- [ ] Implement `POST /api/auth/validate-session` endpoint
- [ ] Update CORS to allow credentials
- [ ] Add `user_id` field to `artworks` collection
- [ ] Create index on `artworks.user_id`
- [ ] Handle `X-User-Id`, `X-User-Email`, `X-User-Name` headers in endpoints
- [ ] Set up OAuth apps (Google, GitHub)
- [ ] Test OAuth flow
- [ ] Test session validation endpoint

## Router Tasks

- [ ] Remove `better-auth` and `pg` dependencies
- [ ] Remove PostgreSQL config from `.env`
- [ ] Remove `src/auth.ts` (Better Auth instance)
- [ ] Create `src/services/auth.service.ts` (session validation via backend)
- [ ] Update `src/middleware/auth.middleware.ts` (call backend API)
- [ ] Add user header forwarding in backend service
- [ ] Add `/api/auth/*` proxy to backend
- [ ] Update config schema (remove DB fields)
- [ ] Test session validation
- [ ] Test protected routes
- [ ] Test user header forwarding

---

# Security Considerations

1. **HTTPS Required**: Use HTTPS in production for secure cookies
2. **CORS Configuration**: Only allow trusted origins with `credentials: true`
3. **Cookie Security**: `httpOnly`, `secure`, `sameSite` flags set by Better Auth
4. **Session Duration**: 7 days by default, configurable
5. **Token Security**: Backend validates all session tokens
6. **User Headers**: Router only forwards user info after successful validation
7. **OAuth Secrets**: Store in environment variables, rotate regularly

---

## OAuth Error Handling

The router now includes a dedicated error handler for OAuth authentication failures. When Better Auth encounters an error during OAuth (e.g., `state_mismatch`), it redirects to `/auth/error` with error details.

### GET /auth/error Endpoint

This endpoint displays a user-friendly error page for OAuth failures:

```
GET /auth/error?error=state_mismatch&error_description=...
```

**Supported Error Codes:**
- `state_mismatch` - Authentication state doesn't match (session expired)
- `invalid_grant` - Auth code invalid or expired
- `access_denied` - User denied access
- `server_error` - OAuth provider error
- `temporarily_unavailable` - Service temporarily unavailable

**Response:** HTML error page with retry option

---

## APP_BASE_URL Configuration (CRITICAL)

The `APP_BASE_URL` environment variable is critical for OAuth to work correctly. It must match the public URL where the router receives OAuth callbacks.

### Configuration

**Backend Environment Variable:**
```bash
# MUST match the public router URL where OAuth callbacks are received
# Production:
APP_BASE_URL=https://router.artorizer.com/auth

# Development:
APP_BASE_URL=http://localhost:7000/auth
```

**Why the `/auth` path?**
- Better Auth uses `basePath: '/auth'` internally
- OAuth callback URLs are built as: `${APP_BASE_URL}/callback/:provider`
- Error redirect URLs are built as: `${APP_BASE_URL}/error`
- These must match the actual router endpoints

### Common Mistakes

❌ **Wrong:**
```bash
APP_BASE_URL=https://router.artorizer.com        # Missing /auth
APP_BASE_URL=https://backend.artorizer.com/auth  # Wrong hostname
```

✅ **Correct:**
```bash
APP_BASE_URL=https://router.artorizer.com/auth
APP_BASE_URL=http://localhost:7000/auth
```

### state_mismatch Errors

If you see `state_mismatch` errors after OAuth, the most common cause is incorrect `APP_BASE_URL`:

1. **Verify `APP_BASE_URL` matches your router hostname**
   ```bash
   # Check backend systemd service
   systemctl show artorize-backend --property=Environment | grep APP_BASE_URL
   ```

2. **Ensure OAuth callbacks are reaching the router**
   - Google/GitHub redirect to: `https://<your-router-domain>/auth/callback/google`
   - This request must reach the router, not bypass it

3. **Check SSL certificate**
   - Ensure HTTPS works for your router domain
   - Self-signed certs may cause OAuth provider rejections

4. **Verify Router is Accessible**
   - OAuth providers cannot redirect to localhost
   - Use a public domain in production

---

# Troubleshooting

## Backend Issues

### "Auth not initialized"
- Verify `AUTH_ENABLED=true` in backend `.env` or systemd service
- Check `BETTER_AUTH_SECRET` and `APP_BASE_URL` are set
- Verify MongoDB connection

### OAuth Redirect Mismatch
- **CRITICAL**: Verify `APP_BASE_URL` environment variable is set correctly
- Check `APP_BASE_URL` includes the `/auth` path
- Ensure redirect URIs in OAuth apps match:
  - `https://router.artorizer.com/auth/callback/google`
  - `https://router.artorizer.com/auth/callback/github`
- In OAuth provider settings, add both callback URLs

### state_mismatch Errors
- Verify `APP_BASE_URL` matches your public router URL (with `/auth` path)
- Check systemd service has correct `APP_BASE_URL`:
  ```bash
  systemctl show artorize-backend --property=Environment | grep APP_BASE_URL
  ```
- Restart backend service after changing `APP_BASE_URL`:
  ```bash
  systemctl restart artorize-backend
  ```
- Check browser can access `/auth/error` endpoint:
  ```bash
  curl https://router.artorizer.com/auth/error?error=test
  ```

### Session Not Persisting
- Check CORS `credentials: true` enabled on backend
- Verify `ALLOWED_ORIGINS` includes frontend domain
- Use HTTPS in production
- Verify `APP_BASE_URL` is correct

## Router Issues

### "Session validation failed"
- Verify `BACKEND_URL` points to correct backend
- Check backend `/auth/get-session` endpoint is working
- Ensure cookies are being forwarded correctly

### User Headers Not Forwarding
- Verify `optionalAuth` or `requireAuth` middleware is applied
- Check `request.user` is populated before calling backend
- Verify backend is reading `X-User-*` headers

### OAuth Error Page Not Showing
- Verify `AUTH_ENABLED=true` in router `.env`
- Check that `/auth/error` route is registered
- Ensure ALLOWED_ORIGINS includes the frontend domain for error page CORS

---

# Further Reading

- [Better Auth Documentation](https://www.better-auth.com/docs)
- [Better Auth MongoDB Adapter](https://www.better-auth.com/docs/adapters/mongodb)
- [OAuth 2.0 Specification](https://oauth.net/2/)
