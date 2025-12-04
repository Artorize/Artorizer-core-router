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

  /**
   * Special handler for OAuth callbacks (/auth/callback/*)
   * After OAuth provider redirects to the callback endpoint, Better Auth on backend
   * creates the session. We then redirect the user back to the frontend (artorizer.com)
   * instead of staying on the API gateway (router.artorizer.com).
   */
  const callbackHandler = async (request: any, reply: any) => {
    request.log.debug({ url: request.raw.url }, '[CALLBACK] Processing OAuth callback');
    try {
      const backendUrl = `${config.backend.url}${request.raw.url}`;

      // Prepare headers - forward all incoming headers plus trace headers
      const headers: Record<string, string> = {
        'X-Forwarded-For': request.ip,
        'X-Request-Id': request.id,
      };

      // Forward cookie header if present (critical for OAuth state/PKCE verification)
      if (request.headers.cookie) {
        headers['Cookie'] = request.headers.cookie;
      }

      // Forward origin header if present (needed for CSRF protection)
      if (request.headers.origin) {
        headers['Origin'] = request.headers.origin;
      }

      // Proxy callback to backend
      const response = await fetch(backendUrl, {
        method: request.method,
        headers,
        redirect: 'manual',
      });

      // Forward all Set-Cookie headers (Better Auth sets session cookie here)
      const setCookieHeaders = response.headers.getSetCookie?.() || [];
      for (const cookie of setCookieHeaders) {
        reply.header('set-cookie', cookie);
      }

      // If backend returns a redirect, intercept it and redirect to frontend instead
      const backendLocation = response.headers.get('location');

      // Handle successful redirects (3xx)
      if (response.status >= 300 && response.status < 400 && backendLocation) {
        // Parse the location URL to extract the target path
        // Backend might redirect to /auth/callback/success or with error query params
        // We want to redirect the user back to the frontend dashboard
        try {
          const urlObj = new URL(backendLocation, `${config.backend.url}`);
          const search = urlObj.search;

          // Check if callback was successful (no error query params)
          if (!search.includes('error')) {
            // Redirect to frontend login page with success flag - login page handles session check and dashboard redirect
            return reply.redirect(`https://artorizer.com/auth/login.html?auth=success`);
          } else {
            // Redirect to frontend login page with error params
            return reply.redirect(`https://artorizer.com/auth/login.html${search}`);
          }
        } catch {
          // If URL parsing fails, redirect to frontend home
          return reply.redirect(`https://artorizer.com`);
        }
      }

      // Handle error responses (4xx, 5xx) - redirect to frontend login page with error
      if (response.status >= 400) {
        const errorCode = response.status === 401 ? 'unauthorized' : 'server_error';
        request.log.warn(
          { status: response.status, url: request.raw.url },
          'OAuth callback failed with error status'
        );
        return reply.redirect(`https://artorizer.com/auth/login.html?error=${errorCode}`);
      }

      // For 2xx responses without redirect, set response status and return content
      reply.status(response.status);
      const contentType = response.headers.get('content-type');
      if (contentType) {
        reply.header('content-type', contentType);
      }
      const responseBody = await response.text();
      return reply.send(responseBody);
    } catch (error) {
      request.log.error(
        {
          error: (error as Error).message,
          stack: (error as Error).stack,
          url: request.raw.url,
        },
        'Failed to process OAuth callback'
      );
      return reply.redirect(`https://artorizer.com/auth/login.html?error=server_error`);
    }
  };

  /**
   * Transparent catch-all proxy for remaining /auth/* routes
   * Handles all Better Auth routes not explicitly defined above (OAuth flows, callbacks, etc.)
   * Forwards all headers, cookies, and redirects transparently to backend
   */

  // Helper function to proxy requests to backend
  const proxyAuthHandler = async (request: any, reply: any) => {
    request.log.debug({ url: request.raw.url, method: request.method }, '[PROXY] Auth request to backend');
    try {
      const backendUrl = `${config.backend.url}${request.raw.url}`;

      // Prepare headers - forward all incoming headers plus trace headers
      const headers: Record<string, string> = {
        'X-Forwarded-For': request.ip,
        'X-Request-Id': request.id,
      };

      // Forward cookie header if present (critical for OAuth state/PKCE verification)
      if (request.headers.cookie) {
        headers['Cookie'] = request.headers.cookie;
      }

      // Forward origin header if present (needed for CSRF protection)
      if (request.headers.origin) {
        headers['Origin'] = request.headers.origin;
      }

      // Forward content-type for POST/PUT/PATCH requests
      if (request.headers['content-type']) {
        headers['Content-Type'] = request.headers['content-type'];
      }

      // Prepare request body for non-GET/HEAD requests
      let body: string | undefined;
      if (request.method !== 'GET' && request.method !== 'HEAD') {
        // For POST/PUT/PATCH, forward request body as JSON string
        body = JSON.stringify(request.body);
      }

      // Proxy request to backend with manual redirect handling
      const response = await fetch(backendUrl, {
        method: request.method,
        headers,
        body,
        redirect: 'manual', // Don't follow redirects - return them to client
      });

      // Forward all Set-Cookie headers (Better Auth may set multiple cookies)
      const setCookieHeaders = response.headers.getSetCookie?.() || [];
      for (const cookie of setCookieHeaders) {
        reply.header('set-cookie', cookie);
      }

      // Forward redirect location if present
      const location = response.headers.get('location');
      if (location) {
        reply.header('location', location);
      }

      // Forward content-type
      const contentType = response.headers.get('content-type');
      if (contentType) {
        reply.header('content-type', contentType);
      }

      // Set response status
      reply.status(response.status);

      // For redirects (3xx), send empty body
      if (response.status >= 300 && response.status < 400) {
        return reply.send();
      }

      // For other responses, forward body as-is
      const responseBody = await response.text();
      return reply.send(responseBody);
    } catch (error) {
      request.log.error(
        {
          error: (error as Error).message,
          stack: (error as Error).stack,
          url: request.raw.url,
          method: request.method,
        },
        'Failed to proxy auth request to backend'
      );
      return reply.status(500).send({
        error: 'server_error',
        message: 'Failed to process authentication request',
      });
    }
  };

  // Register callback handler BEFORE catch-all routes (more specific routes first)
  // This handles OAuth redirects from Google/GitHub back to the callback endpoint
  app.get('/auth/callback/:provider', callbackHandler);
  app.post('/auth/callback/:provider', callbackHandler);

  // Register catch-all routes for all other /auth/* paths
  app.get('/auth/*', proxyAuthHandler);
  app.post('/auth/*', proxyAuthHandler);
  app.put('/auth/*', proxyAuthHandler);
  app.patch('/auth/*', proxyAuthHandler);
  app.delete('/auth/*', proxyAuthHandler);
  // Note: HEAD routes are automatically generated by Fastify for all GET routes,
  // so we don't need to explicitly register app.head('/auth/*', ...)
}
