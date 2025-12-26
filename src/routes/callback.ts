import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { config } from '../config';
import { getJobTrackerService } from '../services/job-tracker.service';

interface CallbackPayload {
  job_id: string;
  status: 'completed' | 'failed';
  processing_time_ms?: number;
  backend_artwork_id?: string; // ID returned from backend after processor uploads
  result?: {
    hashes: {
      perceptual_hash?: string;
      average_hash?: string;
      difference_hash?: string;
      [key: string]: any;
    };
    metadata: {
      artist_name: string;
      artwork_title: string;
      [key: string]: any;
    };
    watermark?: {
      strategy: string;
      strength?: number;
      [key: string]: any;
    };
  };
  error?: {
    code: string;
    message: string;
  };
}

interface ProgressCallbackPayload {
  job_id: string;
  current_step: string;
  step_number: number;
  total_steps: number;
  percentage: number;
  details?: Record<string, any>;
}

interface StepCompletePayload {
  job_id: string;
  step: string;
  status: 'processing' | 'completed' | 'failed';
  duration?: number;
  error?: string;
  started_at?: string;
  completed_at?: string;
}

export async function callbackRoute(app: FastifyInstance) {
  /**
   * POST /callbacks/process-complete
   * Receives completion callback from processor after it uploads to backend
   */
  app.post(
    '/callbacks/process-complete',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Validate authorization header
        const authHeader = request.headers.authorization;
        const expectedToken = config.router.callbackAuthToken;

        if (!authHeader || authHeader !== expectedToken) {
          request.log.warn({ authHeader }, 'Unauthorized callback attempt');
          return reply.status(401).send({ error: 'Unauthorized' });
        }

        const payload = request.body as CallbackPayload;

        if (!payload.job_id) {
          return reply.status(400).send({ error: 'Missing job_id in callback payload' });
        }

        request.log.info(
          {
            job_id: payload.job_id,
            status: payload.status,
            backend_artwork_id: payload.backend_artwork_id,
            processing_time_ms: payload.processing_time_ms
          },
          'Received processor callback'
        );

        // Handle failure
        if (payload.status === 'failed') {
          request.log.error({ job_id: payload.job_id, error: payload.error }, 'Job processing failed');

          // Update job state in Redis
          const jobTracker = getJobTrackerService();
          await jobTracker.updateJobCompletion(
            payload.job_id,
            payload.backend_artwork_id || '',
            'failed',
            payload.error
          );

          return reply.status(200).send({
            received: true,
            job_id: payload.job_id,
            status: 'failed'
          });
        }

        // Handle success - processor has already uploaded to backend
        if (!payload.backend_artwork_id) {
          return reply.status(400).send({
            error: 'Missing backend_artwork_id in callback payload. Processor should upload to backend and return the artwork ID.'
          });
        }

        request.log.info(
          {
            job_id: payload.job_id,
            backend_artwork_id: payload.backend_artwork_id,
            artist: payload.result?.metadata?.artist_name,
            title: payload.result?.metadata?.artwork_title
          },
          'Job completed successfully - artwork stored in backend by processor'
        );

        // Update job state in Redis
        const jobTracker = getJobTrackerService();
        await jobTracker.updateJobCompletion(
          payload.job_id,
          payload.backend_artwork_id,
          'completed'
        );

        return reply.status(200).send({
          received: true,
          job_id: payload.job_id,
          artwork_id: payload.backend_artwork_id,
          status: 'completed',
          message: 'Callback received - artwork is now available in backend storage'
        });
      } catch (error: any) {
        request.log.error(error, 'Error processing callback');

        return reply.status(500).send({
          error: 'Failed to process callback',
          detail: error.message,
        });
      }
    }
  );

  /**
   * POST /callbacks/process-progress
   * Receives progress updates from processor during processing
   */
  app.post(
    '/callbacks/process-progress',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Validate authorization header
        const authHeader = request.headers.authorization;
        const expectedToken = config.router.callbackAuthToken;

        if (!authHeader || authHeader !== expectedToken) {
          request.log.warn({ authHeader }, 'Unauthorized progress callback attempt');
          return reply.status(401).send({ error: 'Unauthorized' });
        }

        const payload = request.body as ProgressCallbackPayload;

        if (!payload.job_id) {
          return reply.status(400).send({ error: 'Missing job_id in progress payload' });
        }

        if (!payload.current_step) {
          return reply.status(400).send({ error: 'Missing current_step in progress payload' });
        }

        request.log.info(
          {
            job_id: payload.job_id,
            current_step: payload.current_step,
            step_number: payload.step_number,
            total_steps: payload.total_steps,
            percentage: payload.percentage
          },
          'Received processor progress update'
        );

        // Update job progress in Redis
        const jobTracker = getJobTrackerService();
        await jobTracker.updateJobProgress(payload.job_id, {
          current_step: payload.current_step,
          step_number: payload.step_number,
          total_steps: payload.total_steps,
          percentage: payload.percentage,
          updated_at: new Date().toISOString(),
          details: payload.details,
        });

        return reply.status(200).send({
          received: true,
          job_id: payload.job_id,
          message: 'Progress update received',
        });
      } catch (error: any) {
        request.log.error(error, 'Error processing progress callback');

        return reply.status(500).send({
          error: 'Failed to process progress callback',
          detail: error.message,
        });
      }
    }
  );

  /**
   * POST /callbacks/step-complete
   * Receives step-level status updates from processor
   */
  app.post(
    '/callbacks/step-complete',
    async (request: FastifyRequest, reply: FastifyReply) => {
      try {
        // Validate authorization header
        const authHeader = request.headers.authorization;
        const expectedToken = config.router.callbackAuthToken;

        if (!authHeader || authHeader !== expectedToken) {
          request.log.warn({ authHeader }, 'Unauthorized step callback attempt');
          return reply.status(401).send({ error: 'Unauthorized' });
        }

        const payload = request.body as StepCompletePayload;

        if (!payload.job_id) {
          return reply.status(400).send({ error: 'Missing job_id in step payload' });
        }

        if (!payload.step) {
          return reply.status(400).send({ error: 'Missing step in step payload' });
        }

        if (!payload.status) {
          return reply.status(400).send({ error: 'Missing status in step payload' });
        }

        request.log.info(
          {
            job_id: payload.job_id,
            step: payload.step,
            status: payload.status,
            duration: payload.duration,
            error: payload.error,
          },
          'Received processor step update'
        );

        // Update step status in Redis
        const jobTracker = getJobTrackerService();
        await jobTracker.updateStepStatus(payload.job_id, payload.step, {
          status: payload.status,
          duration: payload.duration,
          error: payload.error,
          started_at: payload.started_at,
          completed_at: payload.completed_at,
        });

        return reply.status(200).send({
          received: true,
          job_id: payload.job_id,
          step: payload.step,
          message: 'Step update received',
        });
      } catch (error: any) {
        request.log.error(error, 'Error processing step callback');

        return reply.status(500).send({
          error: 'Failed to process step callback',
          detail: error.message,
        });
      }
    }
  );
}
