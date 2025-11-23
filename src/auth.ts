import { betterAuth } from 'better-auth';
import { Pool } from 'pg';
import { config } from './config.js';

// Only initialize auth if enabled
let authInstance: ReturnType<typeof betterAuth> | null = null;
let pool: Pool | null = null;

export function initializeAuth() {
  if (!config.auth.enabled) {
    return null;
  }

  // Validate required configuration
  if (!config.auth.secret) {
    throw new Error('BETTER_AUTH_SECRET is required when AUTH_ENABLED=true');
  }

  if (!config.auth.baseUrl) {
    throw new Error('BETTER_AUTH_URL is required when AUTH_ENABLED=true');
  }

  // Create PostgreSQL connection pool
  pool = new Pool({
    host: config.database.host,
    port: config.database.port,
    user: config.database.user,
    password: config.database.password,
    database: config.database.name,
  });

  // Parse allowed origins for CORS
  const allowedOrigins = config.auth.allowedOrigins
    .split(',')
    .map((origin) => origin.trim());

  // Configure social providers only if credentials are provided
  const socialProviders: Record<string, any> = {};

  if (config.auth.google.clientId && config.auth.google.clientSecret) {
    socialProviders.google = {
      clientId: config.auth.google.clientId,
      clientSecret: config.auth.google.clientSecret,
    };
  }

  if (config.auth.github.clientId && config.auth.github.clientSecret) {
    socialProviders.github = {
      clientId: config.auth.github.clientId,
      clientSecret: config.auth.github.clientSecret,
    };
  }

  // Initialize Better Auth
  authInstance = betterAuth({
    database: {
      type: 'postgres',
      pool,
    },

    secret: config.auth.secret,
    baseURL: config.auth.baseUrl,
    trustedOrigins: allowedOrigins,

    socialProviders: Object.keys(socialProviders).length > 0 ? socialProviders : undefined,

    session: {
      expiresIn: 60 * 60 * 24 * 7, // 7 days
      updateAge: 60 * 60 * 24, // Refresh if < 1 day remaining
      cookieCache: {
        enabled: true,
        maxAge: 5 * 60, // 5 minutes
      },
    },

    advanced: {
      cookiePrefix: 'better-auth',
      useSecureCookies: config.nodeEnv === 'production',
      crossSubDomainCookies: {
        enabled: false,
      },
    },
  });

  return authInstance;
}

export function getAuth() {
  if (!authInstance && config.auth.enabled) {
    throw new Error('Auth not initialized. Call initializeAuth() first.');
  }
  return authInstance;
}

export async function closeAuth() {
  if (pool) {
    await pool.end();
    pool = null;
  }
  authInstance = null;
}
