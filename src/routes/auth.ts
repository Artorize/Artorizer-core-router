import { FastifyInstance } from 'fastify';
import { config } from '../config.js';

/**
 * Auth Proxy Routes
 *
 * Lightweight proxy handlers that forward all /auth/* requests to the backend.
 * The backend owns all authentication logic (session management, user storage, etc).
 * Router simply forwards requests and passes through cookies/headers transparently.
 *
 * Aligned with AUTH_ALIGNMENT.md contract.
 */

interface RegisterBody {
  email: string;
  password: string;
  username: string;
  name?: string;
}

interface LoginBody {
  emailOrUsername: string;
  password: string;
}

export async function authRoute(app: FastifyInstance) {
  /**
   * POST /auth/register
   * Forward registration to backend, pass through session cookie
   */
  app.post<{ Body: RegisterBody }>('/auth/register', async (request, reply) => {
    try {
      // Transform to Better Auth format: sign-up/email expects { email, password, name }
      const betterAuthBody = {
        email: request.body.email,
        password: request.body.password,
        name: request.body.name || request.body.username,
      };

      const response = await fetch(`${config.backend.url}/auth/sign-up/email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': request.ip,
          'X-Request-Id': request.id,
        },
        body: JSON.stringify(betterAuthBody),
      });

      // Extract all cookies from backend response (getSetCookie returns array)
      const setCookieHeaders = response.headers.getSetCookie?.() || [];

      // Forward status code
      reply.status(response.status);

      // Forward all cookies (Better Auth may set multiple)
      for (const cookie of setCookieHeaders) {
        reply.header('set-cookie', cookie);
      }

      // Forward other headers if needed
      const contentType = response.headers.get('content-type');
      if (contentType) {
        reply.header('content-type', contentType);
      }

      // Parse and send response body
      const responseData = await response.json();
      return reply.send(responseData);
    } catch (error) {
      request.log.error({ error }, 'Failed to proxy register request to backend');
      return reply.status(500).send({
        error: 'server_error',
        message: 'Failed to process registration request',
      });
    }
  });

  /**
   * POST /auth/login
   * Forward login to backend, pass through session cookie
   */
  app.post<{ Body: LoginBody }>('/auth/login', async (request, reply) => {
    try {
      // Transform to Better Auth format: sign-in/email expects { email, password }
      const betterAuthBody = {
        email: request.body.emailOrUsername,
        password: request.body.password,
      };

      const response = await fetch(`${config.backend.url}/auth/sign-in/email`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'X-Forwarded-For': request.ip,
          'X-Request-Id': request.id,
        },
        body: JSON.stringify(betterAuthBody),
      });

      // Extract all cookies from backend response (getSetCookie returns array)
      const setCookieHeaders = response.headers.getSetCookie?.() || [];

      // Forward status code
      reply.status(response.status);

      // Forward all cookies (Better Auth may set multiple)
      for (const cookie of setCookieHeaders) {
        reply.header('set-cookie', cookie);
      }

      // Forward content type
      const contentType = response.headers.get('content-type');
      if (contentType) {
        reply.header('content-type', contentType);
      }

      // Parse and send response body
      const responseData = await response.json();
      return reply.send(responseData);
    } catch (error) {
      request.log.error({ error }, 'Failed to proxy login request to backend');
      return reply.status(500).send({
        error: 'server_error',
        message: 'Failed to process login request',
      });
    }
  });

  /**
   * POST /auth/logout
   * Forward logout to backend, clear session cookie
   */
  app.post('/auth/logout', async (request, reply) => {
    try {
      // Forward session cookie to backend
      const cookieHeader = request.headers.cookie;

      const headers: Record<string, string> = {
        'X-Forwarded-For': request.ip,
        'X-Request-Id': request.id,
      };

      if (cookieHeader) {
        headers['Cookie'] = cookieHeader;
      }

      // Forward Origin header for CSRF protection in Better Auth
      const originHeader = request.headers.origin;
      if (originHeader) {
        headers['Origin'] = originHeader;
      }

      const response = await fetch(`${config.backend.url}/auth/sign-out`, {
        method: 'POST',
        headers,
      });

      // Extract all cookies from backend response (should clear cookies)
      const setCookieHeaders = response.headers.getSetCookie?.() || [];

      // Forward status code
      reply.status(response.status);

      // Forward all cookies
      for (const cookie of setCookieHeaders) {
        reply.header('set-cookie', cookie);
      }

      // 204 No Content doesn't have a body
      if (response.status === 204) {
        return reply.send();
      }

      // For other status codes, try to parse body
      const contentType = response.headers.get('content-type');
      if (contentType?.includes('application/json')) {
        const responseData = await response.json();
        return reply.send(responseData);
      }

      return reply.send();
    } catch (error) {
      request.log.error({ error }, 'Failed to proxy logout request to backend');
      return reply.status(500).send({
        error: 'server_error',
        message: 'Failed to process logout request',
      });
    }
  });

  /**
   * GET /auth/me
   * Get current user from session
   */
  app.get('/auth/me', async (request, reply) => {
    try {
      // Forward session cookie to backend
      const cookieHeader = request.headers.cookie;

      const headers: Record<string, string> = {
        'X-Forwarded-For': request.ip,
        'X-Request-Id': request.id,
      };

      if (cookieHeader) {
        headers['Cookie'] = cookieHeader;
      }

      const response = await fetch(`${config.backend.url}/auth/get-session`, {
        method: 'GET',
        headers,
      });

      // Forward status code
      reply.status(response.status);

      // Forward content type
      const contentType = response.headers.get('content-type');
      if (contentType) {
        reply.header('content-type', contentType);
      }

      // Parse and send response body
      const responseData = await response.json();
      return reply.send(responseData);
    } catch (error) {
      request.log.error({ error }, 'Failed to proxy /auth/me request to backend');
      return reply.status(500).send({
        error: 'server_error',
        message: 'Failed to retrieve user information',
      });
    }
  });

  /**
   * GET /auth/check-availability
   * Check if email/username is available (no auth required)
   */
  app.get<{ Querystring: { email?: string; username?: string } }>(
    '/auth/check-availability',
    async (request, reply) => {
      try {
        const { email, username } = request.query;

        // Build query string
        const params = new URLSearchParams();
        if (email) params.append('email', email);
        if (username) params.append('username', username);

        const url = `${config.backend.url}/auth/check-availability?${params.toString()}`;

        const response = await fetch(url, {
          method: 'GET',
          headers: {
            'X-Forwarded-For': request.ip,
            'X-Request-Id': request.id,
          },
        });

        // Forward status code
        reply.status(response.status);

        // Forward content type
        const contentType = response.headers.get('content-type');
        if (contentType) {
          reply.header('content-type', contentType);
        }

        // Parse and send response body
        const responseData = await response.json();
        return reply.send(responseData);
      } catch (error) {
        request.log.error({ error }, 'Failed to proxy check-availability request to backend');
        return reply.status(500).send({
          error: 'server_error',
          message: 'Failed to check availability',
        });
      }
    }
  );

  /**
   * GET /auth/oauth/:provider/start
   * Initiate OAuth with provider (google|github)
   */
  app.get('/auth/oauth/:provider/start', async (request, reply) => {
    const { provider } = request.params as { provider: string };
    try {
      const response = await fetch(`${config.backend.url}/auth/oauth/${provider}/start`, {
        method: 'GET',
        headers: {
          'X-Forwarded-For': request.ip,
          'X-Request-Id': request.id,
        },
        redirect: 'manual',
      });

      // Forward PKCE/nonce cookies set during OAuth initiation
      const setCookieHeaders = response.headers.getSetCookie?.() || [];
      for (const cookie of setCookieHeaders) {
        reply.header('set-cookie', cookie);
      }

      // Proxy redirect location
      const location = response.headers.get('location');
      if (location) {
        reply.header('location', location);
      }
      reply.status(response.status);
      return reply.send();
    } catch (error) {
      request.log.error({ error }, 'Failed to proxy OAuth start');
      return reply.status(500).send({
        error: 'server_error',
        message: 'Failed to start OAuth flow',
      });
    }
  });

  /**
   * GET /auth/oauth/:provider/callback
   * Handle OAuth callback and pass cookies through
   */
  app.get('/auth/oauth/:provider/callback', async (request, reply) => {
    try {
      const url = `${config.backend.url}${request.raw.url}`;
      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Forwarded-For': request.ip,
          'X-Request-Id': request.id,
          Cookie: request.headers.cookie || '',
        },
        redirect: 'manual',
      });

      // Extract all cookies (OAuth may set session + PKCE/nonce cookies)
      const setCookieHeaders = response.headers.getSetCookie?.() || [];
      for (const cookie of setCookieHeaders) {
        reply.header('set-cookie', cookie);
      }

      const location = response.headers.get('location');
      if (location) {
        reply.header('location', location);
      }

      reply.status(response.status);
      if (response.status >= 300 && response.status < 400) {
        return reply.send();
      }

      const contentType = response.headers.get('content-type');
      if (contentType) reply.header('content-type', contentType);
      const body = await response.text();
      return reply.send(body);
    } catch (error) {
      request.log.error({ error }, 'Failed to proxy OAuth callback');
      return reply.status(500).send({
        error: 'server_error',
        message: 'Failed to complete OAuth flow',
      });
    }
  });
}
