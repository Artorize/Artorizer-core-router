/**
 * DEPRECATED: This file is no longer used.
 *
 * As of the AUTH_ALIGNMENT migration, the router no longer runs Better Auth locally.
 * All authentication is now handled by the backend service (MongoDB + Better Auth).
 *
 * The router acts as a lightweight proxy for authentication routes:
 * - POST /auth/register
 * - POST /auth/login
 * - POST /auth/logout
 * - GET /auth/me
 * - GET /auth/check-availability
 *
 * Session validation is performed by calling the backend's /auth/me endpoint.
 *
 * See:
 * - src/routes/auth.ts - Auth proxy routes
 * - src/middleware/auth.middleware.ts - Session validation via backend
 * - AUTH_ALIGNMENT.md - Migration contract and alignment details
 */

export function initializeAuth() {
  // No-op: Auth initialization moved to backend
  console.warn('initializeAuth() is deprecated. Auth is now handled by the backend.');
  return null;
}

export function getAuth() {
  // No-op: Auth instance no longer exists in router
  console.warn('getAuth() is deprecated. Auth is now handled by the backend.');
  return null;
}

export async function closeAuth() {
  // No-op: No auth resources to close in router
  return;
}
