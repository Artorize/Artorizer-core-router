import { request } from 'undici';
import pino from 'pino';
import { config } from '../config';
import type { UserHeaders } from './backend.service';

// Create logger for duplicate service
const logger = pino({
  level: config.nodeEnv === 'production' ? 'info' : 'debug',
  formatters: {
    level: (label) => ({ level: label }),
  },
  timestamp: pino.stdTimeFunctions.isoTime,
});

/**
 * Service for checking duplicates and retrieving artwork metadata via Backend API
 * No direct database access - all operations go through the backend
 */
export class DuplicateDetectionService {
  private baseUrl: string;
  private timeout: number;

  constructor() {
    this.baseUrl = config.backend.url;
    this.timeout = config.backend.timeout;
  }

  /**
   * Merge user headers with request headers
   */
  private buildHeaders(baseHeaders?: Record<string, string>, userHeaders?: UserHeaders): Record<string, string> {
    const headers: Record<string, string> = { ...baseHeaders };

    if (userHeaders) {
      if (userHeaders['X-User-Id']) headers['X-User-Id'] = userHeaders['X-User-Id'];
      if (userHeaders['X-User-Email']) headers['X-User-Email'] = userHeaders['X-User-Email'];
      if (userHeaders['X-User-Name']) headers['X-User-Name'] = userHeaders['X-User-Name'];
    }

    return headers;
  }

  private normalizeArtwork<T extends Record<string, any>>(artwork: T | null | undefined): T | null | undefined {
    if (!artwork) {
      return artwork;
    }

    const normalizedId =
      artwork._id ??
      artwork.id ??
      artwork.artwork_id ??
      artwork.artworkId ??
      artwork.metadata?.id ??
      artwork.metadata?._id;

    if (!normalizedId) {
      return artwork;
    }

    return {
      ...artwork,
      _id: normalizedId,
      id: normalizedId,
      artwork_id: normalizedId,
    };
  }

  /**
   * Check if artwork exists by checksum, title+artist, or tags
   * Uses Backend API: GET /artworks/check-exists
   */
  async checkExists(params: {
    checksum?: string;
    title?: string;
    artist?: string;
    tags?: string[];
  }, userHeaders?: UserHeaders): Promise<{ exists: boolean; artwork?: any }> {
    try {
      const queryParams = new URLSearchParams();

      // Build query parameters based on what's provided
      if (params.checksum) {
        queryParams.append('checksum', params.checksum);
      } else if (params.title && params.artist) {
        queryParams.append('title', params.title);
        queryParams.append('artist', params.artist);
      } else if (params.tags && params.tags.length > 0) {
        queryParams.append('tags', params.tags.join(','));
      } else {
        return { exists: false };
      }

      const headers = this.buildHeaders(undefined, userHeaders);

      const response = await request(
        `${this.baseUrl}/artworks/check-exists?${queryParams.toString()}`,
        {
          method: 'GET',
          headers: Object.keys(headers).length > 0 ? headers : undefined,
          headersTimeout: this.timeout,
        }
      );

      if (response.statusCode !== 200) {
        return { exists: false };
      }

      const data = await response.body.json() as any;

      // Backend returns: { exists: boolean, matchCount: number, matches: [...] }
      if (data.exists && data.matches && data.matches.length > 0) {
        return {
          exists: true,
          artwork: this.normalizeArtwork(data.matches[0]) ?? data.matches[0],
        };
      }

      return { exists: false };
    } catch (error) {
      // On error, assume not exists (fail open for duplicate check)
      logger.error({ error }, 'Error checking for duplicates');
      return { exists: false };
    }
  }

  /**
   * Get artwork by ID
   * Uses Backend API: GET /artworks/{id}/metadata
   */
  async getArtworkById(id: string, userHeaders?: UserHeaders): Promise<any | null> {
    try {
      const url = `${this.baseUrl}/artworks/${id}/metadata`;
      logger.info({ artwork_id: id, url }, 'Querying backend for artwork');

      const headers = this.buildHeaders(undefined, userHeaders);

      const response = await request(url, {
        method: 'GET',
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        headersTimeout: this.timeout,
      });

      if (response.statusCode === 404) {
        logger.info({ artwork_id: id }, 'Artwork not found in backend');
        return null;
      }

      if (response.statusCode !== 200) {
        logger.error({ artwork_id: id, statusCode: response.statusCode }, 'Backend returned error');
        throw new Error(`Backend returned ${response.statusCode}`);
      }

      const rawArtwork = await response.body.json() as Record<string, any> | null;
      const artwork = this.normalizeArtwork(rawArtwork);
      return artwork;
    } catch (error) {
      if ((error as any).message?.includes('404')) {
        return null;
      }
      throw new Error(
        `Failed to get artwork: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }

  /**
   * Get job status
   * Uses Backend API: GET /artworks/{id}/metadata (partial projection)
   */
  async getJobStatus(jobId: string, userHeaders?: UserHeaders): Promise<any | null> {
    try {
      const headers = this.buildHeaders(undefined, userHeaders);

      const response = await request(`${this.baseUrl}/artworks/${jobId}/metadata`, {
        method: 'GET',
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        headersTimeout: this.timeout,
      });

      if (response.statusCode === 404) {
        return null;
      }

      if (response.statusCode !== 200) {
        throw new Error(`Backend returned ${response.statusCode}`);
      }

      const rawArtwork = await response.body.json() as Record<string, any> | null;
      const artwork = this.normalizeArtwork(rawArtwork);

      if (!artwork) {
        return null;
      }

      // Return only status-related fields
      return {
        _id: artwork._id,
        status: 'completed', // If it exists in backend, it's completed
        completedAt: artwork.createdAt,
        uploadedAt: artwork.uploadedAt,
      };
    } catch (error) {
      if ((error as any).message?.includes('404')) {
        return null;
      }
      throw new Error(
        `Failed to get job status: ${error instanceof Error ? error.message : String(error)}`
      );
    }
  }
}

// Singleton instance
let instance: DuplicateDetectionService | null = null;

export function getDuplicateService(): DuplicateDetectionService {
  if (!instance) {
    instance = new DuplicateDetectionService();
  }
  return instance;
}
