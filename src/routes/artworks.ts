import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getBackendService } from '../services/backend.service';
import { requireAuth } from '../middleware/auth.middleware';

interface ArtworksQueryParams {
  limit?: number;
  skip?: number;
}

export async function artworksRoute(app: FastifyInstance) {
  /**
   * GET /artworks/me - Get artwork history for logged-in user
   *
   * Authentication: Required
   * - User must have valid session
   * - User context is forwarded to backend for ownership filtering
   * - Backend returns only artworks associated with the authenticated user
   *
   * Query Parameters:
   * - limit: Maximum number of artworks to return (default: backend default)
   * - skip: Number of artworks to skip for pagination (default: 0)
   */
  app.get<{ Querystring: ArtworksQueryParams }>(
    '/artworks/me',
    {
      preHandler: requireAuth,
    },
    async (request: FastifyRequest<{ Querystring: ArtworksQueryParams }>, reply: FastifyReply) => {
      try {
        const { limit, skip } = request.query;

        // User information from authenticated session is forwarded to backend
        // via getMyArtworks, which extracts user headers from request.user:
        // - X-User-Id, X-User-Email, X-User-Name
        // Backend uses these headers to:
        // - Filter artworks by user ownership
        // - Return user-specific artwork history
        // - Enforce access control
        const backendService = getBackendService();
        const artworks = await backendService.getMyArtworks(request, { limit, skip });

        return reply.status(200).send(artworks);
      } catch (error: any) {
        request.log.error(error, 'Error fetching user artworks');
        return reply.status(500).send({
          error: 'Internal server error',
          statusCode: 500,
        });
      }
    }
  );
}
