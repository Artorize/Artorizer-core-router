import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { config } from './config';
import { protectRoute } from './routes/protect';
import { callbackRoute } from './routes/callback';
import { jobsRoute } from './routes/jobs';
import { healthRoute } from './routes/health';
import { authRoute } from './routes/auth';

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

  // CORS - configure allowed origins for auth
  const allowedOrigins = config.auth.enabled
    ? config.auth.allowedOrigins.split(',').map((origin) => origin.trim())
    : [];

  await app.register(cors, {
    origin: config.auth.enabled
      ? (origin, callback) => {
          // Allow all origins if "*" is in the allowed list
          if (allowedOrigins.includes('*')) {
            callback(null, true);
          } else if (!origin || allowedOrigins.includes(origin)) {
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

  // Register routes
  app.register(healthRoute);
  app.register(protectRoute);
  app.register(callbackRoute);
  app.register(jobsRoute);

  // Register auth proxy routes if enabled
  if (config.auth.enabled) {
    app.register(authRoute, { prefix: '/api' });
    app.log.info('Authentication proxy routes registered (delegating to backend)');
  } else {
    // Log warning when auth is disabled
    if (config.nodeEnv === 'production') {
      app.log.warn(
        '⚠️  AUTH_ENABLED=false in production! All requests will be unauthenticated. ' +
        'Set AUTH_ENABLED=true and configure backend auth to enable user authentication.'
      );
    } else {
      app.log.info('Authentication disabled (AUTH_ENABLED=false). Running in anonymous mode.');
    }
  }

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
    await app.close();
  } catch (error) {
    app.log.error({ error }, 'Error during shutdown');
    process.exit(1);
  }
}
