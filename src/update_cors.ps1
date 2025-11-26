$file = "app.ts"
$content = Get-Content $file -Raw

# Find and replace the CORS origin handler
$old = @"
      ? (origin, callback) => {
          if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
          } else {
            callback(new Error('Not allowed by CORS'), false);
          }
        }
"@

$new = @"
      ? (origin, callback) => {
          // Allow all origins if wildcard is set (for testing only!)
          if (allowedOrigins.includes('*')) {
            callback(null, true);
          } else if (!origin || allowedOrigins.includes(origin)) {
            callback(null, true);
          } else {
            callback(new Error('Not allowed by CORS'), false);
          }
        }
"@

$content = $content.Replace($old, $new)
Set-Content $file -Value $content -NoNewline
Write-Host "CORS handler updated successfully"
