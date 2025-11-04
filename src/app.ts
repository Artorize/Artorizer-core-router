import Fastify, { FastifyInstance } from 'fastify';
import cors from '@fastify/cors';
import multipart from '@fastify/multipart';
import { config } from './config';
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

  // CORS
  await app.register(cors, {
    origin: true,
    credentials: true,
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
