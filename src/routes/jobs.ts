import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDuplicateService } from '../services/duplicate.service';
import { getJobTrackerService } from '../services/job-tracker.service';
import { config } from '../config';

interface JobParams {
  id: string;
}

export async function jobsRoute(app: FastifyInstance) {
  /**
   * GET /jobs/:id
   * Get job status
   * Note: ID should be the backend artwork ID returned from the callback
   */
  app.get<{ Params: JobParams }>(
    '/jobs/:id',
    async (request: FastifyRequest<{ Params: JobParams }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;

        // First check Redis for job state (handles processing jobs)
        const jobTracker = getJobTrackerService();
        const jobState = await jobTracker.getJobState(id);

        if (jobState) {
          // Job is tracked in Redis
          if (jobState.status === 'processing') {
            return reply.status(200).send({
              job_id: jobState.job_id,
              status: 'processing',
              submitted_at: jobState.submitted_at,
              message: 'Job is currently being processed',
            });
          } else if (jobState.status === 'failed') {
            return reply.status(200).send({
              job_id: jobState.job_id,
              status: 'failed',
              submitted_at: jobState.submitted_at,
              completed_at: jobState.completed_at,
              error: jobState.error,
            });
          } else if (jobState.status === 'completed' && jobState.backend_artwork_id) {
            // Job completed, return with backend artwork ID
            return reply.status(200).send({
              job_id: jobState.job_id,
              status: 'completed',
              submitted_at: jobState.submitted_at,
              completed_at: jobState.completed_at,
              backend_artwork_id: jobState.backend_artwork_id,
              message: 'Job completed successfully',
            });
          }
        }

        // If not in Redis, check backend (for older jobs or if Redis is down)
        const duplicateService = getDuplicateService();
        const job = await duplicateService.getJobStatus(id);

        if (!job) {
          return reply.status(404).send({
            error: 'Job not found',
            statusCode: 404,
          });
        }

        return reply.status(200).send({
          job_id: job._id,
          status: job.status || 'completed',
          completedAt: job.completedAt,
          uploadedAt: job.uploadedAt,
        });
      } catch (error: any) {
        request.log.error(error, 'Error fetching job status');
        return reply.status(500).send({
          error: 'Internal server error',
          statusCode: 500,
        });
      }
    }
  );

  /**
   * GET /jobs/:id/result
   * Get complete job result with backend URLs
   * Note: ID should be the backend artwork ID returned from the callback
   */
  app.get<{ Params: JobParams }>(
    '/jobs/:id/result',
    async (request: FastifyRequest<{ Params: JobParams }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;

        // First check Redis for job state
        const jobTracker = getJobTrackerService();
        const jobState = await jobTracker.getJobState(id);

        if (jobState && jobState.status === 'processing') {
          return reply.status(409).send({
            error: 'Job is still processing',
            job_id: jobState.job_id,
            status: 'processing',
            submitted_at: jobState.submitted_at,
            statusCode: 409,
          });
        }

        if (jobState && jobState.status === 'failed') {
          return reply.status(200).send({
            job_id: jobState.job_id,
            status: 'failed',
            submitted_at: jobState.submitted_at,
            completed_at: jobState.completed_at,
            error: jobState.error,
          });
        }

        // Use backend_artwork_id from jobState if available (completed jobs)
        // Otherwise fall back to using the id parameter (for backwards compatibility)
        const artworkId =
          jobState && jobState.status === 'completed' && jobState.backend_artwork_id
            ? jobState.backend_artwork_id
            : id;

        request.log.info({ job_id: id, artwork_id: artworkId, jobState }, 'Fetching artwork from backend');

        const duplicateService = getDuplicateService();
        const artwork = await duplicateService.getArtworkById(artworkId);

        if (!artwork) {
          return reply.status(404).send({
            error: 'Job not found',
            statusCode: 404,
          });
        }

        // If artwork exists in backend, it's completed
        const baseUrl = config.backend.url;

        return reply.status(200).send({
          job_id: artwork._id,
          status: 'completed',
          artwork_id: artwork._id,
          title: artwork.title,
          artist: artwork.artist,
          description: artwork.description,
          tags: artwork.tags || [],
          hashes: artwork.extra?.hashes || {},
          completedAt: artwork.createdAt,
          uploadedAt: artwork.uploadedAt,
          processing_time_ms: artwork.extra?.processing_time_ms,
          urls: {
            original: `${baseUrl}/artworks/${artwork._id}?variant=original`,
            protected: `${baseUrl}/artworks/${artwork._id}?variant=protected`,
            mask_hi: `${baseUrl}/artworks/${artwork._id}?variant=mask_hi`,
            mask_lo: `${baseUrl}/artworks/${artwork._id}?variant=mask_lo`,
            metadata: `${baseUrl}/artworks/${artwork._id}/metadata`,
          },
          formats: artwork.formats,
          analysis: artwork.analysis,
          summary: artwork.summary,
        });
      } catch (error: any) {
        request.log.error(error, 'Error fetching job result');
        return reply.status(500).send({
          error: 'Internal server error',
          statusCode: 500,
        });
      }
    }
  );

  /**
   * GET /jobs/:id/download/:variant
   * Proxy download from backend
   * Note: ID should be the backend artwork ID returned from the callback
   */
  app.get<{ Params: JobParams & { variant: string } }>(
    '/jobs/:id/download/:variant',
    async (request: FastifyRequest<{ Params: JobParams & { variant: string } }>, reply: FastifyReply) => {
      try {
        const { id, variant } = request.params;

        // First check Redis for job state to get backend_artwork_id
        const jobTracker = getJobTrackerService();
        const jobState = await jobTracker.getJobState(id);

        if (jobState && jobState.status === 'processing') {
          return reply.status(409).send({
            error: 'Job is still processing',
            job_id: jobState.job_id,
            status: 'processing',
            statusCode: 409,
          });
        }

        if (jobState && jobState.status === 'failed') {
          return reply.status(404).send({
            error: 'Job failed - no files available',
            job_id: jobState.job_id,
            status: 'failed',
            statusCode: 404,
          });
        }

        // Use backend_artwork_id from jobState if available (completed jobs)
        // Otherwise fall back to using the id parameter (for backwards compatibility)
        const artworkId =
          jobState && jobState.status === 'completed' && jobState.backend_artwork_id
            ? jobState.backend_artwork_id
            : id;

        const duplicateService = getDuplicateService();
        const artwork = await duplicateService.getArtworkById(artworkId);

        if (!artwork) {
          return reply.status(404).send({
            error: 'Job not found',
            statusCode: 404,
          });
        }

        // If artwork exists in backend, it's completed
        const baseUrl = config.backend.url;
        const downloadUrl = `${baseUrl}/artworks/${artwork._id}?variant=${variant}`;

        // Redirect to backend
        return reply.redirect(downloadUrl, 307);
      } catch (error: any) {
        request.log.error(error, 'Error proxying download');
        return reply.status(500).send({
          error: 'Internal server error',
          statusCode: 500,
        });
      }
    }
  );
}
