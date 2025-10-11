/**
 * Temporary storage for original images until processor callback completes
 * Stores images in memory with automatic cleanup after 1 hour
 */

interface StoredUpload {
  buffer: Buffer;
  filename: string;
  contentType: string;
  checksum: string;
  storedAt: number;
}

export class UploadStorageService {
  private storage: Map<string, StoredUpload> = new Map();
  private readonly TTL_MS = 60 * 60 * 1000; // 1 hour
  private cleanupInterval: NodeJS.Timeout | null = null;

  constructor() {
    // Start automatic cleanup every 10 minutes
    this.startCleanup();
  }

  /**
   * Store original image temporarily
   */
  store(jobId: string, buffer: Buffer, filename: string, contentType: string, checksum: string): void {
    this.storage.set(jobId, {
      buffer,
      filename,
      contentType,
      checksum,
      storedAt: Date.now(),
    });
  }

  /**
   * Retrieve and remove stored image
   */
  retrieve(jobId: string): StoredUpload | null {
    const upload = this.storage.get(jobId);
    if (!upload) {
      return null;
    }

    // Check if expired
    const age = Date.now() - upload.storedAt;
    if (age > this.TTL_MS) {
      this.storage.delete(jobId);
      return null;
    }

    // Delete after retrieval (one-time use)
    this.storage.delete(jobId);
    return upload;
  }

  /**
   * Check if upload exists (without retrieving)
   */
  has(jobId: string): boolean {
    return this.storage.has(jobId);
  }

  /**
   * Manually delete stored upload
   */
  delete(jobId: string): boolean {
    return this.storage.delete(jobId);
  }

  /**
   * Get storage stats
   */
  getStats() {
    const totalSize = Array.from(this.storage.values()).reduce(
      (sum, upload) => sum + upload.buffer.length,
      0
    );

    return {
      count: this.storage.size,
      totalBytes: totalSize,
      totalMB: (totalSize / 1024 / 1024).toFixed(2),
    };
  }

  /**
   * Start automatic cleanup of expired uploads
   */
  private startCleanup(): void {
    if (this.cleanupInterval) {
      return;
    }

    // Run cleanup every 10 minutes
    this.cleanupInterval = setInterval(() => {
      this.cleanup();
    }, 10 * 60 * 1000);
  }

  /**
   * Clean up expired uploads
   */
  private cleanup(): void {
    const now = Date.now();
    let deletedCount = 0;

    for (const [jobId, upload] of this.storage.entries()) {
      const age = now - upload.storedAt;
      if (age > this.TTL_MS) {
        this.storage.delete(jobId);
        deletedCount++;
      }
    }

    if (deletedCount > 0) {
      console.log(`[UploadStorage] Cleaned up ${deletedCount} expired uploads`);
    }
  }

  /**
   * Stop cleanup interval (for graceful shutdown)
   */
  stopCleanup(): void {
    if (this.cleanupInterval) {
      clearInterval(this.cleanupInterval);
      this.cleanupInterval = null;
    }
  }

  /**
   * Clear all stored uploads (for testing)
   */
  clear(): void {
    this.storage.clear();
  }
}

// Singleton instance
let instance: UploadStorageService | null = null;

export function getUploadStorage(): UploadStorageService {
  if (!instance) {
    instance = new UploadStorageService();
  }
  return instance;
}
