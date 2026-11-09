import { DeleteObjectCommand, GetObjectCommand, HeadBucketCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

/*
 * pnpm storage:check [origin]
 *
 * Checks the S3/R2 settings in .env without starting the app: the keys and bucket (write, read and
 * delete a small test file) and the bucket's CORS rule for browser uploads from the web app's origin
 * (default WEB_URL, http://localhost:3000).
 */

/** Same as S3_COMPAT in src/media/storage.ts: R2 rejects the SDK's default automatic checksums. */
const S3_COMPAT = { requestChecksumCalculation: 'WHEN_REQUIRED', responseChecksumValidation: 'WHEN_REQUIRED' } as const;

const e = process.env;
const origin = (process.argv[2] ?? e.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
let failed = false;

function ok(msg: string) {
  console.log(`  ✓ ${msg}`);
}
function fail(msg: string, hint?: string) {
  failed = true;
  console.log(`  ✗ ${msg}`);
  if (hint) console.log(`    → ${hint}`);
}
function errorName(err: unknown): string {
  const x = err as { name?: string; Code?: string; $metadata?: { httpStatusCode?: number } };
  return `${x.name ?? x.Code ?? 'Error'}${x.$metadata?.httpStatusCode ? ` (HTTP ${x.$metadata.httpStatusCode})` : ''}`;
}

async function main() {
  console.log('Storage check\n');
  if (e.STORAGE_DRIVER !== 's3') fail(`STORAGE_DRIVER is "${e.STORAGE_DRIVER ?? 'local'}"`, 'Set STORAGE_DRIVER=s3 in apps/api/.env to use R2.');
  const missing = ['S3_ENDPOINT', 'S3_BUCKET', 'S3_ACCESS_KEY_ID', 'S3_SECRET_ACCESS_KEY'].filter((k) => !e[k]);
  if (missing.length) {
    fail(`Missing in .env: ${missing.join(', ')}`);
    return;
  }
  ok(`Settings present (bucket ${e.S3_BUCKET}, endpoint ${new URL(e.S3_ENDPOINT!).host})`);

  const bucket = e.S3_BUCKET!;
  const client = new S3Client({
    region: e.S3_REGION || 'auto',
    endpoint: e.S3_ENDPOINT,
    forcePathStyle: true,
    credentials: { accessKeyId: e.S3_ACCESS_KEY_ID!, secretAccessKey: e.S3_SECRET_ACCESS_KEY! },
    ...S3_COMPAT,
  });

  try {
    await client.send(new HeadBucketCommand({ Bucket: bucket }));
    ok('Keys accepted and bucket found');
  } catch (err) {
    const name = errorName(err);
    if (name.includes('404') || name.includes('NotFound')) {
      fail(`Bucket "${bucket}" not found: ${name}`, 'Check the bucket name, and use the jurisdiction endpoint (e.g. .eu.) if the bucket was created with a jurisdiction.');
    } else if (name.includes('403') || name.includes('401')) {
      fail(`Access denied: ${name}`, 'Check the access key and secret, and that the API token has Object Read & Write on this bucket.');
    } else {
      fail(`Could not reach the bucket: ${name}`, 'Check S3_ENDPOINT and your internet connection.');
    }
    return;
  }

  const key = `healthchecks/storage-check-${Date.now()}.txt`;
  const body = `Charter Mission storage check ${new Date().toISOString()}`;
  try {
    await client.send(new PutObjectCommand({ Bucket: bucket, Key: key, Body: body, ContentType: 'text/plain' }));
    const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    const text = await got.Body?.transformToString();
    if (text !== body) throw new Error('Read back different content');
    ok('Wrote and read back a test file');
  } catch (err) {
    fail(`Write/read failed: ${errorName(err)}`, 'The API token needs Object Read & Write (not read-only).');
  }

  try {
    const url = await getSignedUrl(client, new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: 'text/plain' }), { expiresIn: 300 });
    const res = await fetch(url, {
      method: 'OPTIONS',
      headers: { Origin: origin, 'Access-Control-Request-Method': 'PUT', 'Access-Control-Request-Headers': 'content-type' },
    });
    const allowOrigin = res.headers.get('access-control-allow-origin');
    const allowMethods = (res.headers.get('access-control-allow-methods') ?? '').toUpperCase();
    if (res.ok && (allowOrigin === origin || allowOrigin === '*') && (!allowMethods || allowMethods.includes('PUT'))) {
      ok(`CORS allows browser uploads from ${origin}`);
    } else {
      fail(
        `CORS does not allow uploads from ${origin} (HTTP ${res.status}${allowOrigin ? `, allowed origin ${allowOrigin}` : ''})`,
        `In the bucket's Settings → CORS policy, add "${origin}" to AllowedOrigins, "PUT" to AllowedMethods and "Content-Type" to AllowedHeaders.`,
      );
    }
  } catch (err) {
    fail(`CORS check failed: ${String(err)}`);
  }

  // A real browser-style upload: PUT the bytes to a presigned URL, exactly as the web app does.
  const uploadKey = `healthchecks/storage-check-upload-${Date.now()}.bin`;
  try {
    const bytes = Buffer.alloc(256 * 1024, 7);
    const url = await getSignedUrl(
      client,
      new PutObjectCommand({ Bucket: bucket, Key: uploadKey, ContentType: 'video/mp4', ContentLength: bytes.length }),
      { expiresIn: 300 },
    );
    const res = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'video/mp4', Origin: origin }, body: bytes });
    if (!res.ok) {
      const text = await res.text();
      const code = /<Code>([^<]+)<\/Code>/.exec(text)?.[1] ?? `HTTP ${res.status}`;
      fail(`Upload to a signed URL was refused: ${code}`, 'Run this check again after pulling the latest code; if it still fails, send the code above to the developer.');
    } else {
      const got = await client.send(new GetObjectCommand({ Bucket: bucket, Key: uploadKey }));
      const size = (await got.Body?.transformToByteArray())?.length ?? 0;
      if (size !== bytes.length) fail(`Signed upload stored ${size} bytes instead of ${bytes.length}`);
      else ok('Uploaded a file through a signed URL, as the browser does');
    }
  } catch (err) {
    fail(`Signed upload failed: ${String(err)}`);
  }

  // The video worker streams converted videos back to the bucket.
  const streamKey = `healthchecks/storage-check-stream-${Date.now()}.bin`;
  try {
    const { Readable } = await import('node:stream');
    const chunk = Buffer.alloc(1024 * 1024, 3);
    await client.send(
      new PutObjectCommand({ Bucket: bucket, Key: streamKey, Body: Readable.from([chunk, chunk]), ContentType: 'video/mp4', ContentLength: chunk.length * 2 }),
    );
    ok('Streamed a 2 MB file to the bucket, as the video worker does');
  } catch (err) {
    fail(`Streaming upload failed: ${errorName(err)}`);
  }

  for (const extra of [uploadKey, streamKey]) {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: extra })).catch(() => undefined);
  }

  try {
    await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
    ok('Removed the test file');
  } catch (err) {
    fail(`Could not delete the test file ${key}: ${errorName(err)}`);
  }
}

main()
  .catch((err: unknown) => fail(`Unexpected error: ${String(err)}`))
  .finally(() => {
    console.log(failed ? '\nStorage is not ready yet. Fix the items marked ✗ and run the check again.' : '\nAll good: uploads will go to R2.');
    process.exitCode = failed ? 1 : 0;
  });
