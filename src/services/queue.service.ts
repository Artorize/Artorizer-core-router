import Bull, { Queue, Job } from 'bull';
import pino from 'pino';
import { config } from '../config';
import { ProtectRequest } from '../types/schemas';

// Create logger for queue service
const logger = pino({
  level: config.nodeEnv === 'production' ? 'info' : 'debug',
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

export interface ProcessorJobData {
  payload: ProtectRequest;
  imageBuffer?: Buffer;
  imageFilename?: string;
}

export class QueueService {
  private queue: Queue<ProcessorJobData>;

  constructor() {
    this.queue = new Bull<ProcessorJobData>('processor-jobs', {
      redis: {
        host: config.redis.host,
        port: config.redis.port,
        password: config.redis.password,
        maxRetriesPerRequest: 1, // Fail fast for health checks
        connectTimeout: 2000, // 2 second timeout
        retryStrategy: (times: number) => {
          if (times > 2) {
            return null; // Stop retrying
          }
          return Math.min(times * 100, 500); // Quick retry attempts
        },
      },
      defaultJobOptions: {
        attempts: 3,
        backoff: {
          type: 'exponential',
          delay: 2000,
        },
        removeOnComplete: 100,
        removeOnFail: 500,
      },
    });

    this.setupEventHandlers();
  }

  private setupEventHandlers(): void {
    this.queue.on('error', (error) => {
      logger.error({ error }, 'Queue error occurred');
    });

    this.queue.on('failed', (job, error) => {
      logger.error({ job_id: job.id, error: error.message }, 'Job processing failed');
    });
  }

  /**
   * Add a job to the processor queue
   */
  async addJob(data: ProcessorJobData, priority?: number): Promise<Job<ProcessorJobData>> {
    return await this.queue.add(data, {
      priority: priority || 0,
    });
  }

  /**
   * Get job by ID
   */
  async getJob(jobId: string): Promise<Job<ProcessorJobData> | null> {
    return await this.queue.getJob(jobId);
  }

  /**
   * Get queue metrics
   */
  async getMetrics() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);

    return {
      waiting,
      active,
      completed,
      failed,
      delayed,
    };
  }

  /**
   * Close the queue connection
   */
  async close(): Promise<void> {
    await this.queue.close();
  }

  getQueue(): Queue<ProcessorJobData> {
    return this.queue;
  }
}

// Singleton instance
let instance: QueueService | null = null;

export function getQueueService(): QueueService {
  if (!instance) {
    instance = new QueueService();
  }
  return instance;
}
