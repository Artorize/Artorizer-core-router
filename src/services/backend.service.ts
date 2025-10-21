import { request, FormData } from 'undici';
import { config } from '../config';

export interface ArtworkUploadParams {
  originalImage: Buffer;
  originalFilename: string;
  originalContentType: string;
  protectedImage: Buffer;
  protectedFilename: string;
  protectedContentType: string;
  maskHi: Buffer;
  maskLo: Buffer;
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
    mask_hi?: {
      contentType: string;
      bytes: number;
      checksum: string;
      fileId: string;
    };
    mask_lo?: {
      contentType: string;
      bytes: number;
      checksum: string;
      fileId: string;
    };
  };
}

export class BackendService {
  private baseUrl: string;
  private timeout: number;

  constructor() {
    this.baseUrl = config.backend.url;
    this.timeout = config.backend.timeout;
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

      // Add SAC mask files (both high and low res)
      formData.append('maskHi', new Blob([params.maskHi], { type: 'application/octet-stream' }), 'mask_hi.sac');
      formData.append('maskLo', new Blob([params.maskLo], { type: 'application/octet-stream' }), 'mask_lo.sac');

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
  async generateToken(metadata?: { source?: string; jobId?: string }): Promise<{ token: string; tokenId: string; expiresAt: string }> {
    try {
      const body = metadata ? JSON.stringify({ metadata }) : undefined;

      const response = await request(`${this.baseUrl}/tokens`, {
        method: 'POST',
        headers: body ? { 'Content-Type': 'application/json' } : undefined,
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
  async checkExists(params: { checksum?: string; title?: string; artist?: string }): Promise<any> {
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

      const response = await request(`${this.baseUrl}/artworks/check-exists?${queryParams.toString()}`, {
        method: 'GET',
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
}

// Singleton instance
let instance: BackendService | null = null;

export function getBackendService(): BackendService {
  if (!instance) {
    instance = new BackendService();
  }
  return instance;
}
