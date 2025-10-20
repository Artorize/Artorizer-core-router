import { FastifyInstance } from 'fastify';
import { getProcessorService } from '../services/processor.service';
import { getBackendService } from '../services/backend.service';
import { getQueueService } from '../services/queue.service';

interface HealthStatus {
  status: 'healthy' | 'degraded' | 'unhealthy';
  timestamp: string;
  uptime: number;
  version?: string;
  services: {
    processor: ServiceStatus;
    backend: ServiceStatus;
    redis: ServiceStatus;
  };
}

interface ServiceStatus {
  status: 'up' | 'down' | 'degraded';
  message?: string;
  responseTime?: number;
  details?: any;
}

export async function healthRoute(app: FastifyInstance): Promise<void> {
  /**
   * Comprehensive health check endpoint
   * GET /health
   */
  app.get('/health', async (request, reply) => {
    const startTime = Date.now();
    const processorService = getProcessorService();
    const backendService = getBackendService();

    // Check all services in parallel
    const [processorHealth, backendHealth, redisHealth] = await Promise.all([
      checkProcessor(processorService),
      checkBackend(backendService),
      checkRedis(),
    ]);

    // Determine overall health status
    const allUp = processorHealth.status === 'up' &&
                  backendHealth.status === 'up' &&
                  redisHealth.status === 'up';

    const anyDown = processorHealth.status === 'down' ||
                    backendHealth.status === 'down' ||
                    redisHealth.status === 'down';

    const overallStatus: 'healthy' | 'degraded' | 'unhealthy' =
      allUp ? 'healthy' :
      anyDown ? 'degraded' :
      'unhealthy';

    const response: HealthStatus = {
      status: overallStatus,
      timestamp: new Date().toISOString(),
      uptime: process.uptime(),
      version: process.env.npm_package_version,
      services: {
        processor: processorHealth,
        backend: backendHealth,
        redis: redisHealth,
      },
    };

    // Set appropriate HTTP status code
    const httpStatus = overallStatus === 'healthy' ? 200 :
                       overallStatus === 'degraded' ? 200 :
                       503;

    request.log.info({
      healthCheck: response,
      duration: Date.now() - startTime,
    }, 'Health check completed');

    return reply.status(httpStatus).send(response);
  });

  /**
   * Simple liveness probe (for k8s/docker)
   * GET /health/live
   */
  app.get('/health/live', async () => {
    return { status: 'alive', timestamp: new Date().toISOString() };
  });

  /**
   * Readiness probe (checks if service can accept traffic)
   * GET /health/ready
   */
  app.get('/health/ready', async (request, reply) => {
    const processorService = getProcessorService();
    const backendService = getBackendService();

    // Quick checks for critical services
    const [processorUp, backendUp] = await Promise.all([
      checkProcessor(processorService),
      checkBackend(backendService),
    ]);

    const ready = processorUp.status === 'up' && backendUp.status === 'up';

    if (!ready) {
      return reply.status(503).send({
        status: 'not_ready',
        timestamp: new Date().toISOString(),
        services: {
          processor: processorUp.status,
          backend: backendUp.status,
        },
      });
    }

    return {
      status: 'ready',
      timestamp: new Date().toISOString(),
    };
  });
}

/**
 * Check processor service health
 */
async function checkProcessor(service: ReturnType<typeof getProcessorService>): Promise<ServiceStatus> {
  const startTime = Date.now();

  try {
    const isHealthy = await service.healthCheck();
    const responseTime = Date.now() - startTime;
    const circuitStatus = service.getStatus();

    if (!isHealthy) {
      return {
        status: 'down',
        message: 'Processor health check failed',
        responseTime,
        details: circuitStatus,
      };
    }

    // Check if circuit breaker is open
    if (circuitStatus.circuitOpen) {
      return {
        status: 'degraded',
        message: 'Circuit breaker is open',
        responseTime,
        details: circuitStatus,
      };
    }

    return {
      status: 'up',
      message: 'Processor is operational',
      responseTime,
      details: {
        failureCount: circuitStatus.failureCount,
      },
    };
  } catch (error) {
    return {
      status: 'down',
      message: error instanceof Error ? error.message : 'Unknown error',
      responseTime: Date.now() - startTime,
    };
  }
}

/**
 * Check backend service health (includes database check)
 */
async function checkBackend(service: ReturnType<typeof getBackendService>): Promise<ServiceStatus> {
  const startTime = Date.now();

  try {
    const isHealthy = await service.healthCheck();
    const responseTime = Date.now() - startTime;

    if (!isHealthy) {
      return {
        status: 'down',
        message: 'Backend health check failed (database may be unavailable)',
        responseTime,
      };
    }

    return {
      status: 'up',
      message: 'Backend and database are operational',
      responseTime,
    };
  } catch (error) {
    return {
      status: 'down',
      message: error instanceof Error ? error.message : 'Unknown error',
      responseTime: Date.now() - startTime,
    };
  }
}

/**
 * Check Redis connectivity
 */
async function checkRedis(): Promise<ServiceStatus> {
  const startTime = Date.now();

  try {
    const queueService = getQueueService();
    const queue = queueService.getQueue();

    // Test Redis connection by getting queue metrics
    const metrics = await queueService.getMetrics();
    const responseTime = Date.now() - startTime;

    // Check if Redis is responsive
    const isHealthy = await queue.isReady();

    if (!isHealthy) {
      return {
        status: 'down',
        message: 'Redis connection is not ready',
        responseTime,
      };
    }

    return {
      status: 'up',
      message: 'Redis is operational',
      responseTime,
      details: {
        jobs: metrics,
      },
    };
  } catch (error) {
    return {
      status: 'down',
      message: error instanceof Error ? error.message : 'Redis connection failed',
      responseTime: Date.now() - startTime,
    };
  }
}
