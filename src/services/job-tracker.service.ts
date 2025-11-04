import Redis from 'ioredis';
import { config } from '../config';

export interface JobState {
  job_id: string;
  status: 'processing' | 'completed' | 'failed';
  submitted_at: string;
  completed_at?: string;
  backend_artwork_id?: string;
  error?: {
    code: string;
    message: string;
  };
}

export class JobTrackerService {
  private redis: Redis;
  private readonly KEY_PREFIX = 'job:';
  private readonly TTL = 3600; // 1 hour

  constructor() {
    this.redis = new Redis({
      host: config.redis.host,
      port: config.redis.port,
      password: config.redis.password,
      lazyConnect: true,
      retryStrategy: (times: number) => {
        if (times > 3) {
          return null;
        }
        return Math.min(times * 200, 1000);
      },
    });

    this.redis.on('error', () => {
      // Silent fail - don't crash the app if Redis is unavailable
      // Jobs will still work via backend API, just no intermediate state tracking
    });
  }

  /**
   * Connect to Redis
   */
  async connect(): Promise<void> {
    try {
      await this.redis.connect();
    } catch (error) {
      // Silent fail - Redis is optional for job tracking
    }
  }

  /**
   * Track a new job submission
   */
  async trackJobSubmission(jobId: string): Promise<void> {
    try {
      const state: JobState = {
        job_id: jobId,
        status: 'processing',
        submitted_at: new Date().toISOString(),
      };

      await this.redis.setex(
        `${this.KEY_PREFIX}${jobId}`,
        this.TTL,
        JSON.stringify(state)
      );
    } catch (error) {
      // Silent fail - not critical
    }
  }

  /**
   * Update job state on completion
   */
  async updateJobCompletion(
    jobId: string,
    backendArtworkId: string,
    status: 'completed' | 'failed',
    error?: { code: string; message: string }
  ): Promise<void> {
    try {
      const existingState = await this.getJobState(jobId);

      const state: JobState = {
        job_id: jobId,
        status,
        submitted_at: existingState?.submitted_at || new Date().toISOString(),
        completed_at: new Date().toISOString(),
        backend_artwork_id: backendArtworkId,
        ...(error && { error }),
      };

      await this.redis.setex(
        `${this.KEY_PREFIX}${jobId}`,
        this.TTL,
        JSON.stringify(state)
      );
    } catch (error) {
      // Silent fail - not critical
    }
  }

  /**
   * Get job state from Redis
   */
  async getJobState(jobId: string): Promise<JobState | null> {
    try {
      const data = await this.redis.get(`${this.KEY_PREFIX}${jobId}`);
      if (!data) {
        return null;
      }
      return JSON.parse(data) as JobState;
    } catch (error) {
      return null;
    }
  }

  /**
   * Delete job state
   */
  async deleteJobState(jobId: string): Promise<void> {
    try {
      await this.redis.del(`${this.KEY_PREFIX}${jobId}`);
    } catch (error) {
      // Silent fail
    }
  }

  /**
   * Check Redis connection status
   */
  async isConnected(): Promise<boolean> {
    try {
      await this.redis.ping();
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Close Redis connection
   */
  async close(): Promise<void> {
    await this.redis.quit();
  }
}

// Singleton instance
let instance: JobTrackerService | null = null;

export function getJobTrackerService(): JobTrackerService {
  if (!instance) {
    instance = new JobTrackerService();
  }
  return instance;
}
