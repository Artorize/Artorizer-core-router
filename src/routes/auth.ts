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
    const startTime = Date.now();
    const { provider } = request.params as { provider: string };

    request.log.info(
      {
        provider,
        backendUrl: config.backend.url,
        clientIp: request.ip,
        requestId: request.id,
      },
      '[OAUTH-START-ROUTER] OAuth start initiated'
    );

    try {
      const backendUrl = `${config.backend.url}/auth/oauth/${provider}/start`;

      request.log.info(
        { provider, backendUrl },
        '[OAUTH-START-ROUTER] Calling backend OAuth start'
      );

      const response = await fetch(backendUrl, {
        method: 'GET',
        headers: {
          'X-Forwarded-For': request.ip,
          'X-Request-Id': request.id,
        },
        redirect: 'manual',
      });

      // Forward PKCE/nonce cookies set during OAuth initiation
      const setCookieHeaders = response.headers.getSetCookie?.() || [];

      request.log.info(
        {
          provider,
          status: response.status,
          cookieCount: setCookieHeaders.length,
          cookieNames: setCookieHeaders.map(c => c.split('=')[0]),
          hasLocation: !!response.headers.get('location'),
          duration: Date.now() - startTime,
        },
        '[OAUTH-START-ROUTER] Backend response received'
      );

      for (const cookie of setCookieHeaders) {
        request.log.debug({ cookie: cookie.split(';')[0] }, '[OAUTH-START-ROUTER] Setting cookie');
        reply.header('set-cookie', cookie);
      }

      // Proxy redirect location
      const location = response.headers.get('location');
      if (location) {
        request.log.info(
          { provider, location },
          '[OAUTH-START-ROUTER] Redirecting to OAuth provider'
        );
        reply.header('location', location);
      }
      reply.status(response.status);
      return reply.send();
    } catch (error) {
      request.log.error(
        {
          provider,
          error: (error as Error).message,
          stack: (error as Error).stack,
          duration: Date.now() - startTime,
        },
        '[OAUTH-START-ROUTER] Failed to proxy OAuth start'
      );
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

  /**
   * GET /auth/callback/:provider
   * Handle Better Auth OAuth callback (standard path used by Better Auth)
   */
  app.get('/auth/callback/:provider', async (request, reply) => {
    const startTime = Date.now();
    const provider = (request.params as any).provider;

    request.log.info(
      {
        provider,
        url: request.raw.url,
        hasCookies: !!request.headers.cookie,
        backendUrl: config.backend.url,
        query: request.query,
      },
      '[OAUTH-CALLBACK] Incoming OAuth callback from provider'
    );

    try {
      const url = `${config.backend.url}${request.raw.url}`;

      request.log.info(
        { provider, backendUrl: url },
        '[OAUTH-CALLBACK] Proxying callback to backend'
      );

      const response = await fetch(url, {
        method: 'GET',
        headers: {
          'X-Forwarded-For': request.ip,
          'X-Request-Id': request.id,
          Cookie: request.headers.cookie || '',
        },
        redirect: 'manual',
      });

      request.log.info(
        {
          provider,
          status: response.status,
          hasLocation: !!response.headers.get('location'),
          setCookies: (response.headers.getSetCookie?.() || []).length,
        },
        '[OAUTH-CALLBACK] Backend response received'
      );

      // Extract all cookies (OAuth session + PKCE/nonce cookies)
      const setCookieHeaders = response.headers.getSetCookie?.() || [];
      request.log.info(
        {
          provider,
          cookieCount: setCookieHeaders.length,
          cookieNames: setCookieHeaders.map(c => c.split('=')[0]),
          duration: Date.now() - startTime
        },
        '[OAUTH-CALLBACK] Setting cookies in response'
      );

      for (const cookie of setCookieHeaders) {
        reply.header('set-cookie', cookie);
      }

      const location = response.headers.get('location');
      if (location) {
        request.log.info(
          { provider, location, status: response.status },
          '[OAUTH-CALLBACK] Redirecting to location'
        );
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
      request.log.error(
        {
          provider,
          error: (error as Error).message,
          stack: (error as Error).stack,
          duration: Date.now() - startTime
        },
        '[OAUTH-CALLBACK] Failed to proxy OAuth callback'
      );
      return reply.status(500).send({
        error: 'server_error',
        message: 'Failed to complete OAuth flow',
      });
    }
  });

  /**
   * GET /auth/error
   * Handle OAuth errors from Better Auth (state_mismatch, invalid_grant, etc.)
   * Returns user-friendly error page
   */
  app.get('/auth/error', async (request, reply) => {
    const { error, error_description } = request.query as { error?: string; error_description?: string };

    const errorMessages: Record<string, string> = {
      state_mismatch: 'The authentication state does not match. Your session may have expired. Please try again.',
      invalid_grant: 'The authentication code is invalid or expired. Please try again.',
      access_denied: 'You denied access to the application. Please try again.',
      server_error: 'An authentication server error occurred. Please try again later.',
      temporarily_unavailable: 'The authentication service is temporarily unavailable. Please try again later.',
    };

    const message = errorMessages[error as string] || error_description || 'An authentication error occurred. Please try again.';

    // Return user-friendly HTML error page
    reply.header('content-type', 'text/html; charset=utf-8');
    return reply.send(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Authentication Error</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif;
            background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
            min-height: 100vh;
            display: flex;
            align-items: center;
            justify-content: center;
            padding: 20px;
          }
          .container {
            background: white;
            border-radius: 8px;
            box-shadow: 0 10px 40px rgba(0, 0, 0, 0.1);
            padding: 40px;
            max-width: 500px;
            text-align: center;
          }
          .error-icon {
            font-size: 48px;
            margin-bottom: 20px;
          }
          h1 {
            color: #333;
            font-size: 24px;
            margin-bottom: 16px;
          }
          .error-code {
            color: #667eea;
            font-size: 14px;
            font-weight: 600;
            text-transform: uppercase;
            letter-spacing: 1px;
            margin-bottom: 16px;
          }
          p {
            color: #666;
            font-size: 16px;
            line-height: 1.6;
            margin-bottom: 24px;
          }
          .actions {
            display: flex;
            gap: 12px;
            justify-content: center;
            flex-wrap: wrap;
          }
          button, a {
            padding: 12px 24px;
            border-radius: 6px;
            font-size: 14px;
            font-weight: 600;
            text-decoration: none;
            border: none;
            cursor: pointer;
            transition: all 0.3s ease;
          }
          .btn-primary {
            background: #667eea;
            color: white;
          }
          .btn-primary:hover {
            background: #5568d3;
            transform: translateY(-2px);
            box-shadow: 0 4px 12px rgba(102, 126, 234, 0.4);
          }
          .btn-secondary {
            background: #f0f0f0;
            color: #333;
          }
          .btn-secondary:hover {
            background: #e0e0e0;
            transform: translateY(-2px);
          }
          .details {
            margin-top: 24px;
            padding-top: 24px;
            border-top: 1px solid #eee;
            font-size: 12px;
            color: #999;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="error-icon">⚠️</div>
          <div class="error-code">${error || 'error'}</div>
          <h1>Authentication Failed</h1>
          <p>${message}</p>
          <div class="actions">
            <button class="btn-primary" onclick="retryAuth()">Try Again</button>
            <a href="/" class="btn-secondary">Go Home</a>
          </div>
          <div class="details">
            ${error ? `<div>Error code: <code>${error}</code></div>` : ''}
            <div>If this problem persists, please contact support.</div>
          </div>
        </div>
        <script>
          function retryAuth() {
            window.history.back();
          }
        </script>
      </body>
      </html>
    `);
  });
}
