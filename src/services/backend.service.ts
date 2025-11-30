import { request, FormData } from 'undici';
import { config } from '../config';

export interface ArtworkUploadParams {
  originalImage: Buffer;
  originalFilename: string;
  originalContentType: string;
  protectedImage: Buffer;
  protectedFilename: string;
  protectedContentType: string;
  mask: Buffer; // Single SAC file containing encoded grayscale mask
  analysis: object;
  summary: object;
  metadata: {
    title: string;
    artist: string;
    description?: string;
    tags?: string[];
    createdAt?: string;
    extra?: object;
  };
}

export interface ArtworkUploadResponse {
  id: string;
  formats: {
    original: {
      contentType: string;
      bytes: number;
      checksum: string;
      fileId: string;
    };
    protected?: {
      contentType: string;
      bytes: number;
      checksum: string;
      fileId: string;
    };
    mask?: {
      contentType: string;
      bytes: number;
      checksum: string;
      fileId: string;
    };
  };
}

export interface UserHeaders {
  'X-User-Id'?: string;
  'X-User-Email'?: string;
  'X-User-Name'?: string;
}

export class BackendService {
  private baseUrl: string;
  private timeout: number;
  private internalApiKey: string | undefined;

  constructor() {
    this.baseUrl = config.backend.url;
    this.timeout = config.backend.timeout;
    this.internalApiKey = config.backend.internalApiKey;
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

  /**
   * Upload artwork with all variants to backend storage
   */
  async uploadArtwork(params: ArtworkUploadParams): Promise<ArtworkUploadResponse> {
    try {
      const formData = new FormData();

      // Add image files
      formData.append('original', new Blob([params.originalImage], { type: params.originalContentType }), params.originalFilename);
      formData.append('protected', new Blob([params.protectedImage], { type: params.protectedContentType }), params.protectedFilename);

      // Add SAC mask file (single grayscale mask)
      formData.append('mask', new Blob([params.mask], { type: 'application/octet-stream' }), 'mask.sac');

      // Add JSON files
      const analysisBlob = new Blob([JSON.stringify(params.analysis, null, 2)], { type: 'application/json' });
      const summaryBlob = new Blob([JSON.stringify(params.summary, null, 2)], { type: 'application/json' });
      formData.append('analysis', analysisBlob, 'analysis.json');
      formData.append('summary', summaryBlob, 'summary.json');

      // Add metadata fields
      formData.append('title', params.metadata.title);
      formData.append('artist', params.metadata.artist);

      if (params.metadata.description) {
        formData.append('description', params.metadata.description);
      }

      if (params.metadata.tags && params.metadata.tags.length > 0) {
        formData.append('tags', params.metadata.tags.join(','));
      }

      if (params.metadata.createdAt) {
        formData.append('createdAt', params.metadata.createdAt);
      }

      if (params.metadata.extra) {
        formData.append('extra', JSON.stringify(params.metadata.extra));
      }

      const response = await request(`${this.baseUrl}/artworks`, {
        method: 'POST',
        body: formData as any,
        bodyTimeout: this.timeout,
        headersTimeout: this.timeout,
      });

      if (response.statusCode !== 201) {
        const body = await response.body.text();
        throw new Error(`Backend returned ${response.statusCode}: ${body}`);
      }

      const data = await response.body.json();
      return data as ArtworkUploadResponse;
    } catch (error) {
      throw new Error(`Failed to upload artwork to backend: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Generate a one-time authentication token for processor upload
   * Returns a 16-character token that can be used once within 1 hour
   */
  async generateToken(metadata?: { source?: string; jobId?: string }, userHeaders?: UserHeaders): Promise<{ token: string; tokenId: string; expiresAt: string }> {
    try {
      const body = metadata ? JSON.stringify({ metadata }) : undefined;
      const baseHeaders: Record<string, string> = {};

      if (body) {
        baseHeaders['Content-Type'] = 'application/json';
      }

      // Add internal API key for service-to-service auth
      if (this.internalApiKey) {
        baseHeaders['X-Internal-Key'] = this.internalApiKey;
      }

      const headers = this.buildHeaders(baseHeaders, userHeaders);

      const response = await request(`${this.baseUrl}/tokens`, {
        method: 'POST',
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        body,
        bodyTimeout: this.timeout,
        headersTimeout: this.timeout,
      });

      if (response.statusCode !== 201) {
        const errorBody = await response.body.text();
        throw new Error(`Backend returned ${response.statusCode}: ${errorBody}`);
      }

      const data = await response.body.json() as { token: string; tokenId: string; expiresAt: string };
      return {
        token: data.token,
        tokenId: data.tokenId,
        expiresAt: data.expiresAt,
      };
    } catch (error) {
      throw new Error(`Failed to generate token from backend: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Check backend health
   */
  async healthCheck(): Promise<boolean> {
    try {
      const response = await request(`${this.baseUrl}/health`, {
        method: 'GET',
        headersTimeout: 5000,
      });
      return response.statusCode === 200;
    } catch {
      return false;
    }
  }

  /**
   * Check if artwork exists in backend
   */
  async checkExists(params: { checksum?: string; title?: string; artist?: string }, userHeaders?: UserHeaders): Promise<any> {
    try {
      const queryParams = new URLSearchParams();

      if (params.checksum) {
        queryParams.append('checksum', params.checksum);
      } else if (params.title && params.artist) {
        queryParams.append('title', params.title);
        queryParams.append('artist', params.artist);
      } else {
        return { exists: false, matches: [] };
      }

      const headers = this.buildHeaders(undefined, userHeaders);

      const response = await request(`${this.baseUrl}/artworks/check-exists?${queryParams.toString()}`, {
        method: 'GET',
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        headersTimeout: 5000,
      });

      if (response.statusCode !== 200) {
        return { exists: false, matches: [] };
      }

      return await response.body.json();
    } catch {
      return { exists: false, matches: [] };
    }
  }

  /**
   * Get artwork history for logged-in user
   */
  async getMyArtworks(fastifyRequest: any, params?: { limit?: number; skip?: number }): Promise<any> {
    try {
      const queryParams = new URLSearchParams();

      if (params?.limit !== undefined) {
        queryParams.append('limit', params.limit.toString());
      }

      if (params?.skip !== undefined) {
        queryParams.append('skip', params.skip.toString());
      }

      // Extract user headers from request
      const userHeaders: UserHeaders = {
        'X-User-Id': fastifyRequest.user?.id,
        'X-User-Email': fastifyRequest.user?.email,
        'X-User-Name': fastifyRequest.user?.name,
      };

      const headers = this.buildHeaders(undefined, userHeaders);

      const queryString = queryParams.toString();
      const url = queryString
        ? `${this.baseUrl}/artworks/me?${queryString}`
        : `${this.baseUrl}/artworks/me`;

      const response = await request(url, {
        method: 'GET',
        headers: Object.keys(headers).length > 0 ? headers : undefined,
        headersTimeout: this.timeout,
      });

      if (response.statusCode !== 200) {
        const errorBody = await response.body.text();
        throw new Error(`Backend returned ${response.statusCode}: ${errorBody}`);
      }

      return await response.body.json();
    } catch (error) {
      throw new Error(`Failed to fetch user artworks from backend: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

// Singleton instance
let instance: BackendService | null = null;

export function getBackendService(): BackendService {
  if (!instance) {
    instance = new BackendService();
  }
  return instance;
}
