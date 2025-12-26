import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getBackendService } from '../services/backend.service';
import { requireAuth, optionalAuth } from '../middleware/auth.middleware';
import { config } from '../config';

interface ArtworksQueryParams {
  limit?: number;
  skip?: number;
}

interface ArtworkParams {
  id: string;
}

interface ArtworkQueryParams {
  variant?: 'original' | 'protected' | 'mask';
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

  /**
   * GET /artworks/:id - Proxy artwork file download from backend
   *
   * Authentication: Optional
   * - If authenticated, user context is forwarded to backend for access control
   * - Backend enforces access control based on artwork ownership
   * - Anonymous users can download if artwork is public
   * - Authenticated users can download their own artwork
   *
   * Query Parameters:
   * - variant: Artwork variant to download (original, protected, mask) - default: protected
   */
  app.get<{ Params: ArtworkParams; Querystring: ArtworkQueryParams }>(
    '/artworks/:id',
    {
      preHandler: optionalAuth,
    },
    async (request: FastifyRequest<{ Params: ArtworkParams; Querystring: ArtworkQueryParams }>, reply: FastifyReply) => {
      try {
        const { id } = request.params;
        const { variant = 'protected' } = request.query;

        // Extract user information from authenticated session for forwarding to backend
        // User headers allow backend to:
        // - Verify download access based on artwork ownership
        // - Enforce access restrictions
        // - Track downloads per user
        const headers: Record<string, string> = {};
        if (request.user) {
          headers['X-User-Id'] = request.user.id;
          headers['X-User-Email'] = request.user.email;
          if (request.user.name) {
            headers['X-User-Name'] = request.user.name;
          }
        }

        // Fetch file from backend and stream to client
        const baseUrl = config.backend.url;
        const downloadUrl = `${baseUrl}/artworks/${id}?variant=${variant}`;

        request.log.info({ artwork_id: id, variant, downloadUrl }, 'Proxying artwork download from backend');

        const { request: backendRequest } = await import('undici');
        const response = await backendRequest(downloadUrl, {
          method: 'GET',
          headers: Object.keys(headers).length > 0 ? headers : undefined,
        });

        if (response.statusCode !== 200) {
          request.log.error({ statusCode: response.statusCode, variant }, 'Backend artwork download failed');
          return reply.status(response.statusCode).send({
            error: `Failed to fetch ${variant} variant from backend`,
            statusCode: response.statusCode,
          });
        }

        // Forward content-type and content-disposition headers
        const contentType = response.headers['content-type'] || 'application/octet-stream';
        const contentDisposition =
          response.headers['content-disposition'] || `attachment; filename="${id}-${variant}"`;

        reply.header('content-type', contentType);
        reply.header('content-disposition', contentDisposition);

        // Stream the response body to client
        return reply.send(response.body);
      } catch (error: any) {
        request.log.error(error, 'Error proxying artwork download');
        return reply.status(500).send({
          error: 'Internal server error',
          statusCode: 500,
        });
      }
    }
  );
}
