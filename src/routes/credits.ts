import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { getBackendService } from '../services/backend.service';
import { requireAuth } from '../middleware/auth.middleware';

export async function creditsRoute(app: FastifyInstance) {
  /**
   * GET /credits/me - Get credit balance for authenticated user
   */
  app.get('/credits/me', {
    preHandler: requireAuth,
  }, async (request: FastifyRequest, reply: FastifyReply) => {
    try {
      const backendService = getBackendService();
      const credits = await backendService.getCredits(request);
      return reply.send(credits);
    } catch (error: any) {
      request.log.error({ error: error.message }, 'Failed to fetch credits');
      return reply.status(502).send({ error: 'Failed to fetch credit balance' });
    }
  });
}
