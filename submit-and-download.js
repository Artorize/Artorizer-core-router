const { readFileSync, writeFileSync, mkdirSync } = require('fs');
const { join } = require('path');
const FormData = require('form-data');
const { request } = require('undici');

const ROUTER_URL = process.env.ROUTER_URL || 'https://router.artorizer.com';
const TEST_IMAGE_PATH = join(__dirname, 'input/mona_lisa.jpg');
const OUTPUT_DIR = join(__dirname, 'outputs');

// Ensure outputs directory exists
try {
  mkdirSync(OUTPUT_DIR, { recursive: true });
} catch (err) {
  // Directory already exists
}

async function submitImage() {
  console.log('📤 Submitting Mona Lisa to router...');

  const formData = new FormData();
  const imageBuffer = readFileSync(TEST_IMAGE_PATH);

  // form-data package handles Buffers natively
  formData.append('image', imageBuffer, {
    filename: 'mona_lisa.jpg',
    contentType: 'image/jpeg',
  });
  formData.append('artist_name', 'Leonardo da Vinci');
  formData.append('artwork_title', 'Mona Lisa Integration Test');
  formData.append('tags', 'renaissance,portrait,famous,test');
  formData.append('artwork_description', 'Integration test submission of the Mona Lisa');

  // Use undici's request method which works properly with form-data
  const response = await request(`${ROUTER_URL}/protect`, {
    method: 'POST',
    body: formData,
    headers: formData.getHeaders(),
  });

  const data = await response.body.json();
  console.log('✅ Response:', data);

  if (response.statusCode === 200 && data.status === 'exists') {
    console.log('ℹ️  Image already exists (duplicate detected)');
    return data.artwork._id;
  } else if (response.statusCode === 202 || response.statusCode === 200) {
    return data.job_id;
  } else {
    throw new Error(`Submission failed: ${JSON.stringify(data)}`);
  }
}

async function pollForCompletion(jobId) {
  console.log(`⏳ Polling for job ${jobId} completion...`);

  const maxAttempts = 60; // 5 minutes max
  const pollInterval = 5000; // 5 seconds

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    console.log(`   Attempt ${attempt}/${maxAttempts}...`);

    const response = await request(`${ROUTER_URL}/jobs/${jobId}`);
    const data = await response.body.json();

    if (response.statusCode === 200 && data.status === 'completed') {
      console.log('✅ Job completed!');
      return data;
    } else if (data.status === 'failed') {
      throw new Error(`Job failed: ${JSON.stringify(data)}`);
    }

    // Wait before next poll
    await new Promise(resolve => setTimeout(resolve, pollInterval));
  }

  throw new Error('Timeout waiting for job completion');
}

async function getJobResult(jobId) {
  console.log(`📋 Fetching job result for ${jobId}...`);

  const response = await request(`${ROUTER_URL}/jobs/${jobId}/result`);

  if (response.statusCode !== 200) {
    const data = await response.body.json();
    throw new Error(`Failed to get result: ${JSON.stringify(data)}`);
  }

  const data = await response.body.json();
  console.log('✅ Job result retrieved');
  console.log('   Artwork ID:', data._id);
  console.log('   Title:', data.title);
  console.log('   Artist:', data.artist);

  return data;
}

async function downloadFile(url, filename) {
  console.log(`📥 Downloading ${filename}...`);
  console.log(`   URL: ${url}`);

  const response = await request(url);

  // Handle redirects manually if needed
  if (response.statusCode === 307 || response.statusCode === 302 || response.statusCode === 301) {
    const redirectUrl = response.headers.location;
    console.log(`   Following redirect to: ${redirectUrl}`);
    const redirectResponse = await request(redirectUrl);

    if (redirectResponse.statusCode !== 200) {
      let errorBody = '';
      try {
        errorBody = await redirectResponse.body.text();
        console.error(`   Error body: ${errorBody}`);
      } catch (e) {
        // Ignore if body can't be read
      }
      throw new Error(`Failed to download ${filename} from redirect: ${redirectResponse.statusCode} - ${errorBody}`);
    }

    const buffer = Buffer.from(await redirectResponse.body.arrayBuffer());
    const outputPath = join(OUTPUT_DIR, filename);
    writeFileSync(outputPath, buffer);
    console.log(`✅ Saved to ${outputPath}`);
    return outputPath;
  }

  if (response.statusCode !== 200) {
    // Try to get error body for debugging
    let errorBody = '';
    try {
      errorBody = await response.body.text();
      console.error(`   Error body: ${errorBody}`);
    } catch (e) {
      // Ignore if body can't be read
    }
    throw new Error(`Failed to download ${filename}: ${response.statusCode} - ${errorBody}`);
  }

  const buffer = Buffer.from(await response.body.arrayBuffer());
  const outputPath = join(OUTPUT_DIR, filename);
  writeFileSync(outputPath, buffer);

  console.log(`✅ Saved to ${outputPath}`);
  return outputPath;
}

async function main() {
  try {
    console.log('🚀 Starting submission process...\n');

    // Step 1: Submit image
    const jobId = await submitImage();
    console.log(`\n📝 Job ID: ${jobId}\n`);

    // Step 2: Poll for completion
    await pollForCompletion(jobId);
    console.log('');

    // Step 3: Get job result
    const result = await getJobResult(jobId);
    console.log('');

    // Step 4: Download protected image
    if (result.urls && result.urls.protected) {
      await downloadFile(result.urls.protected, 'mona_lisa_protected.jpg');
    } else {
      console.log('⚠️  No protected image URL available');
    }

    // Step 5: Download mask SAC file (single grayscale mask)
    if (result.urls && result.urls.mask) {
      await downloadFile(result.urls.mask, 'mona_lisa_mask.sac');
    } else {
      console.log('⚠️  No mask SAC file URL available');
      console.log('   Available URLs:', Object.keys(result.urls || {}));
    }

    // Also download original if available
    if (result.urls && result.urls.original) {
      await downloadFile(result.urls.original, 'mona_lisa_original.jpg');
    }

    console.log('\n✨ All done! Check the outputs folder for results.');

  } catch (error) {
    console.error('\n❌ Error:', error.message);
    process.exit(1);
  }
}

main();
