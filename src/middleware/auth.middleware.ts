import { FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config.js';

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  username?: string;
}

export interface AuthSession {
  id: string;
  expiresAt: string;
}

// Extend Fastify request type to include user and session
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
    session?: AuthSession;
  }
}

// Use a symbol to cache a single /auth/me call per request
const AUTH_CACHE_KEY = Symbol('authCache');

/**
 * Validate session with backend /auth/session endpoint (Better Auth default).
 * Caches the result on the request to avoid multiple roundtrips per request.
 */
async function validateSession(
  request: FastifyRequest
): Promise<{ user: AuthUser; session: AuthSession } | null> {
  // If a previous middleware already resolved auth, reuse it
  if (request.user && request.session) {
    return { user: request.user, session: request.session };
  }

  const cached = (request as any)[AUTH_CACHE_KEY];
  if (cached) {
    return cached;
  }

  const cookieHeader = request.headers.cookie;
  if (!cookieHeader) {
    (request as any)[AUTH_CACHE_KEY] = null;
    return null;
  }

  const headers: Record<string, string> = {
    Cookie: cookieHeader,
    'X-Forwarded-For': request.ip,
    'X-Request-Id': request.id,
  };

  const fetchPromise = (async () => {
    try {
      const response = await fetch(`${config.backend.url}/auth/get-session`, {
        method: 'GET',
        headers,
      });

      if (!response.ok) {
        return null;
      }

      const data = (await response.json()) as any;
      if (!data.user || !data.session) {
        return null;
      }

      return {
        user: {
          id: data.user.id,
          email: data.user.email,
          username: data.user.username,
          name: data.user.name,
        },
        session: {
          id: data.session.id,
          expiresAt: data.session.expiresAt,
        },
      };
    } catch (error) {
      request.log.debug({ error }, 'Session validation failed');
      return null;
    }
  })();

  (request as any)[AUTH_CACHE_KEY] = fetchPromise;
  const result = await fetchPromise;
  (request as any)[AUTH_CACHE_KEY] = result;
  return result;
}

/**
 * Middleware to require authentication on a route
 * Returns 401 if no valid session is found
 */
export async function requireAuth(
  request: FastifyRequest,
  reply: FastifyReply
): Promise<void> {
  // Skip auth check if auth is disabled
  if (!config.auth.enabled) {
    return;
  }

  const sessionData = await validateSession(request);

  if (!sessionData) {
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Authentication required',
      code: 'AUTH_REQUIRED',
    });
  }

  // Attach user and session to request
  request.user = sessionData.user;
  request.session = sessionData.session;
}

/**
 * Middleware to optionally attach user if authenticated
 * Does not require authentication, but attaches user if session exists
 */
export async function optionalAuth(
  request: FastifyRequest
): Promise<void> {
  // Skip if auth is disabled
  if (!config.auth.enabled) {
    return;
  }

  const sessionData = await validateSession(request);

  if (sessionData) {
    request.user = sessionData.user;
    request.session = sessionData.session;
  }
}
