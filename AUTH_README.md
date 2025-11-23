# Authentication Implementation Guide

This router now supports optional authentication using [Better Auth](https://www.better-auth.com/).

## Features

- ✅ OAuth authentication (Google, GitHub)
- ✅ Session management via httpOnly cookies
- ✅ Middleware for protected routes
- ✅ Optional authentication (backward compatible)
- ✅ Fastify integration
- ✅ PostgreSQL database storage

## Quick Start

### 1. Database Setup

Create a PostgreSQL database and user:

```sql
CREATE DATABASE artorizer_db;
CREATE USER artorizer WITH ENCRYPTED PASSWORD 'your-secure-password';
GRANT ALL PRIVILEGES ON DATABASE artorizer_db TO artorizer;
```

### 2. Run Migrations

Better Auth will create the necessary tables automatically. Run the migration:

```bash
npx better-auth migrate
```

This creates the following tables:
- `users` - User account information
- `accounts` - OAuth provider links
- `sessions` - Active user sessions

### 3. Configure Environment Variables

Copy `.env.example` to `.env` and configure:

```bash
# Enable authentication
AUTH_ENABLED=true

# Generate a secure secret (32+ characters)
BETTER_AUTH_SECRET=$(openssl rand -base64 32)

# Set your router's public URL
BETTER_AUTH_URL=https://router.artorizer.com

# Configure database connection
DB_HOST=localhost
DB_PORT=5432
DB_USER=artorizer
DB_PASSWORD=your-secure-password
DB_NAME=artorizer_db

# Set allowed frontend origins
ALLOWED_ORIGINS=https://artorizer.com,http://localhost:8080

# Configure OAuth providers (optional)
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
```

### 4. OAuth Provider Setup

#### Google OAuth

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a project or select existing
3. Navigate to **APIs & Services → Credentials**
4. Create **OAuth 2.0 Client ID**
5. Add authorized redirect URI:
   ```
   https://router.artorizer.com/api/auth/callback/google
   ```
6. Copy Client ID and Client Secret to `.env`

#### GitHub OAuth

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Set **Authorization callback URL**:
   ```
   https://router.artorizer.com/api/auth/callback/github
   ```
4. Copy Client ID and generate Client Secret
5. Add credentials to `.env`

## Available Endpoints

When `AUTH_ENABLED=true`, the following endpoints are automatically available:

### Authentication Endpoints

All Better Auth endpoints are mounted at `/api/auth/*`:

- `GET /api/auth/signin/google` - Initiate Google OAuth
- `GET /api/auth/signin/github` - Initiate GitHub OAuth
- `GET /api/auth/callback/google` - Google OAuth callback
- `GET /api/auth/callback/github` - GitHub OAuth callback
- `GET /api/auth/session` - Get current session
- `POST /api/auth/sign-out` - Sign out

### Example: Get Current Session

```bash
curl -X GET https://router.artorizer.com/api/auth/session \
  --cookie "better-auth.session_token=xxx"
```

Response (authenticated):
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe",
    "image": "https://...",
    "emailVerified": true,
    "createdAt": "2025-01-15T10:30:00Z"
  },
  "session": {
    "token": "session-token",
    "expiresAt": "2025-01-22T10:30:00Z"
  }
}
```

Response (not authenticated):
```json
null
```

## Protecting Routes

### Using `requireAuth` Middleware

Add authentication requirement to any route:

```typescript
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '../middleware/auth.middleware';

export async function protectedRoute(app: FastifyInstance) {
  app.post('/api/protected', {
    preHandler: requireAuth,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // User is guaranteed to be authenticated here
    const userId = request.user!.id;
    const userEmail = request.user!.email;

    return reply.send({
      message: 'Protected resource',
      userId,
      userEmail,
    });
  });
}
```

If the user is not authenticated, returns:
```json
{
  "error": "Unauthorized",
  "message": "Authentication required",
  "code": "AUTH_REQUIRED"
}
```

### Using `optionalAuth` Middleware

Attach user info if authenticated, but don't require it:

```typescript
import { optionalAuth } from '../middleware/auth.middleware';

export async function publicRoute(app: FastifyInstance) {
  app.get('/api/public', {
    preHandler: optionalAuth,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // User might or might not be authenticated
    if (request.user) {
      return reply.send({
        message: 'Hello, authenticated user!',
        userId: request.user.id,
      });
    }

    return reply.send({
      message: 'Hello, anonymous user!',
    });
  });
}
```

## Example: Protected Upload Route

Here's how to associate uploads with authenticated users:

```typescript
import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { requireAuth } from '../middleware/auth.middleware';

export async function uploadRoute(app: FastifyInstance) {
  app.post('/api/upload', {
    preHandler: requireAuth, // Require authentication
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    // Get authenticated user ID
    const userId = request.user!.id;

    // Your existing upload logic...
    const artwork = await processUpload(request.body, userId);

    return reply.send({
      success: true,
      artwork_id: artwork.id,
      user_id: userId,
    });
  });

  app.get('/api/artworks/me', {
    preHandler: requireAuth,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    const userId = request.user!.id;

    // Fetch only this user's artworks
    const artworks = await getArtworksByUser(userId);

    return reply.send({
      artworks,
      total: artworks.length,
    });
  });
}
```

## TypeScript Types

The middleware extends Fastify's request type:

```typescript
declare module 'fastify' {
  interface FastifyRequest {
    user?: {
      id: string;
      email: string;
      name?: string;
      image?: string;
      emailVerified: boolean;
      createdAt: string;
    };
    session?: {
      token: string;
      expiresAt: string;
    };
  }
}
```

## Backward Compatibility

Authentication is **disabled by default** (`AUTH_ENABLED=false`).

When disabled:
- No auth endpoints are mounted
- No database connections are made
- Middleware functions return immediately (no-op)
- Existing routes work unchanged

This ensures backward compatibility with existing deployments.

## Testing

### Test OAuth Flow

1. Start the router: `npm start`
2. Open browser to: `https://router.artorizer.com/api/auth/signin/google`
3. Complete OAuth authorization
4. Check session: `GET /api/auth/session`

### Test Protected Route

```bash
# Without auth (should fail)
curl -X POST https://router.artorizer.com/api/protected

# Response: {"error": "Unauthorized", "code": "AUTH_REQUIRED"}

# With auth (after OAuth)
curl -X POST https://router.artorizer.com/api/protected \
  --cookie "better-auth.session_token=xxx"

# Response: {"message": "Protected resource", "userId": "..."}
```

## Security Considerations

1. **HTTPS Required**: In production, `useSecureCookies` is automatically enabled
2. **CORS**: Only allowed origins can make authenticated requests
3. **Session Duration**: 7 days by default, configurable in `src/auth.ts`
4. **Database Credentials**: Store in environment variables, never commit
5. **OAuth Secrets**: Keep confidential, rotate regularly

## Troubleshooting

### "Auth not initialized" Error

- Ensure `AUTH_ENABLED=true` in `.env`
- Verify `BETTER_AUTH_SECRET` and `BETTER_AUTH_URL` are set
- Check database connection credentials

### OAuth Redirect Mismatch

- Verify redirect URI in OAuth provider matches exactly:
  - Google: `https://router.artorizer.com/api/auth/callback/google`
  - GitHub: `https://router.artorizer.com/api/auth/callback/github`
- No trailing slashes, exact match required

### Session Not Persisting

- Check CORS `credentials: true` is set
- Verify frontend sends `credentials: 'include'`
- Ensure cookie domain matches
- Use HTTPS in production

### Database Connection Errors

- Test connection: `psql -h $DB_HOST -U $DB_USER -d $DB_NAME`
- Verify database exists and user has permissions
- Check `DB_*` environment variables

## Manual Steps Required

The following cannot be automated and must be done manually:

1. **Database Setup**: Create PostgreSQL database and user
2. **Run Migrations**: `npx better-auth migrate`
3. **OAuth Configuration**: Set up Google/GitHub OAuth apps
4. **Add `user_id` Columns**: Alter existing tables to link to users:

```sql
-- Add user_id to artworks table
ALTER TABLE artworks
ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_artworks_user_id ON artworks(user_id);

-- Add user_id to jobs table (if exists)
ALTER TABLE jobs
ADD COLUMN user_id UUID REFERENCES users(id) ON DELETE SET NULL;

CREATE INDEX idx_jobs_user_id ON jobs(user_id);
```

## Further Reading

- [Better Auth Documentation](https://www.better-auth.com/docs)
- [Better Auth GitHub](https://github.com/better-auth/better-auth)
- [OAuth 2.0 Specification](https://oauth.net/2/)
