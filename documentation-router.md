# Artorizer Core Router - Ingress API Specification

This router accepts client submissions, validates metadata/config, and forwards normalized jobs to the Processor Core (`/v1/jobs`).

## Endpoint

POST /protect
Content-Type:
- multipart/form-data (preferred when uploading a file)
- application/json (for remote URL or previously uploaded path)

## Required / Conditional Inputs

At least one image source:
- image (file, required if no image_url/local_path)
- image_url (string, optional)
- local_path (string, optional, internal use)

## Metadata Fields

| Field | Type | Required | Notes |
|-------|------|----------|-------|
| artist_name | string (1-120) | yes | Artist or creator |
| artwork_title | string (1-200) | yes | Title of artwork |
| artwork_description | string (0-2000) | no | Description |
| artwork_creation_time | ISO 8601 string | no | Defaults to receipt time |
| tags | array[string] or comma string | no | <=25, each <=50 chars |
| extra_metadata | JSON object/string | no | Arbitrary structured data |

## Processing Control Flags

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| include_hash_analysis | bool | true | Run analysis processors |
| include_protection | bool | true | Run protection layers |
| processors | array[string] or comma string | (all) | Subset of analysis processors |
| enable_tineye | bool | false | Requires upstream API key |
| max_stage_dim | int | 512 | Resize bound for protection pipeline |

## Analysis Processors (Allowed Values)

metadata,imagehash,dhash,blockhash,stegano,tineye

If `processors` omitted and `include_hash_analysis=true`, all except `tineye` run (unless enable_tineye=true).

## Protection Layers and Toggles

| Layer Name | Toggle Field | Default |
|------------|-------------|---------|
| fawkes | enable_fawkes | true |
| photoguard | enable_photoguard | true |
| mist | enable_mist | true |
| nightshade | enable_nightshade | true |
| invisible-watermark | (via watermark_strategy) | active when strategy=invisible-watermark |
| tree-ring | (via watermark_strategy) | active when strategy=tree-ring |
| stegano-embed | enable_stegano_embed | false |
| c2pa-manifest | enable_c2pa_manifest | true |

Watermark selection:
- watermark_strategy: invisible-watermark | tree-ring | none (default: invisible-watermark)
- watermark_text: string (default: "artscraper")

Tree ring parameters:
- tree_ring_frequency (float, default 9.0, range 1–32)
- tree_ring_amplitude (float, default 18.0, range 1–64)

Stegano embedding:
- enable_stegano_embed (bool, default false)
- stegano_message (string, default "Protected by artscraper")

C2PA manifest (optional detail fields):
- enable_c2pa_manifest (bool, default true)
- c2pa_claim_generator (string, optional)
- c2pa_assertions (JSON array/object, optional)
- c2pa_vendor (string, optional)

## Normalization Rules (Router Behavior)

1. Accept both camelCase and snake_case; forward as snake_case.
2. Convert boolean-like strings ("true","1") to bools.
3. Reject unknown processors with 400.
4. Enforce size/dimension pre-check (optional future hook).
5. Forward only explicitly provided overrides; rely on Processor defaults otherwise.

## Example Multipart Request

```bash
curl -X POST http://localhost:7000/protect \
 -F "image=@forest.jpg" \
 -F "artist_name=Jane Doe" \
 -F "artwork_title=Shaded Forest" \
 -F "artwork_description=A moody forest render" \
 -F "tags=forest,moody,autumn" \
 -F "include_hash_analysis=true" \
 -F "processors=metadata,imagehash,blockhash" \
 -F "include_protection=true" \
 -F "watermark_strategy=tree-ring" \
 -F "tree_ring_frequency=8.5" \
 -F "tree_ring_amplitude=16.0" \
 -F "enable_stegano_embed=true" \
 -F "stegano_message=Protected by artscraper" \
 -F "enable_nightshade=false"
```

## Example JSON Request (Remote Image)

```json
{
  "image_url": "https://example.com/scene.png",
  "artist_name": "Jane Doe",
  "artwork_title": "Scene Study",
  "artwork_description": "Lighting exploration",
  "tags": ["study","lighting"],
  "include_hash_analysis": true,
  "processors": ["metadata","imagehash","dhash"],
  "include_protection": true,
  "watermark_strategy": "invisible-watermark",
  "enable_stegano_embed": false,
  "enable_c2pa_manifest": true
}
```

## Forwarded Payload (Router -> Processor Core)

```json
{
  "image_url": "https://example.com/scene.png",
  "artist_name": "Jane Doe",
  "artwork_title": "Scene Study",
  "artwork_description": "Lighting exploration",
  "tags": ["study","lighting"],
  "include_hash_analysis": true,
  "processors": ["metadata","imagehash","dhash"],
  "include_protection": true,
  "watermark_strategy": "invisible-watermark",
  "enable_stegano_embed": false,
  "enable_c2pa_manifest": true
}
```

## Validation Failures (Examples)

```json
{ "error": "artist_name is required" }
```
```json
{ "error": "Unknown processor: perceptualhash2" }
```
```json
{ "error": "Too many tags (max 25)" }
```

## Response (Proxy from Processor Core)

On success (forwarded 202/200):

```json
{
  "job_id": "abc123def456",
  "status": "queued"
}
```

Errors are transparently relayed or wrapped:

```json
{
  "error": "Upstream processor unavailable"
}
```

## Field Summary (Quick Reference)

Required Minimum:
- artist_name
- artwork_title
- one of (image | image_url | local_path)

Optional Enhancers:
- processors[]
- watermark_* params
- stegano_* params
- c2pa_* params
- tags / extra_metadata

## Defaults Recap

| Field | Default |
|-------|---------|
| include_hash_analysis | true |
| include_protection | true |
| enable_tineye | false |
| watermark_strategy | invisible-watermark |
| watermark_text | artscraper |
| enable_stegano_embed | false |
| stegano_message | Protected by artscraper |
| enable_c2pa_manifest | true |
| max_stage_dim | 512 |

## Notes

- If both invisible-watermark and tree-ring desired, router must schedule two separate jobs (current pipeline selects one strategy).
- Setting include_protection=false ignores all protection-layer toggles even if individually true.
- Setting processors=[] (explicit empty) disables all analysis unless include_hash_analysis=false already.
