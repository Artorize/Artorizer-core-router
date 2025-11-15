import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDuplicateService } from '../services/duplicate.service';
import { getJobTrackerService } from '../services/job-tracker.service';
import { config } from '../config';

interface JobParams {
  id: string;
}

const getArtworkId = (artwork: any): string | undefined => {
  if (!artwork) {
    return undefined;
  }
  return artwork._id ?? artwork.id ?? artwork.artwork_id ?? artwork.artworkId;
};

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
            const response: any = {
              job_id: jobState.job_id,
              status: 'processing',
              submitted_at: jobState.submitted_at,
              message: 'Job is currently being processed',
            };

            // Include processor configuration if available
            if (jobState.processor_config) {
              response.processor_config = jobState.processor_config;
            }

            // Include progress information if available
            if (jobState.progress) {
              response.progress = jobState.progress;
            }

            return reply.status(200).send(response);
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
          const response: any = {
            error: 'Job is still processing',
            job_id: jobState.job_id,
            status: 'processing',
            submitted_at: jobState.submitted_at,
            statusCode: 409,
          };

          // Include processor configuration if available
          if (jobState.processor_config) {
            response.processor_config = jobState.processor_config;
          }

          // Include progress information if available
          if (jobState.progress) {
            response.progress = jobState.progress;
          }

          return reply.status(409).send(response);
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

        const resolvedArtworkId = getArtworkId(artwork);

        if (!resolvedArtworkId) {
          request.log.error({ job_id: id, artwork }, 'Artwork payload missing identifier');
          return reply.status(502).send({
            error: 'Artwork metadata missing identifier',
            statusCode: 502,
          });
        }

        // If artwork exists in backend, it's completed
        // Use router's base URL for public-facing download links
        const routerBaseUrl = config.router.baseUrl;

        return reply.status(200).send({
          job_id: id, // Return the original job_id from the request
          status: 'completed',
          artwork_id: resolvedArtworkId,
          _id: resolvedArtworkId,
          id: resolvedArtworkId,
          title: artwork.title,
          artist: artwork.artist,
          description: artwork.description,
          tags: artwork.tags || [],
          hashes: artwork.extra?.hashes || {},
          completedAt: artwork.createdAt,
          uploadedAt: artwork.uploadedAt,
          processing_time_ms: artwork.extra?.processing_time_ms,
          urls: {
            original: `${routerBaseUrl}/jobs/${id}/download/original`,
            protected: `${routerBaseUrl}/jobs/${id}/download/protected`,
            mask: `${routerBaseUrl}/jobs/${id}/download/mask`,
            metadata: `${routerBaseUrl}/jobs/${id}/result`,
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

        const resolvedArtworkId = getArtworkId(artwork);

        if (!resolvedArtworkId) {
          request.log.error({ job_id: id, artwork }, 'Artwork payload missing identifier');
          return reply.status(502).send({
            error: 'Artwork metadata missing identifier',
            statusCode: 502,
          });
        }

        // Fetch file from backend and stream to client
        const baseUrl = config.backend.url;
        const downloadUrl = `${baseUrl}/artworks/${resolvedArtworkId}?variant=${variant}`;

        request.log.info({ artwork_id: resolvedArtworkId, variant, downloadUrl }, 'Proxying download from backend');

        const { request: backendRequest } = await import('undici');
        const response = await backendRequest(downloadUrl, {
          method: 'GET',
        });

        if (response.statusCode !== 200) {
          request.log.error({ statusCode: response.statusCode, variant }, 'Backend download failed');
          return reply.status(response.statusCode).send({
            error: `Failed to fetch ${variant} from backend`,
            statusCode: response.statusCode,
          });
        }

        // Forward content-type and content-disposition headers
        const contentType = response.headers['content-type'] || 'application/octet-stream';
        const contentDisposition =
          response.headers['content-disposition'] || `attachment; filename="${resolvedArtworkId}-${variant}"`;

        reply.header('content-type', contentType);
        reply.header('content-disposition', contentDisposition);

        // Stream the response body to client
        return reply.send(response.body);
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
