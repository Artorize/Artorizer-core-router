import Redis from 'ioredis';
import { config } from '../config';

export interface JobProgress {
  current_step: string;
  step_number: number;
  total_steps: number;
  percentage: number;
  updated_at: string;
  details?: Record<string, any>;
}

export interface StepStatus {
  status: 'queued' | 'processing' | 'completed' | 'failed';
  duration?: number;
  error?: string;
  started_at?: string;
  completed_at?: string;
}

export interface ProcessorConfiguration {
  processors?: string[];
  watermark_strategy?: string;
  protection_layers?: {
    fawkes?: boolean;
    photoguard?: boolean;
    mist?: boolean;
    nightshade?: boolean;
    stegano_embed?: boolean;
    c2pa_manifest?: boolean;
  };
  total_steps: number;
}

export interface JobState {
  job_id: string;
  status: 'processing' | 'completed' | 'failed';
  submitted_at: string;
  completed_at?: string;
  backend_artwork_id?: string;
  processor_config?: ProcessorConfiguration;
  progress?: JobProgress;
  steps?: Record<string, StepStatus>;
  current_step?: string;
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
   * Calculate total processing steps based on configuration
   */
  private calculateTotalSteps(config: Partial<ProcessorConfiguration>): number {
    let steps = 0;

    // Count each processor as a step
    if (config.processors && config.processors.length > 0) {
      steps += config.processors.length;
    }

    // Count protection layers
    if (config.protection_layers) {
      const layers = config.protection_layers;
      if (layers.fawkes) steps++;
      if (layers.photoguard) steps++;
      if (layers.mist) steps++;
      if (layers.nightshade) steps++;
      if (layers.stegano_embed) steps++;
      if (layers.c2pa_manifest) steps++;
    }

    // Count watermarking step (if not 'none')
    if (config.watermark_strategy && config.watermark_strategy !== 'none') {
      steps++;
    }

    // Always include upload step
    steps++;

    // Minimum 1 step if nothing configured
    return Math.max(steps, 1);
  }

  /**
   * Initialize steps based on processor configuration
   */
  private initializeSteps(config: Partial<ProcessorConfiguration>): Record<string, StepStatus> {
    const steps: Record<string, StepStatus> = {};

    // Always include upload step
    steps.upload = { status: 'queued' };

    // Add protection layers
    if (config.protection_layers) {
      const layers = config.protection_layers;
      if (layers.fawkes) {
        steps.fawkes = { status: 'queued' };
      }
      if (layers.nightshade) {
        steps.nightshade = { status: 'queued' };
      }
      if (layers.photoguard) {
        steps.photoguard = { status: 'queued' };
      }
      if (layers.mist) {
        steps.mist = { status: 'queued' };
      }
      if (layers.c2pa_manifest) {
        steps.c2pa = { status: 'queued' };
      }
    }

    // Add watermark step if configured
    if (config.watermark_strategy && config.watermark_strategy !== 'none') {
      steps.watermark = { status: 'queued' };
    }

    return steps;
  }

  /**
   * Track a new job submission with processor configuration
   */
  async trackJobSubmission(
    jobId: string,
    processorConfig?: Partial<ProcessorConfiguration>
  ): Promise<void> {
    try {
      const totalSteps = processorConfig ? this.calculateTotalSteps(processorConfig) : 1;

      const config: ProcessorConfiguration = {
        processors: processorConfig?.processors || [],
        watermark_strategy: processorConfig?.watermark_strategy || 'none',
        protection_layers: processorConfig?.protection_layers || {},
        total_steps: totalSteps,
      };

      const steps = processorConfig ? this.initializeSteps(processorConfig) : { upload: { status: 'queued' as const } };

      const state: JobState = {
        job_id: jobId,
        status: 'processing',
        submitted_at: new Date().toISOString(),
        processor_config: config,
        steps,
        current_step: 'upload',
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
   * Update job progress (called by processor during processing)
   */
  async updateJobProgress(
    jobId: string,
    progress: JobProgress
  ): Promise<void> {
    try {
      const existingState = await this.getJobState(jobId);

      if (!existingState) {
        // Job doesn't exist in Redis yet - create it
        const state: JobState = {
          job_id: jobId,
          status: 'processing',
          submitted_at: new Date().toISOString(),
          progress,
        };

        await this.redis.setex(
          `${this.KEY_PREFIX}${jobId}`,
          this.TTL,
          JSON.stringify(state)
        );
      } else {
        // Update existing job with new progress
        const state: JobState = {
          ...existingState,
          progress,
        };

        await this.redis.setex(
          `${this.KEY_PREFIX}${jobId}`,
          this.TTL,
          JSON.stringify(state)
        );
      }
    } catch (error) {
      // Silent fail - not critical
    }
  }

  /**
   * Update individual step status
   */
  async updateStepStatus(
    jobId: string,
    stepName: string,
    stepStatus: Partial<StepStatus>
  ): Promise<void> {
    try {
      const existingState = await this.getJobState(jobId);

      if (!existingState) {
        // Job doesn't exist - create minimal state with this step
        const steps: Record<string, StepStatus> = {};
        steps[stepName] = {
          status: stepStatus.status || 'processing',
          started_at: stepStatus.started_at,
          completed_at: stepStatus.completed_at,
          duration: stepStatus.duration,
          error: stepStatus.error,
        };

        const state: JobState = {
          job_id: jobId,
          status: 'processing',
          submitted_at: new Date().toISOString(),
          steps,
          current_step: stepName,
        };

        await this.redis.setex(
          `${this.KEY_PREFIX}${jobId}`,
          this.TTL,
          JSON.stringify(state)
        );
        return;
      }

      // Update existing step or create new one
      const steps = existingState.steps || {};
      const currentStepData = steps[stepName] || { status: 'queued' as const };

      steps[stepName] = {
        ...currentStepData,
        ...stepStatus,
      };

      // Update current_step if this step is processing
      const currentStep = stepStatus.status === 'processing' ? stepName : existingState.current_step;

      // Check if all steps are completed or if any failed
      const stepValues = Object.values(steps);
      const allCompleted = stepValues.every((s) => s.status === 'completed');
      const anyFailed = stepValues.some((s) => s.status === 'failed');

      let jobStatus: 'processing' | 'completed' | 'failed' = existingState.status;
      if (anyFailed) {
        jobStatus = 'failed';
      } else if (allCompleted && existingState.backend_artwork_id) {
        jobStatus = 'completed';
      }

      const state: JobState = {
        ...existingState,
        steps,
        current_step: currentStep,
        status: jobStatus,
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
        // Preserve progress for completed jobs (useful for debugging)
        ...(existingState?.progress && { progress: existingState.progress }),
        // Preserve steps for completed jobs
        ...(existingState?.steps && { steps: existingState.steps }),
        ...(existingState?.current_step && { current_step: existingState.current_step }),
        ...(existingState?.processor_config && { processor_config: existingState.processor_config }),
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
