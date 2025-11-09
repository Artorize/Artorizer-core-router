import cluster from 'cluster';
import os from 'os';
import pino from 'pino';
import { config } from './config';
import { buildApp, closeApp } from './app';
import { SelfUpdateService } from './services/self-update.service';

// Create logger for primary process (cluster manager)
const logger = pino({
  level: config.nodeEnv === 'production' ? 'info' : 'debug',
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

// Handle CLI arguments
const args = process.argv.slice(2);

if (args.includes('--version') || args.includes('-v')) {
  const updateService = new SelfUpdateService(logger);
  updateService.displayVersion();
  process.exit(0);
}

async function startWorker() {
  try {
    // Build and start Fastify app
    const app = await buildApp();
    await app.listen({
      port: config.port,
      host: config.host,
    });

    app.log.info(`Worker ${process.pid} started on port ${config.port}`);

    // Graceful shutdown
    const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
    signals.forEach((signal) => {
      process.on(signal, async () => {
        app.log.info(`${signal} received, shutting down gracefully...`);
        await closeApp(app);
        process.exit(0);
      });
    });
  } catch (error) {
    logger.error({ error, pid: process.pid }, 'Failed to start worker');
    process.exit(1);
  }
}

async function startCluster() {
  const numWorkers = Math.min(config.workers, os.cpus().length);

  logger.info({ pid: process.pid, workers: numWorkers }, 'Master process starting');

  // Perform self-update check on startup if enabled
  if (config.autoUpdate.enabled) {
    const updateService = new SelfUpdateService(logger);
    await updateService.updateIfAvailable();
  } else {
    logger.info('Auto-update disabled');
  }

  logger.info({ workers: numWorkers }, 'Starting workers');

  // Fork workers
  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }

  // Replace dead workers
  cluster.on('exit', (worker, code, signal) => {
    logger.warn(
      { worker_pid: worker.process.pid, code, signal },
      'Worker process died, restarting'
    );
    cluster.fork();
  });

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  signals.forEach((signal) => {
    process.on(signal, () => {
      logger.info({ signal }, 'Shutdown signal received, stopping all workers');

      for (const id in cluster.workers) {
        cluster.workers[id]?.kill();
      }

      setTimeout(() => {
        logger.warn('Forcing shutdown after timeout');
        process.exit(0);
      }, 10000);
    });
  });
}

// Start the application
async function main() {
  if (cluster.isPrimary && config.workers > 1) {
    await startCluster();
  } else if (cluster.isPrimary) {
    // Single worker mode - perform update check before starting if enabled
    if (config.autoUpdate.enabled) {
      const updateService = new SelfUpdateService(logger);
      await updateService.updateIfAvailable();
    } else {
      logger.info('Auto-update disabled');
    }
    await startWorker();
  } else {
    // This is a forked worker process
    await startWorker();
  }
}

main().catch((error) => {
  logger.error({ error }, 'Fatal error during startup');
  process.exit(1);
});
