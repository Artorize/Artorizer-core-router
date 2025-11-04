import { request } from 'undici';
import pino from 'pino';
import { config } from '../config';

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
   * Check if artwork exists by checksum, title+artist, or tags
   * Uses Backend API: GET /artworks/check-exists
   */
  async checkExists(params: {
    checksum?: string;
    title?: string;
    artist?: string;
    tags?: string[];
  }): Promise<{ exists: boolean; artwork?: any }> {
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

      const response = await request(
        `${this.baseUrl}/artworks/check-exists?${queryParams.toString()}`,
        {
          method: 'GET',
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
          artwork: data.matches[0], // Return first match
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
  async getArtworkById(id: string): Promise<any | null> {
    try {
      const response = await request(`${this.baseUrl}/artworks/${id}/metadata`, {
        method: 'GET',
        headersTimeout: this.timeout,
      });

      if (response.statusCode === 404) {
        return null;
      }

      if (response.statusCode !== 200) {
        throw new Error(`Backend returned ${response.statusCode}`);
      }

      return await response.body.json();
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
  async getJobStatus(jobId: string): Promise<any | null> {
    try {
      const response = await request(`${this.baseUrl}/artworks/${jobId}/metadata`, {
        method: 'GET',
        headersTimeout: this.timeout,
      });

      if (response.statusCode === 404) {
        return null;
      }

      if (response.statusCode !== 200) {
        throw new Error(`Backend returned ${response.statusCode}`);
      }

      const artwork = await response.body.json() as any;

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
