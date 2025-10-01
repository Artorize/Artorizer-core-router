import { MongoClient, Db } from 'mongodb';
import { config } from '../config';

export class DuplicateDetectionService {
  private client: MongoClient;
  private db: Db | null = null;

  constructor() {
    this.client = new MongoClient(config.mongodb.uri, {
      maxPoolSize: 20,
      minPoolSize: 5,
    });
  }

  async connect(): Promise<void> {
    await this.client.connect();
    this.db = this.client.db();
  }

  async disconnect(): Promise<void> {
    await this.client.close();
  }

  /**
   * Check if artwork exists by checksum, title+artist, or tags
   */
  async checkExists(params: {
    checksum?: string;
    title?: string;
    artist?: string;
    tags?: string[];
  }): Promise<{ exists: boolean; artwork?: any }> {
    if (!this.db) {
      throw new Error('Database not connected');
    }

    const query: any = {};

    // Check by checksum (highest priority)
    if (params.checksum) {
      query['formats.original.checksum'] = params.checksum;
    }
    // Check by title + artist
    else if (params.title && params.artist) {
      query.title = params.title;
      query.artist = params.artist;
    }
    // Check by tags
    else if (params.tags && params.tags.length > 0) {
      query.tags = { $all: params.tags };
    } else {
      return { exists: false };
    }

    const artwork = await this.db.collection('artworks').findOne(query, {
      projection: {
        _id: 1,
        title: 1,
        artist: 1,
        uploadedAt: 1,
        'formats.original.checksum': 1,
      },
    });

    return {
      exists: !!artwork,
      artwork: artwork || undefined,
    };
  }

  /**
   * Get artwork by ID
   */
  async getArtworkById(id: string): Promise<any | null> {
    if (!this.db) {
      throw new Error('Database not connected');
    }

    return await this.db.collection('artworks').findOne({ _id: id } as any);
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
