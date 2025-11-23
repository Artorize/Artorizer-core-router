import { FastifyRequest, FastifyReply } from 'fastify';
import { getAuth } from '../auth.js';
import { config } from '../config.js';

export interface AuthUser {
  id: string;
  email: string;
  name?: string;
  image?: string;
  emailVerified: boolean;
  createdAt: string;
}

export interface AuthSession {
  token: string;
  expiresAt: string;
}

// Extend Fastify request type to include user and session
declare module 'fastify' {
  interface FastifyRequest {
    user?: AuthUser;
    session?: AuthSession;
  }
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

  try {
    const auth = getAuth();
    if (!auth) {
      // Auth disabled, allow request
      return;
    }

    // Better Auth will validate session from cookie
    const session = await auth.api.getSession({
      headers: request.headers as Record<string, string>,
    });

    if (!session || !session.user) {
      return reply.status(401).send({
        error: 'Unauthorized',
        message: 'Authentication required',
        code: 'AUTH_REQUIRED',
      });
    }

    // Attach user and session to request
    request.user = {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? undefined,
      image: session.user.image ?? undefined,
      emailVerified: session.user.emailVerified,
      createdAt: session.user.createdAt instanceof Date
        ? session.user.createdAt.toISOString()
        : session.user.createdAt,
    };

    request.session = {
      token: session.session.token,
      expiresAt: session.session.expiresAt instanceof Date
        ? session.session.expiresAt.toISOString()
        : session.session.expiresAt,
    };
  } catch (error) {
    request.log.error({ error }, 'Auth middleware error');
    return reply.status(401).send({
      error: 'Unauthorized',
      message: 'Invalid session',
      code: 'INVALID_SESSION',
    });
  }
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

  try {
    const auth = getAuth();
    if (!auth) {
      return;
    }

    // Try to get session, but don't fail if it doesn't exist
    const session = await auth.api.getSession({
      headers: request.headers as Record<string, string>,
    });

    if (session && session.user) {
      request.user = {
        id: session.user.id,
        email: session.user.email,
        name: session.user.name ?? undefined,
        image: session.user.image ?? undefined,
        emailVerified: session.user.emailVerified,
        createdAt: session.user.createdAt instanceof Date
          ? session.user.createdAt.toISOString()
          : session.user.createdAt,
      };

      request.session = {
        token: session.session.token,
        expiresAt: session.session.expiresAt instanceof Date
          ? session.session.expiresAt.toISOString()
          : session.session.expiresAt,
      };
    }
  } catch (error) {
    // Silent fail - optional auth doesn't block the request
    request.log.debug({ error }, 'Optional auth failed');
  }
}
