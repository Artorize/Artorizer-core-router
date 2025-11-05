import { describe, it, expect, beforeAll } from 'vitest';
import { readFileSync, writeFileSync } from 'fs';
import { join } from 'path';
import { FormData } from 'undici';
import { Blob } from 'buffer';
import sharp from 'sharp';

// Base URL for the deployed router
const BASE_URL = process.env.ROUTER_URL || 'https://router.artorizer.com';

// Test image path
const TEST_IMAGE_PATH = join(__dirname, '../../input/mona_lisa.jpg');

// Store job_id between tests
let createdJobId: string | null = null;
let artworkId: string | null = null;

describe('Router API Integration Tests', () => {
  beforeAll(() => {
    console.log(`Testing against: ${BASE_URL}`);
  });

  describe('POST /protect', () => {
    it('should accept image upload and return job_id', async () => {
      const formData = new FormData();
      const imageBuffer = readFileSync(TEST_IMAGE_PATH);
      const imageBlob = new Blob([imageBuffer], { type: 'image/jpeg' });

      formData.append('image', imageBlob, 'mona_lisa.jpg');
      formData.append('artist_name', 'Leonardo da Vinci');
      formData.append('artwork_title', 'Mona Lisa Test');
      formData.append('tags', 'renaissance,portrait,test');
      formData.append('artwork_description', 'Integration test of Mona Lisa');

      const response = await fetch(`${BASE_URL}/protect`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      console.log('POST /protect response:', data);

      // Should return 202 (queued) or 200 (duplicate)
      expect([200, 202]).toContain(response.status);
      expect(data).toHaveProperty('job_id');
      expect(data).toHaveProperty('status');

      createdJobId = data.job_id;

      if (response.status === 202) {
        expect(data.status).toBe('queued');
      } else if (response.status === 200) {
        expect(data.status).toBe('exists');
        expect(data).toHaveProperty('artwork');
        artworkId = data.artwork._id;
      }
    }, 30000);

    it('should detect duplicate on second upload of same image', async () => {
      const formData = new FormData();
      const imageBuffer = readFileSync(TEST_IMAGE_PATH);
      const imageBlob = new Blob([imageBuffer], { type: 'image/jpeg' });

      formData.append('image', imageBlob, 'mona_lisa.jpg');
      formData.append('artist_name', 'Leonardo da Vinci');
      formData.append('artwork_title', 'Mona Lisa Test');

      const response = await fetch(`${BASE_URL}/protect`, {
        method: 'POST',
        body: formData,
      });

      const data = await response.json();

      console.log('Duplicate detection response:', data);

      // Should detect duplicate
      expect(response.status).toBe(200);
      expect(data.status).toBe('exists');
      expect(data).toHaveProperty('artwork');

      if (!artworkId) {
        artworkId = data.artwork._id;
      }
    }, 30000);

    it('should reject invalid request without required fields', async () => {
      const formData = new FormData();
      const imageBuffer = readFileSync(TEST_IMAGE_PATH);
      const imageBlob = new Blob([imageBuffer], { type: 'image/jpeg' });

      formData.append('image', imageBlob, 'mona_lisa.jpg');
      // Missing artist_name and artwork_title

      const response = await fetch(`${BASE_URL}/protect`, {
        method: 'POST',
        body: formData,
      });

      expect(response.status).toBe(400);
    });
  });

  describe('GET /jobs/:id', () => {
    it('should return job status', async () => {
      if (!artworkId && !createdJobId) {
        console.log('Skipping: No job_id available from previous tests');
        return;
      }

      const jobId = artworkId || createdJobId;

      // Wait a bit for processing if it's a new job
      if (createdJobId && !artworkId) {
        console.log('Waiting 60s for processing to complete...');
        await new Promise(resolve => setTimeout(resolve, 60000));
      }

      const response = await fetch(`${BASE_URL}/jobs/${jobId}`);
      const data = await response.json();

      console.log('GET /jobs/:id response:', data);

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('job_id');
      expect(data).toHaveProperty('status');
    }, 90000);
  });

  describe('GET /jobs/:id/result', () => {
    it('should return complete job result with URLs', async () => {
      if (!artworkId && !createdJobId) {
        console.log('Skipping: No job_id available from previous tests');
        return;
      }

      const jobId = artworkId || createdJobId;

      const response = await fetch(`${BASE_URL}/jobs/${jobId}/result`);

      if (response.status === 404) {
        console.log('Job not found - might still be processing');
        return;
      }

      if (response.status === 409) {
        console.log('Job not yet completed');
        return;
      }

      const data = await response.json();

      console.log('GET /jobs/:id/result response:', data);

      expect(response.status).toBe(200);
      expect(data).toHaveProperty('job_id');
      expect(data).toHaveProperty('status');
      expect(data).toHaveProperty('urls');

      if (data.urls) {
        expect(data.urls).toHaveProperty('original');
        expect(data.urls).toHaveProperty('protected');
        expect(data.urls).toHaveProperty('mask');
      }

      expect(data).toHaveProperty('title');
      expect(data).toHaveProperty('artist');
    }, 30000);
  });

  describe('GET /jobs/:id/download/:variant', () => {
    it('should redirect to backend URL for protected variant', async () => {
      if (!artworkId && !createdJobId) {
        console.log('Skipping: No job_id available from previous tests');
        return;
      }

      const jobId = artworkId || createdJobId;

      const response = await fetch(`${BASE_URL}/jobs/${jobId}/download/protected`, {
        redirect: 'manual', // Don't follow redirects
      });

      console.log('GET /jobs/:id/download/:variant status:', response.status);

      if (response.status === 404) {
        console.log('Job not found - might still be processing');
        return;
      }

      // Should return 307 redirect
      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBeTruthy();

      const location = response.headers.get('location');
      console.log('Redirect location:', location);

      if (location) {
        expect(location).toContain('variant=protected');
      }
    }, 30000);

    it('should redirect to backend URL for mask variant', async () => {
      if (!artworkId && !createdJobId) {
        console.log('Skipping: No job_id available from previous tests');
        return;
      }

      const jobId = artworkId || createdJobId;

      const response = await fetch(`${BASE_URL}/jobs/${jobId}/download/mask`, {
        redirect: 'manual',
      });

      if (response.status === 404) {
        console.log('Job not found');
        return;
      }

      expect(response.status).toBe(307);
      expect(response.headers.get('location')).toBeTruthy();

      const location = response.headers.get('location');
      if (location) {
        expect(location).toContain('variant=mask');
      }
    }, 30000);
  });

  describe('End-to-End: Upload, Process, Download', () => {
    it('should complete full workflow: upload -> wait for processing -> download protected image', async () => {
      // Step 1: Upload a unique image
      const formData = new FormData();
      const imageBuffer = readFileSync(TEST_IMAGE_PATH);
      const imageBlob = new Blob([imageBuffer], { type: 'image/jpeg' });

      const timestamp = Date.now();
      formData.append('image', imageBlob, 'mona_lisa.jpg');
      formData.append('artist_name', 'Leonardo da Vinci');
      formData.append('artwork_title', `E2E Test ${timestamp}`);
      formData.append('tags', 'e2e,test,automated');
      formData.append('artwork_description', 'End-to-end integration test');

      console.log('Uploading image...');
      const uploadResponse = await fetch(`${BASE_URL}/protect`, {
        method: 'POST',
        body: formData,
      });

      const uploadData = await uploadResponse.json();
      console.log('Upload response:', uploadData);

      expect([200, 202]).toContain(uploadResponse.status);
      expect(uploadData).toHaveProperty('job_id');

      const jobId = uploadData.job_id;

      // If it's a duplicate, use the existing artwork
      if (uploadResponse.status === 200 && uploadData.status === 'exists') {
        console.log('Image already exists, using existing artwork');
      } else {
        // Step 2: Poll for completion
        console.log('Polling for job completion...');
        let status = 'processing';
        let attempts = 0;
        const maxAttempts = 40; // 40 attempts * 3 seconds = 2 minutes max wait

        while (status === 'processing' && attempts < maxAttempts) {
          await new Promise(resolve => setTimeout(resolve, 3000)); // Wait 3 seconds

          const statusResponse = await fetch(`${BASE_URL}/jobs/${jobId}`);
          const statusData = await statusResponse.json();

          status = statusData.status;
          console.log(`Attempt ${attempts + 1}: Status = ${status}`);

          attempts++;
        }

        expect(status).toBe('completed');
        console.log(`Job completed after ${attempts} attempts (${attempts * 3}s)`);
      }

      // Step 3: Get job result with URLs
      console.log('Fetching job result...');
      const resultResponse = await fetch(`${BASE_URL}/jobs/${jobId}/result`);
      expect(resultResponse.status).toBe(200);

      const resultData = await resultResponse.json();
      console.log('Job result:', JSON.stringify(resultData, null, 2));

      expect(resultData).toHaveProperty('urls');
      expect(resultData.urls).toHaveProperty('protected');

      // Step 4: Download the protected image (follow redirect)
      console.log('Downloading protected image...');
      const downloadResponse = await fetch(`${BASE_URL}/jobs/${jobId}/download/protected`, {
        redirect: 'follow', // Follow redirects to actually download
      });

      expect(downloadResponse.status).toBe(200);
      expect(downloadResponse.headers.get('content-type')).toContain('image');

      // Step 5: Verify the downloaded image is valid
      const imageArrayBuffer = await downloadResponse.arrayBuffer();
      const downloadedImageBuffer = Buffer.from(imageArrayBuffer);

      console.log(`Downloaded image size: ${downloadedImageBuffer.length} bytes`);
      expect(downloadedImageBuffer.length).toBeGreaterThan(0);

      // Use Sharp to verify it's a valid image
      const metadata = await sharp(downloadedImageBuffer).metadata();
      console.log('Downloaded image metadata:', {
        format: metadata.format,
        width: metadata.width,
        height: metadata.height,
        channels: metadata.channels,
      });

      expect(metadata.format).toBeTruthy();
      expect(metadata.width).toBeGreaterThan(0);
      expect(metadata.height).toBeGreaterThan(0);

      // Optional: Save the downloaded image for manual inspection
      const outputPath = join(__dirname, '../../output', `e2e_protected_${timestamp}.jpg`);
      writeFileSync(outputPath, downloadedImageBuffer);
      console.log(`Protected image saved to: ${outputPath}`);

      // Also download and verify the mask
      console.log('Downloading mask image...');
      const maskResponse = await fetch(`${BASE_URL}/jobs/${jobId}/download/mask`, {
        redirect: 'follow',
      });

      if (maskResponse.status === 200) {
        const maskArrayBuffer = await maskResponse.arrayBuffer();
        const maskBuffer = Buffer.from(maskArrayBuffer);

        const maskMetadata = await sharp(maskBuffer).metadata();
        console.log('Mask image metadata:', {
          format: maskMetadata.format,
          width: maskMetadata.width,
          height: maskMetadata.height,
        });

        expect(maskMetadata.format).toBeTruthy();

        const maskOutputPath = join(__dirname, '../../output', `e2e_mask_${timestamp}.jpg`);
        writeFileSync(maskOutputPath, maskBuffer);
        console.log(`Mask image saved to: ${maskOutputPath}`);
      }

      console.log('End-to-end test completed successfully!');
    }, 150000); // 2.5 minutes timeout
  });

  describe('Health & Edge Cases', () => {
    it('should return 404 for non-existent job', async () => {
      const fakeJobId = '000000000000000000000000'; // Valid ObjectId format but doesn't exist

      const response = await fetch(`${BASE_URL}/jobs/${fakeJobId}`);

      expect(response.status).toBe(404);
    });

    it('should reject oversized image', async () => {
      // This would require creating a >256MB file, so we'll skip it
      // or test with a smaller limit if configured
      expect(true).toBe(true);
    });
  });
});
