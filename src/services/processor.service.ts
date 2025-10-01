import { request, FormData } from 'undici';
import { config } from '../config';
import { ProtectRequest, ProcessorResponse, processorResponseSchema } from '../types/schemas';

export class ProcessorService {
  private baseUrl: string;
  private timeout: number;
  private failureCount = 0;
  private circuitOpen = false;
  private lastFailureTime = 0;
  private readonly CIRCUIT_THRESHOLD = 5;
  private readonly CIRCUIT_TIMEOUT = 30000; // 30s

  constructor() {
    this.baseUrl = config.processor.url;
    this.timeout = config.processor.timeout;
  }

  /**
   * Check if circuit breaker is open
   */
  private checkCircuit(): void {
    if (this.circuitOpen) {
      const elapsed = Date.now() - this.lastFailureTime;
      if (elapsed > this.CIRCUIT_TIMEOUT) {
        this.circuitOpen = false;
        this.failureCount = 0;
      } else {
        throw new Error('Processor circuit breaker is open - service temporarily unavailable');
      }
    }
  }

  /**
   * Record failure for circuit breaker
   */
  private recordFailure(): void {
    this.failureCount++;
    this.lastFailureTime = Date.now();

    if (this.failureCount >= this.CIRCUIT_THRESHOLD) {
      this.circuitOpen = true;
    }
  }

  /**
   * Reset circuit breaker on success
   */
  private recordSuccess(): void {
    this.failureCount = 0;
    this.circuitOpen = false;
  }

  /**
   * Submit job to processor (JSON payload)
   */
  async submitJobJSON(payload: ProtectRequest): Promise<ProcessorResponse> {
    this.checkCircuit();

    try {
      const response = await request(`${this.baseUrl}/v1/jobs`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
        },
        body: JSON.stringify(payload),
        bodyTimeout: this.timeout,
        headersTimeout: this.timeout,
      });

      if (response.statusCode !== 200 && response.statusCode !== 202) {
        const body = await response.body.text();
        throw new Error(`Processor returned ${response.statusCode}: ${body}`);
      }

      const data = await response.body.json();
      this.recordSuccess();

      return processorResponseSchema.parse(data);
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Submit job to processor (multipart with file)
   */
  async submitJobMultipart(
    payload: ProtectRequest,
    fileBuffer: Buffer,
    filename: string
  ): Promise<ProcessorResponse> {
    this.checkCircuit();

    try {
      const formData = new FormData();

      // Add file
      formData.append('file', new Blob([fileBuffer]), filename);

      // Add all payload fields as form data
      for (const [key, value] of Object.entries(payload)) {
        if (value !== undefined && value !== null) {
          if (Array.isArray(value)) {
            formData.append(key, value.join(','));
          } else if (typeof value === 'object') {
            formData.append(key, JSON.stringify(value));
          } else {
            formData.append(key, String(value));
          }
        }
      }

      const response = await request(`${this.baseUrl}/v1/jobs`, {
        method: 'POST',
        body: formData as any,
        bodyTimeout: this.timeout,
        headersTimeout: this.timeout,
      });

      if (response.statusCode !== 200 && response.statusCode !== 202) {
        const body = await response.body.text();
        throw new Error(`Processor returned ${response.statusCode}: ${body}`);
      }

      const data = await response.body.json();
      this.recordSuccess();

      return processorResponseSchema.parse(data);
    } catch (error) {
      this.recordFailure();
      throw error;
    }
  }

  /**
   * Check processor health
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
   * Get circuit breaker status
   */
  getStatus() {
    return {
      circuitOpen: this.circuitOpen,
      failureCount: this.failureCount,
      lastFailureTime: this.lastFailureTime,
    };
  }
}

// Singleton instance
let instance: ProcessorService | null = null;

export function getProcessorService(): ProcessorService {
  if (!instance) {
    instance = new ProcessorService();
  }
  return instance;
}
