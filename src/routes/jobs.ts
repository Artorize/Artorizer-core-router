import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getDuplicateService } from '../services/duplicate.service';
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

        const duplicateService = getDuplicateService();
        const artwork = await duplicateService.getArtworkById(id);

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

        const duplicateService = getDuplicateService();
        const artwork = await duplicateService.getArtworkById(id);

        if (!artwork) {
          return reply.status(404).send({
            error: 'Job not found',
            statusCode: 404,
          });
        }

        // If artwork exists in backend, it's completed
        const baseUrl = config.backend.url;
        const downloadUrl = `${baseUrl}/artworks/${artwork._id}/download?variant=${variant}`;

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
