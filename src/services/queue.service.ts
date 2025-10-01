import Bull, { Queue, Job } from 'bull';
import { config } from '../config';
import { ProtectRequest } from '../types/schemas';

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
      console.error('Queue error:', error);
    });

    this.queue.on('failed', (job, error) => {
      console.error(`Job ${job.id} failed:`, error.message);
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
