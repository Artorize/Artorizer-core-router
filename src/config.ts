import dotenv from 'dotenv';
import { z } from 'zod';

dotenv.config();

const configSchema = z.object({
  port: z.coerce.number().default(7000),
  nodeEnv: z.enum(['development', 'production', 'test']).default('development'),
  workers: z.coerce.number().default(4),

  mongodb: z.object({
    uri: z.string().default('mongodb://localhost:27017/artorizer_storage'),
  }),

  redis: z.object({
    host: z.string().default('localhost'),
    port: z.coerce.number().default(6379),
    password: z.string().optional(),
  }),

  processor: z.object({
    url: z.string().default('http://localhost:8000'),
    timeout: z.coerce.number().default(30000),
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
  nodeEnv: process.env.NODE_ENV,
  workers: process.env.WORKERS,

  mongodb: {
    uri: process.env.MONGODB_URI,
  },

  redis: {
    host: process.env.REDIS_HOST,
    port: process.env.REDIS_PORT,
    password: process.env.REDIS_PASSWORD,
  },

  processor: {
    url: process.env.PROCESSOR_URL,
    timeout: process.env.PROCESSOR_TIMEOUT,
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
