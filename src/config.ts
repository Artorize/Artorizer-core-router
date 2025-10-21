import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  port: z.coerce.number().default(7000),
  host: z.string().default('127.0.0.1'),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  workers: z.coerce.number().default(4),

  redis: z.object({
    host: z.string().default('localhost'),
    port: z.coerce.number().default(6379),
    password: z.string().optional(),
  }),

  processor: z.object({
    url: z.string().default('http://localhost:8000'),
    timeout: z.coerce.number().default(30000),
  }),

  backend: z.object({
    url: z.string().default('http://localhost:3000'),
    timeout: z.coerce.number().default(30000),
  }),

  router: z.object({
    baseUrl: z.string().default('http://localhost:7000'),
    callbackAuthToken: z.string().default('default-insecure-token-change-me'),
  }),

  rateLimit: z.object({
    max: z.coerce.number().default(100),
    window: z.coerce.number().default(60000),
  }),

  upload: z.object({
    maxFileSize: z.coerce.number().default(256 * 1024 * 1024), // 256MB
  }),
});

export const config = configSchema.parse({
  port: process.env.PORT,
  host: process.env.HOST,
  nodeEnv: process.env.NODE_ENV,
  workers: process.env.WORKERS,

  redis: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    password: process.env.REDIS_PASSWORD,
  },

  processor: {
    url: process.env.PROCESSOR_URL,
    timeout: process.env.PROCESSOR_TIMEOUT,
  },

  backend: {
    url: process.env.BACKEND_URL,
    timeout: process.env.BACKEND_TIMEOUT,
  },

  router: {
    baseUrl: process.env.ROUTER_BASE_URL,
    callbackAuthToken: process.env.CALLBACK_AUTH_TOKEN,
  },

  rateLimit: {
    max: process.env.RATE_LIMIT_MAX,
    window: process.env.RATE_LIMIT_WINDOW,
  },

  upload: {
    maxFileSize: process.env.MAX_FILE_SIZE,
  },
});

export type Config = z.infer<typeof configSchema>;
