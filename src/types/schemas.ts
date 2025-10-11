import { z } from 'zod';

// Allowed processor names
export const ALLOWED_PROCESSORS = [
  'metadata',
  'imagehash',
  'dhash',
  'blockhash',
  'stegano',
  'tineye',
] as const;

export const WATERMARK_STRATEGIES = ['invisible-watermark', 'tree-ring', 'none'] as const;

// Main protect request schema
export const protectRequestSchema = z.object({
  // Image source (at least one required)
  image_url: z.string().url().optional(),
  local_path: z.string().optional(),

  // Required metadata
  artist_name: z.string().min(1).max(120),
  artwork_title: z.string().min(1).max(200),

  // Optional metadata
  artwork_description: z.string().max(2000).optional(),
  artwork_creation_time: z.string().datetime().optional(),
  tags: z.union([z.array(z.string().max(50)), z.string()]).optional(),
  extra_metadata: z.union([z.record(z.any()), z.string()]).optional(),

  // Processing control flags
  include_hash_analysis: z.coerce.boolean().default(true),
  include_protection: z.coerce.boolean().default(true),
  processors: z.union([z.array(z.enum(ALLOWED_PROCESSORS)), z.string()]).optional(),
  enable_tineye: z.coerce.boolean().default(false),
  max_stage_dim: z.coerce.number().int().min(128).max(4096).default(512),

  // Protection layer toggles
  enable_fawkes: z.coerce.boolean().default(true),
  enable_photoguard: z.coerce.boolean().default(true),
  enable_mist: z.coerce.boolean().default(true),
  enable_nightshade: z.coerce.boolean().default(true),
  enable_stegano_embed: z.coerce.boolean().default(false),
  enable_c2pa_manifest: z.coerce.boolean().default(true),

  // Watermark parameters
  watermark_strategy: z.enum(WATERMARK_STRATEGIES).default('invisible-watermark'),
  watermark_strength: z.coerce.number().min(0).max(1).default(0.5),
  watermark_text: z.string().default('artscraper'),
  tree_ring_frequency: z.coerce.number().min(1).max(32).default(9.0),
  tree_ring_amplitude: z.coerce.number().min(1).max(64).default(18.0),

  // Stegano parameters
  stegano_message: z.string().default('Protected by artscraper'),

  // C2PA parameters
  c2pa_claim_generator: z.string().optional(),
  c2pa_assertions: z.union([z.array(z.any()), z.record(z.any())]).optional(),
  c2pa_vendor: z.string().optional(),
});

export type ProtectRequest = z.infer<typeof protectRequestSchema>;

// Processor response schema
export const processorResponseSchema = z.object({
  job_id: z.string(),
  status: z.string(),
});

export type ProcessorResponse = z.infer<typeof processorResponseSchema>;
