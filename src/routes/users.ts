import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getBackendService } from '../services/backend.service';
import { requireAuth } from '../middleware/auth.middleware';

interface UpdateUserBody {
  username?: string;
}

export async function usersRoute(app: FastifyInstance) {
  /**
   * PATCH /users/me - Update current user profile
   *
   * Authentication: Required
   * - User must have valid session
   * - User context is forwarded to backend for ownership verification
   *
   * Request body:
   * - username: New username (3-30 chars, alphanumeric + underscore/hyphen)
   *
   * Response:
   * - 200 OK: User updated successfully
   * - 400 Bad Request: Invalid username format
   * - 401 Unauthorized: No valid session
   * - 409 Conflict: Username already taken
   */
  app.patch<{ Body: UpdateUserBody }>(
    '/users/me',
    {
      preHandler: requireAuth,
    },
    async (request: FastifyRequest<{ Body: UpdateUserBody }>, reply: FastifyReply) => {
      try {
        const { username } = request.body;

        if (!username) {
          return reply.status(400).send({
            error: 'Bad Request',
            message: 'Username is required',
            statusCode: 400,
          });
        }

        const backendService = getBackendService();
        const result = await backendService.updateUser(request, { username });

        return reply.status(200).send(result);
      } catch (error: any) {
        request.log.error(error, 'Error updating user');

        if (error.message?.includes('already taken') || error.message?.includes('conflict')) {
          return reply.status(409).send({
            error: 'Conflict',
            message: 'Username already taken',
            statusCode: 409,
          });
        }

        return reply.status(500).send({
          error: 'Internal server error',
          statusCode: 500,
        });
      }
    }
  );
}
