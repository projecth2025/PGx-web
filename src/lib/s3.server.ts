/**
 * AWS S3 server-side operations using AWS SDK v3.
 * SECURITY: Never import this from client code.
 * All operations use proper AWS Signature Version 4 signing.
 */

import { S3Client, PutObjectCommand, HeadObjectCommand, GetObjectCommand, ListObjectsV2Command } from "@aws-sdk/client-s3";
import { getSignedUrl as awsGetSignedUrl } from "@aws-sdk/s3-request-presigner";

interface S3Config {
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
}

function getS3Config(): S3Config {
  const region = process.env.AWS_REGION;
  const accessKeyId = process.env.AWS_ACCESS_KEY_ID;
  const secretAccessKey = process.env.AWS_SECRET_ACCESS_KEY;
  const bucket = process.env.AWS_S3_BUCKET;

  if (!region || !accessKeyId || !secretAccessKey || !bucket) {
    const missing = [
      ...(!region ? ["AWS_REGION"] : []),
      ...(!accessKeyId ? ["AWS_ACCESS_KEY_ID"] : []),
      ...(!secretAccessKey ? ["AWS_SECRET_ACCESS_KEY"] : []),
      ...(!bucket ? ["AWS_S3_BUCKET"] : []),
    ];
    throw new Error(
      `Missing AWS S3 environment variables: ${missing.join(", ")}. Configure these in your .env.local or hosting environment.`
    );
  }

  return { region, accessKeyId, secretAccessKey, bucket };
}

let s3ClientInstance: S3Client | null = null;

function getS3Client(): S3Client {
  if (!s3ClientInstance) {
    const config = getS3Config();
    s3ClientInstance = new S3Client({
      region: config.region,
      credentials: {
        accessKeyId: config.accessKeyId,
        secretAccessKey: config.secretAccessKey,
      },
    });
  }
  return s3ClientInstance;
}

/**
 * Generate a presigned URL for S3 object access using AWS SDK v3.
 * Uses AWS Signature Version 4 for secure, time-limited access.
 */
export async function getSignedUrl(
  objectPath: string,
  mode: "read" | "write"
): Promise<{ url: string; expires_in: number; method?: string }> {
  const config = getS3Config();
  const client = getS3Client();
  const expiresIn = 3600; // 1 hour

  try {
    if (mode === "read") {
      const command = new GetObjectCommand({
        Bucket: config.bucket,
        Key: objectPath,
      });
      const url = await awsGetSignedUrl(client, command, { expiresIn });
      return { url, expires_in: expiresIn, method: "GET" };
    } else {
      const command = new PutObjectCommand({
        Bucket: config.bucket,
        Key: objectPath,
      });
      const url = await awsGetSignedUrl(client, command, { expiresIn });
      return { url, expires_in: expiresIn, method: "PUT" };
    }
  } catch (error) {
    throw new Error(
      `Failed to generate signed URL: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Upload a file to S3 using AWS SDK v3.
 * @param objectPath - The S3 object path (e.g., "uploads/user123/batch-id/file.zip")
 * @param body - The file content as ArrayBuffer or Uint8Array
 */
export async function uploadToS3(
  objectPath: string,
  body: ArrayBuffer | Uint8Array
): Promise<void> {
  const config = getS3Config();
  const client = getS3Client();

  try {
    const command = new PutObjectCommand({
      Bucket: config.bucket,
      Key: objectPath,
      Body: body instanceof Uint8Array ? body : new Uint8Array(body),
      ContentType: "application/octet-stream",
    });

    await client.send(command);
  } catch (error) {
    throw new Error(
      `S3 upload error: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * List all S3 objects under a given prefix using AWS SDK v3.
 * Handles pagination automatically via ContinuationToken.
 * @param prefix - The S3 key prefix to list (e.g., "users/userId/batchId/")
 * @returns Array of { key, size } objects
 */
export async function listObjects(prefix: string): Promise<Array<{ key: string; size: number }>> {
  const config = getS3Config();
  const client = getS3Client();
  const results: Array<{ key: string; size: number }> = [];
  let continuationToken: string | undefined;

  try {
    do {
      const command = new ListObjectsV2Command({
        Bucket: config.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      });

      const response = await client.send(command);

      if (response.Contents) {
        for (const obj of response.Contents) {
          if (obj.Key) {
            results.push({ key: obj.Key, size: obj.Size ?? 0 });
          }
        }
      }

      continuationToken = response.IsTruncated ? response.NextContinuationToken : undefined;
    } while (continuationToken);

    return results;
  } catch (error) {
    throw new Error(
      `Failed to list S3 objects: ${error instanceof Error ? error.message : "Unknown error"}`
    );
  }
}

/**
 * Check if an S3 object exists and get its size using AWS SDK v3.
 * @param objectKey - The S3 object key
 * @returns The Content-Length value or null if not found
 */
export async function headObjectSize(objectKey: string): Promise<number | null> {
  const config = getS3Config();
  const client = getS3Client();

  try {
    const command = new HeadObjectCommand({
      Bucket: config.bucket,
      Key: objectKey,
    });

    const response = await client.send(command);
    return response.ContentLength ?? null;
  } catch (error: any) {
    // 404 or NoSuchKey means object doesn't exist
    if (error?.name === "NotFound" || error?.$metadata?.httpStatusCode === 404) {
      return null;
    }
    // For other errors, return null to indicate check failed
    return null;
  }
}

/**
 * Check if an S3 object exists.
 * @param objectKey - The S3 object key
 * @returns true if object exists, false otherwise
 */
export async function objectExists(objectKey: string): Promise<boolean> {
  const size = await headObjectSize(objectKey);
  return size !== null;
}
