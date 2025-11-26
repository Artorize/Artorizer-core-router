# Authentication API Reference

This document details all authentication endpoints and provides guidance on implementing authentication in client applications.

## Overview

The Artorizer Core Router proxies all authentication requests to the backend service. Authentication is handled via session cookies (`better-auth.session_token`) with support for:

- Email/password authentication
- OAuth 2.0 (Google and GitHub)
- Session-based authentication with automatic refresh

## Session Management

| Property | Value |
|----------|-------|
| Cookie Name | `better-auth.session_token` |
| Duration | 7 days |
| Auto-refresh | Within 1 day of expiration |
| Cookie Flags | `httpOnly`, `secure`, `sameSite=Lax` |

---

## Email/Password Authentication

### Register a New User

Creates a new user account with email and password.

```
POST /auth/register
```

**Request Body:**
```json
{
  "email": "user@example.com",
  "password": "secure_password",
  "username": "username",
  "name": "Full Name"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| email | string | Yes | Valid email address |
| password | string | Yes | User password |
| username | string | Yes | Unique username |
| name | string | No | Display name |

**Response (201 Created):**
```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "username": "username",
    "name": "Full Name"
  },
  "session": {
    "id": "session-id",
    "token": "session-token",
    "expiresAt": "2025-02-01T12:00:00.000Z"
  }
}
```

**Cookies Set:** `better-auth.session_token` (httpOnly)

---

### Login

Authenticates a user with email/username and password.

```
POST /auth/login
```

**Request Body:**
```json
{
  "emailOrUsername": "user@example.com",
  "password": "password"
}
```

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| emailOrUsername | string | Yes | Email address or username |
| password | string | Yes | User password |

**Response (200 OK):**
```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "username": "username",
    "name": "Full Name"
  },
  "session": {
    "id": "session-id",
    "token": "session-token",
    "expiresAt": "2025-02-01T12:00:00.000Z"
  }
}
```

**Error Responses:**
- `401 Unauthorized` - Invalid credentials
- `400 Bad Request` - Missing required fields

---

### Logout

Ends the current user session.

```
POST /auth/logout
```

**Request Headers:**
```
Cookie: better-auth.session_token=<token>
Origin: https://artorizer.com
```

**Response (200 OK):**
```json
{
  "success": true
}
```

**Cookies Cleared:** `better-auth.session_token`

---

### Get Current User

Returns the authenticated user's information.

```
GET /auth/me
```

**Request Headers:**
```
Cookie: better-auth.session_token=<token>
```

**Response (200 OK):**
```json
{
  "user": {
    "id": "550e8400-e29b-41d4-a716-446655440000",
    "email": "user@example.com",
    "username": "username",
    "name": "Full Name",
    "emailVerified": true
  },
  "session": {
    "id": "session-id",
    "expiresAt": "2025-02-01T12:00:00.000Z"
  }
}
```

**Error Responses:**
- `401 Unauthorized` - Not authenticated or session expired

---

### Check Availability

Checks if an email or username is available for registration.

```
GET /auth/check-availability?email=<email>&username=<username>
```

**Query Parameters:**

| Parameter | Type | Required | Description |
|-----------|------|----------|-------------|
| email | string | No | Email to check |
| username | string | No | Username to check |

*At least one parameter must be provided.*

**Response (200 OK):**
```json
{
  "available": true,
  "email": "available",
  "username": "taken"
}
```

| Status Value | Description |
|--------------|-------------|
| `available` | Not registered |
| `taken` | Already in use |
| `invalid` | Invalid format |

---

## OAuth 2.0 Authentication

The router supports OAuth authentication via Google and GitHub. The flow uses PKCE (Proof Key for Code Exchange) for enhanced security.

### Initiating OAuth Flow

To initiate OAuth login, POST to `/auth/sign-in/social` with the provider name. The endpoint returns the OAuth provider's authorization URL.

**Request:**
```
POST /auth/sign-in/social
Content-Type: application/json

{"provider": "google"}  // or "github"
```

**Production URLs:**
```
POST https://router.artorizer.com/auth/sign-in/social
```

**Local Development:**
```
POST http://localhost:7000/auth/sign-in/social
```

### Start OAuth Flow

Initiates the OAuth authentication flow with the specified provider.

```
POST /auth/sign-in/social
```

**Request Body:**

| Field | Type | Description |
|-------|------|-------------|
| provider | string | `google` or `github` |

**Request Example:**
```json
{
  "provider": "google"
}
```

**Response:** (200 OK)
```json
{
  "url": "https://accounts.google.com/o/oauth2/auth?response_type=code&client_id=...&redirect_uri=...",
  "redirect": true
}
```

**Behavior:**
1. Backend generates PKCE state and nonce
2. Returns OAuth provider's authorization URL
3. Frontend navigates user to this URL
4. User authenticates with provider
5. Provider redirects back to `/auth/callback/:provider`

### OAuth Callback

Handles the OAuth provider callback after user authorization.

```
GET /auth/callback/:provider
```

**Path Parameters:**

| Parameter | Values | Description |
|-----------|--------|-------------|
| provider | `google`, `github` | OAuth provider |

**Query Parameters (set by provider):**

| Parameter | Description |
|-----------|-------------|
| code | Authorization code from provider |
| state | PKCE state for verification |

**Example Callback URLs:**
```
GET /auth/callback/google?code=4/0AX4XfWh...&state=...
GET /auth/callback/github?code=abc123&state=...
```

**Behavior:**
1. Backend verifies PKCE state against cookie
2. Exchanges authorization code for access token
3. Fetches user profile from OAuth provider
4. Creates or links user account
5. Creates session
6. Sets session cookie (`better-auth.session_token`)
7. Redirects to frontend application with authenticated session

**Response:** HTTP 302 redirect to frontend with session established

---

## OAuth Flow Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT APPLICATION                            │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 1. User clicks "Login with Google"
                                    │    POST /auth/sign-in/social
                                    │    {"provider":"google"}
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      ROUTER (port 7000)                              │
│                                                                      │
│   POST /auth/sign-in/social                                          │
│   → Proxies to backend                                               │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 2. Backend initiates PKCE flow
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      BACKEND (port 5001)                             │
│                                                                      │
│   • Generates state & nonce                                          │
│   • Creates authorization URL                                        │
│   • Returns 200 OK with URL                                          │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 3. Response with OAuth URL
                                    │    {"url":"https://...", "redirect":true}
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT APPLICATION                            │
│                                                                      │
│   Navigate window to returned URL                                    │
│   window.location.href = response.data.url                           │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 4. Browser navigates to OAuth provider
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                    GOOGLE OAUTH CONSENT                              │
│                                                                      │
│   https://accounts.google.com/o/oauth2/v2/auth                       │
│   ?client_id=...                                                     │
│   &redirect_uri=.../auth/callback/google                             │
│   &state=...                                                         │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 5. User grants permission
                                    │    Provider redirects to callback
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      ROUTER (port 7000)                              │
│                                                                      │
│   GET /auth/callback/google?code=...&state=...                       │
│   → Proxies to backend                                               │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 6. Backend processes callback
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                      BACKEND (port 5001)                             │
│                                                                      │
│   • Verifies PKCE state                                              │
│   • Exchanges code for access token                                  │
│   • Fetches user profile from Google                                 │
│   • Creates/links user account                                       │
│   • Creates session                                                  │
│   • Sets better-auth.session_token cookie                            │
│   • Returns 302 redirect to frontend                                 │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    │ 7. User redirected to app (authenticated)
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                        CLIENT APPLICATION                            │
│                                                                      │
│   Session cookie is set, user is authenticated                       │
│   Call GET /auth/me to get user info                                 │
└─────────────────────────────────────────────────────────────────────┘
```

---

## Client Implementation Examples

### JavaScript/TypeScript - Initiating OAuth

```typescript
// Initiate OAuth flow by getting the OAuth URL
async function loginWithGoogle() {
  try {
    const response = await fetch('/auth/sign-in/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ provider: 'google' }),
    });

    if (!response.ok) throw new Error('Failed to start OAuth');

    const data = await response.json();
    // Redirect to the OAuth provider
    window.location.href = data.url;
  } catch (error) {
    console.error('OAuth error:', error);
  }
}

async function loginWithGitHub() {
  try {
    const response = await fetch('/auth/sign-in/social', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ provider: 'github' }),
    });

    if (!response.ok) throw new Error('Failed to start OAuth');

    const data = await response.json();
    // Redirect to the OAuth provider
    window.location.href = data.url;
  } catch (error) {
    console.error('OAuth error:', error);
  }
}
```

### JavaScript/TypeScript - Email/Password Login

```typescript
async function login(emailOrUsername: string, password: string) {
  const response = await fetch('/auth/login', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
    },
    credentials: 'include', // Important: include cookies
    body: JSON.stringify({ emailOrUsername, password }),
  });

  if (!response.ok) {
    throw new Error('Login failed');
  }

  return response.json();
}
```

### JavaScript/TypeScript - Get Current User

```typescript
async function getCurrentUser() {
  const response = await fetch('/auth/me', {
    credentials: 'include', // Important: include cookies
  });

  if (!response.ok) {
    if (response.status === 401) {
      return null; // Not authenticated
    }
    throw new Error('Failed to get user');
  }

  return response.json();
}
```

### JavaScript/TypeScript - Logout

```typescript
async function logout() {
  const response = await fetch('/auth/logout', {
    method: 'POST',
    credentials: 'include',
  });

  if (!response.ok) {
    throw new Error('Logout failed');
  }

  // Redirect to login page or update UI
  window.location.href = '/login';
}
```

### React Hook Example

```typescript
import { useState, useEffect } from 'react';

function useAuth() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch('/auth/me', { credentials: 'include' })
      .then(res => res.ok ? res.json() : null)
      .then(data => {
        setUser(data?.user || null);
        setLoading(false);
      })
      .catch(() => {
        setUser(null);
        setLoading(false);
      });
  }, []);

  const loginWithGoogle = async () => {
    try {
      const response = await fetch('/auth/sign-in/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: 'google' }),
      });

      if (!response.ok) throw new Error('Failed to start OAuth');

      const data = await response.json();
      window.location.href = data.url;
    } catch (error) {
      console.error('OAuth error:', error);
    }
  };

  const loginWithGitHub = async () => {
    try {
      const response = await fetch('/auth/sign-in/social', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: 'github' }),
      });

      if (!response.ok) throw new Error('Failed to start OAuth');

      const data = await response.json();
      window.location.href = data.url;
    } catch (error) {
      console.error('OAuth error:', error);
    }
  };

  const logout = async () => {
    await fetch('/auth/logout', {
      method: 'POST',
      credentials: 'include',
    });
    setUser(null);
  };

  return { user, loading, loginWithGoogle, loginWithGitHub, logout };
}
```

---

## OAuth Provider Setup

### Google OAuth Configuration

1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create or select a project
3. Navigate to **APIs & Services** > **Credentials**
4. Click **Create Credentials** > **OAuth client ID**
5. Configure the consent screen if prompted
6. Select **Web application**
7. Add authorized redirect URIs:
   ```
   https://router.artorizer.com/auth/callback/google
   http://localhost:7000/auth/callback/google  (for development)
   ```
8. Save the Client ID and Client Secret

### GitHub OAuth Configuration

1. Go to [GitHub Developer Settings](https://github.com/settings/developers)
2. Click **New OAuth App**
3. Fill in application details:
   - **Homepage URL:** `https://artorizer.com`
   - **Authorization callback URL:** `https://router.artorizer.com/auth/callback/github`
4. Register the application
5. Generate a client secret
6. Save the Client ID and Client Secret

---

## Environment Configuration

```env
# Enable authentication
AUTH_ENABLED=true

# Backend URL (handles auth logic)
BACKEND_URL=https://backend.artorizer.com

# Allowed origins for CORS
ALLOWED_ORIGINS=https://artorizer.com,https://app.artorizer.com
```

Backend environment variables (configured in backend service):
```env
# Google OAuth
GOOGLE_CLIENT_ID=your-google-client-id
GOOGLE_CLIENT_SECRET=your-google-client-secret

# GitHub OAuth
GITHUB_CLIENT_ID=your-github-client-id
GITHUB_CLIENT_SECRET=your-github-client-secret
```

---

## Error Handling

### Common Error Responses

| Status Code | Description | Common Causes |
|-------------|-------------|---------------|
| 400 | Bad Request | Missing required fields, invalid format |
| 401 | Unauthorized | Invalid credentials, expired session |
| 403 | Forbidden | Account disabled, insufficient permissions |
| 409 | Conflict | Email/username already exists |
| 500 | Server Error | Backend unavailable |

### Error Response Format

```json
{
  "error": "Unauthorized",
  "message": "Invalid credentials"
}
```

---

## Security Considerations

1. **HTTPS Required:** All authentication endpoints must be accessed over HTTPS in production
2. **Cookie Security:** Session cookies are `httpOnly` (no JavaScript access), `secure` (HTTPS only), and `sameSite=Lax`
3. **PKCE:** OAuth flows use Proof Key for Code Exchange to prevent authorization code interception
4. **CORS:** Only allowed origins can make authenticated requests
5. **Credentials:** Always use `credentials: 'include'` when making fetch requests to include cookies

---

## Endpoints Summary

| Endpoint | Method | Auth | Description |
|----------|--------|------|-------------|
| `/auth/register` | POST | No | Create new account |
| `/auth/login` | POST | No | Email/password login |
| `/auth/logout` | POST | Yes | End session |
| `/auth/me` | GET | Yes | Get current user |
| `/auth/check-availability` | GET | No | Check email/username |
| `/auth/sign-in/social` | POST | No | Start OAuth flow (returns OAuth URL) |
| `/auth/callback/:provider` | GET | OAuth | OAuth callback (google, github) |
