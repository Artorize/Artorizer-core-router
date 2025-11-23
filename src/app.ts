import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { config } from './config';
import { initializeAuth, getAuth, closeAuth } from './auth';
import { protectRoute } from './routes/protect';
import { callbackRoute } from './routes/callback';
import { jobsRoute } from './routes/jobs';
import { healthRoute } from './routes/health';

export async function buildApp(): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: config.nodeEnv === 'production' ? 'info' : 'debug',
      formatters: {
        level: (label) => ({ level: label }),
      },
      timestamp: () => `,"time":"${new Date().toISOString()}"`,
      transport:
        config.nodeEnv === 'development'
          ? {
              target: 'pino-pretty',
              options: {
                colorize: true,
                translateTime: 'HH:MM:ss',
                ignore: 'pid,hostname',
              },
            }
          : undefined,
    },
    requestIdLogLabel: 'reqId',
    disableRequestLogging: false,
    trustProxy: true,
  });

  // Initialize authentication if enabled
  if (config.auth.enabled) {
    try {
      initializeAuth();
      app.log.info('Better Auth initialized successfully');
    } catch (error) {
      app.log.error({ error }, 'Failed to initialize Better Auth');
      throw error;
    }
  }

  // CORS - configure allowed origins for auth
  const allowedOrigins = config.auth.enabled
    ? config.auth.allowedOrigins.split(',').map((origin) => origin.trim())
    : [];

  await app.register(cors, {
    origin: config.auth.enabled
      ? (origin, callback) => {
          if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
          } else {
            callback(new Error('Not allowed by CORS'), false);
          }
        }
      : true,
    credentials: true, // Important: Allow cookies to be sent
  });

  // Multipart file upload
  await app.register(multipart, {
    limits: {
      fileSize: config.upload.maxFileSize,
      files: 1,
    },
    attachFieldsToBody: true,
  });

  // Mount Better Auth handler if enabled
  if (config.auth.enabled) {
    app.all('/api/auth/*', async (request, reply) => {
      const auth = getAuth();
      if (!auth) {
        return reply.status(503).send({
          error: 'Authentication service not available',
        });
      }

      try {
        // Better Auth expects Web API Request/Response objects
        // Convert Fastify request to a format Better Auth can handle
        const url = new URL(request.url, config.auth.baseUrl);
        const method = request.method;
        const headers = new Headers(request.headers as Record<string, string>);

        let body: any = undefined;
        if (method !== 'GET' && method !== 'HEAD') {
          if (request.headers['content-type']?.includes('application/json')) {
            body = JSON.stringify(request.body);
          } else if (request.headers['content-type']?.includes('application/x-www-form-urlencoded')) {
            body = new URLSearchParams(request.body as any).toString();
          }
        }

        const webRequest = new Request(url.toString(), {
          method,
          headers,
          body,
        });

        // Call Better Auth handler
        const response = await auth.handler(webRequest);

        // Convert Response to Fastify reply
        reply.status(response.status);

        response.headers.forEach((value, key) => {
          reply.header(key, value);
        });

        const responseBody = await response.text();

        // If it's JSON, parse and send as JSON
        if (response.headers.get('content-type')?.includes('application/json')) {
          return reply.send(JSON.parse(responseBody));
        }

        return reply.send(responseBody);
      } catch (error) {
        request.log.error({ error }, 'Better Auth handler error');
        return reply.status(500).send({
          error: 'Authentication error',
        });
      }
    });
  }

  // Register routes
  app.register(healthRoute);
  app.register(protectRoute);
  app.register(callbackRoute);
  app.register(jobsRoute);

  // Error handler
  app.setErrorHandler((error, request, reply) => {
    request.log.error(error);

    const statusCode = (error as any).statusCode || 500;
    const message = statusCode === 500 ? 'Internal server error' : error.message;

    reply.status(statusCode).send({
      error: message,
      statusCode,
    });
  });

  // Not found handler
  app.setNotFoundHandler((_, reply) => {
    reply.status(404).send({
      error: 'Route not found',
      statusCode: 404,
    });
  });

  return app;
}

// Graceful shutdown
export async function closeApp(app: FastifyInstance): Promise<void> {
  try {
    // Close auth connection pool if enabled
    if (config.auth.enabled) {
      await closeAuth();
      app.log.info('Auth connection pool closed');
    }
    await app.close();
  } catch (error) {
    app.log.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
}
