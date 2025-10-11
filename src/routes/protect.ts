import { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import sharp from 'sharp';
import crypto from 'crypto';
import { protectRequestSchema, ALLOWED_PROCESSORS } from '../types/schemas';
import {
  normalizeTags,
  normalizeProcessors,
  parseExtraMetadata,
  parseBoolean,
} from '../utils/normalize';
import { getDuplicateService } from '../services/duplicate.service';
import { getProcessorService } from '../services/processor.service';
import { getBackendService } from '../services/backend.service';
import { config } from '../config';

interface MultipartBody {
  [key: string]: {
    value: any;
    type?: string;
    filename?: string;
    encoding?: string;
    mimetype?: string;
    toBuffer?: () => Promise<Buffer>;
  };
}

export async function protectRoute(app: FastifyInstance) {
  app.post('/protect', async (request: FastifyRequest, reply: FastifyReply) => {
    const isMultipart = request.headers['content-type']?.includes('multipart/form-data');
    const isJSON = request.headers['content-type']?.includes('application/json');

    if (!isMultipart && !isJSON) {
      return reply.status(400).send({
        error: 'Content-Type must be multipart/form-data or application/json',
      });
    }

    try {
      let payload: any = {};
      let imageBuffer: Buffer | undefined;
      let imageFilename: string | undefined;
      let imageChecksum: string | undefined;

      // Handle multipart form data
      if (isMultipart) {
        const body = request.body as MultipartBody;

        // Extract image file
        if (body.image?.toBuffer) {
          imageBuffer = await body.image.toBuffer();
          imageFilename = body.image.filename || 'image.jpg';

          // Calculate checksum
          imageChecksum = `sha256:${crypto.createHash('sha256').update(imageBuffer).digest('hex')}`;

          // Validate image
          try {
            const metadata = await sharp(imageBuffer).metadata();
            if (!metadata.width || !metadata.height) {
              return reply.status(400).send({ error: 'Invalid image file' });
            }
          } catch {
            return reply.status(400).send({ error: 'Invalid image file format' });
          }
        }

        // Extract all other fields
        for (const [key, field] of Object.entries(body)) {
          if (key !== 'image') {
            payload[key] = field.value;
          }
        }
      }
      // Handle JSON
      else {
        payload = request.body as any;
      }

      // Convert camelCase to snake_case and parse booleans
      const normalized: any = {};
      for (const [key, value] of Object.entries(payload)) {
        const snakeKey = key.replace(/([A-Z])/g, '_$1').toLowerCase();

        // Parse boolean-like strings
        if (typeof value === 'string' && (value === 'true' || value === 'false' || value === '1' || value === '0')) {
          normalized[snakeKey] = parseBoolean(value);
        } else {
          normalized[snakeKey] = value;
        }
      }

      // Normalize tags
      if (normalized.tags) {
        try {
          normalized.tags = normalizeTags(normalized.tags);
        } catch (error: any) {
          return reply.status(400).send({ error: error.message });
        }
      }

      // Normalize processors
      if (normalized.processors) {
        try {
          normalized.processors = normalizeProcessors(normalized.processors);
          // Validate processor names
          for (const proc of normalized.processors) {
            if (!ALLOWED_PROCESSORS.includes(proc as any)) {
              return reply.status(400).send({
                error: `Unknown processor: ${proc}`,
              });
            }
          }
        } catch (error: any) {
          return reply.status(400).send({ error: error.message });
        }
      }

      // Parse extra_metadata
      if (normalized.extra_metadata) {
        try {
          normalized.extra_metadata = parseExtraMetadata(normalized.extra_metadata);
        } catch (error: any) {
          return reply.status(400).send({ error: error.message });
        }
      }

      // Validate with Zod
      const validationResult = protectRequestSchema.safeParse(normalized);
      if (!validationResult.success) {
        const firstError = validationResult.error.errors[0];
        return reply.status(400).send({
          error: `${firstError.path.join('.')}: ${firstError.message}`,
        });
      }

      const validatedPayload = validationResult.data;

      // Check for duplicates (if we have checksum or title+artist)
      const duplicateService = getDuplicateService();
      const duplicateCheck = await duplicateService.checkExists({
        checksum: imageChecksum,
        title: validatedPayload.artwork_title,
        artist: validatedPayload.artist_name,
        tags: validatedPayload.tags as string[] | undefined,
      });

      if (duplicateCheck.exists) {
        request.log.info({ artwork: duplicateCheck.artwork }, 'Duplicate artwork detected');
        return reply.status(200).send({
          job_id: duplicateCheck.artwork._id,
          status: 'exists',
          message: 'Artwork already exists',
          artwork: duplicateCheck.artwork,
        });
      }

      // Generate UUID for job
      const jobId = crypto.randomUUID();

      // Generate callback URL
      const callbackUrl = `${config.router.baseUrl}/callbacks/process-complete`;
      const callbackAuthToken = config.router.callbackAuthToken;

      // Generate one-time authentication token for processor-to-backend upload
      const backendService = getBackendService();
      const tokenData = await backendService.generateToken({
        source: 'router',
        jobId: jobId,
      });

      request.log.info(
        {
          job_id: jobId,
          token_id: tokenData.tokenId,
          expires_at: tokenData.expiresAt
        },
        'Generated one-time backend auth token for processor upload'
      );

      // Submit to processor with callback and backend auth token
      const processorService = getProcessorService();
      await processorService.submitJobWithCallback(
        jobId,
        validatedPayload,
        imageBuffer,
        imageFilename,
        callbackUrl,
        callbackAuthToken,
        tokenData.token
      );

      request.log.info({ job_id: jobId, callback_url: callbackUrl }, 'Job submitted to processor with callback');

      return reply.status(202).send({
        job_id: jobId,
        status: 'processing',
        message: 'Job queued for processing. Results will be available via callback.',
      });
    } catch (error: any) {
      request.log.error(error, 'Error processing protect request');

      // Circuit breaker errors
      if (error.message?.includes('circuit breaker')) {
        return reply.status(503).send({
          error: 'Processor service temporarily unavailable',
        });
      }

      // Processor errors
      if (error.message?.includes('Processor returned')) {
        return reply.status(502).send({
          error: 'Upstream processor error',
          detail: error.message,
        });
      }

      throw error;
    }
  });
}
