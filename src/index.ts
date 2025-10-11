import cluster from 'cluster';
import os from 'os';
import { config } from './config';
import { buildApp, closeApp } from './app';

async function startWorker() {
  try {
    // Build and start Fastify app
    const app = await buildApp();
    await app.listen({
      port: config.port,
      host: '0.0.0.0',
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
    console.error('Failed to start worker:', error);
    process.exit(1);
  }
}

async function startCluster() {
  const numWorkers = Math.min(config.workers, os.cpus().length);

  console.log(`Master ${process.pid} starting ${numWorkers} workers...`);

  // Fork workers
  for (let i = 0; i < numWorkers; i++) {
    cluster.fork();
  }

  // Replace dead workers
  cluster.on('exit', (worker, code, signal) => {
    console.log(`Worker ${worker.process.pid} died (${signal || code}). Restarting...`);
    cluster.fork();
  });

  // Graceful shutdown
  const signals: NodeJS.Signals[] = ['SIGINT', 'SIGTERM'];
  signals.forEach((signal) => {
    process.on(signal, () => {
      console.log(`${signal} received, shutting down all workers...`);

      for (const id in cluster.workers) {
        cluster.workers[id]?.kill();
      }

      setTimeout(() => {
        console.log('Forcing shutdown...');
        process.exit(0);
      }, 10000);
    });
  });
}

// Start the application
if (cluster.isPrimary && config.workers > 1) {
  startCluster();
} else {
  startWorker();
}
