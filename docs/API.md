# Artorizer Core Router API Reference

Complete API reference for the Artorizer Core Router.

**Base URL**: `http://localhost:7000` (configurable via `PORT` and `HOST`)

---

## Table of Contents

1. [Overview](#overview)
2. [Authentication](#authentication)
3. [Artwork Management](#artwork-management)
4. [Artwork Submission](#artwork-submission)
5. [Job Status](#job-status)
6. [Callback Endpoints](#callback-endpoints)
6. [Health Checks](#health-checks)
7. [Error Codes](#error-codes)

---

## Overview

The Artorizer Core Router acts as the central gateway for the Artorize architecture. It handles:
- **Authentication**: Validates user sessions via the Backend.
- **Artwork Submission**: Accepts uploads and routes them to the Processor.
- **Job Tracking**: Tracks processing status via Redis.
- **Result Retrieval**: Proxies downloads from the Backend.

---


## Authentication

**Optional Feature** - Disabled by default (`AUTH_ENABLED=false`).

When enabled, the router supports user authentication via Better Auth (Google, GitHub). The router is **stateless** and validates sessions by calling the Backend API.

### Headers
When a user is authenticated, the router automatically forwards user context to the backend via HTTP headers on all user-facing endpoints:

- `X-User-Id`: User's UUID
- `X-User-Email`: User's email address
- `X-User-Name`: User's display name

### Auth Endpoints

#### POST /auth/sign-in/social
Initiates OAuth flow for specified provider.

**Request:**
```json
{
  "provider": "google" // or "github"
}
```

**Response:**
```json
{
  "url": "https://accounts.google.com/...",
  "redirect": true
}
```

#### POST /auth/register
Forward registration to backend.

**Request:**
```json
{
  "email": "user@example.com",
  "password": "securePassword",
  "username": "user123",
  "name": "User Name"
}
```

#### POST /auth/login
Forward login to backend.

**Request:**
```json
{
  "emailOrUsername": "user@example.com",
  "password": "securePassword"
}
```

#### POST /auth/logout
Sign out and clear session cookie.

#### GET /auth/me
Get current authenticated user session.

**Response (Authenticated):**
```json
{
  "user": {
    "id": "uuid",
    "email": "user@example.com",
    "name": "John Doe"
  },
  "session": {
    "token": "...",
    "expiresAt": "..."
  }
}
```

#### GET /auth/session
Alias for `/auth/me`.

#### GET /auth/check-availability
Check if email/username is available.

**Query Parameters:**
- `email`: Email to check
- `username`: Username to check

#### GET /auth/error
Handle OAuth errors.

#### GET/POST /auth/callback/:provider
OAuth callback handlers.

---

## Artwork Management

### GET /artworks/me
Get artwork history for logged-in user.

**Authentication**: Required

**Query Parameters:**
- `limit`: Max items (default: 20)
- `skip`: Pagination offset (default: 0)

---

## Artwork Submission

### POST /protect
Submit artwork for protection processing.

**Content-Type**: `multipart/form-data` or `application/json`

**Parameters:**
- `artist_name` (required): String
- `artwork_title` (required): String
- `image` (file) OR `image_url` (string): Required
- `include_protection` (boolean): Default `true`
- `watermark_strategy` (string): `tree-ring`, `invisible-watermark`, or `none`

**Example:**
```bash
curl -X POST http://localhost:7000/protect \
  -F "image=@forest.jpg" \
  -F "artist_name=Jane Doe" \
  -F "artwork_title=Shaded Forest"
```

**Response (202 Accepted):**
```json
{
  "job_id": "f2dc197c-43b9-404d-b3f3-159282802609",
  "status": "processing"
}
```

---

## Job Status

### GET /jobs/:id
Get job status.

**Response (Processing):**
```json
{
  "job_id": "...",
  "status": "processing",
  "progress": {
    "current_step": "Processing imagehash",
    "percentage": 25
  }
}
```

### GET /jobs/:id/result
Get complete job result with backend URLs.

**Response (Completed):**
```json
{
  "job_id": "...",
  "status": "completed",
  "urls": {
    "original": "http://localhost:7000/jobs/.../download/original",
    "protected": "http://localhost:7000/jobs/.../download/protected",
    "mask": "http://localhost:7000/jobs/.../download/mask"
  }
}
```

### GET /jobs/:id/download/:variant
Download artwork file.
**Variants**: `original`, `protected`, `mask`

---

## Callback Endpoints

### POST /callbacks/process-complete
Receives async completion callback from processor.
**Auth**: `Authorization: Bearer <CALLBACK_AUTH_TOKEN>`

### POST /callbacks/process-progress
Receives progress updates from processor.
**Auth**: `Authorization: Bearer <CALLBACK_AUTH_TOKEN>`

---

## Health Checks

### GET /health
Returns service health status.

---

## Error Codes

| Code | Description |
|------|-------------|
| `400` | Bad Request (Validation error) |
| `401` | Unauthorized |
| `404` | Not Found |
| `503` | Service Unavailable (Processor/Backend down) |
