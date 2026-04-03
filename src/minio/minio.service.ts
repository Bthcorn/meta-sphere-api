import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  /** Internal client — used for all bucket/object operations. */
  private readonly client: Client;
  /**
   * Public client — used only for presigned URL generation.
   *
   * AWS Signature v4 signs the `host` header, so the client that generates
   * the presigned URL must be configured with the host the browser will call.
   * When the API runs inside Docker, `client` uses `minio:9000` (internal), but
   * presigned URLs must carry `localhost:9000` (public) as the host, otherwise
   * MinIO rejects them with a signature-mismatch 403.
   *
   * If MINIO_PUBLIC_ENDPOINT is not set, this is undefined and `client` is
   * used as a fallback (covers the case where the API runs outside Docker and
   * MINIO_ENDPOINT is already the public hostname).
   */
  private readonly publicClient: Client | undefined;
  readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.getOrThrow<string>('MINIO_BUCKET');

    const accessKey = this.config.getOrThrow<string>('MINIO_ACCESS_KEY');
    const secretKey = this.config.getOrThrow<string>('MINIO_SECRET_KEY');

    this.client = new Client({
      endPoint: this.config.getOrThrow<string>('MINIO_ENDPOINT'),
      port: parseInt(this.config.getOrThrow<string>('MINIO_PORT'), 10),
      useSSL: this.config.get<string>('MINIO_USE_SSL') === 'true',
      accessKey,
      secretKey,
    });

    const publicEndpoint = this.config.get<string>('MINIO_PUBLIC_ENDPOINT');
    if (publicEndpoint) {
      const pub = new URL(publicEndpoint);
      const defaultPort = pub.protocol === 'https:' ? 443 : 80;
      this.publicClient = new Client({
        endPoint: pub.hostname,
        port: pub.port ? parseInt(pub.port, 10) : defaultPort,
        useSSL: pub.protocol === 'https:',
        accessKey,
        secretKey,
        // Pre-supply the region so the SDK skips its HTTP bucket-region lookup.
        // Without this, presignedGetObject tries to connect to the publicEndpoint
        // host from inside the Docker container (where localhost = the container's
        // own loopback, not the host machine) and gets ECONNREFUSED.
        // MinIO always defaults to us-east-1; override via MINIO_REGION if needed.
        region: this.config.get<string>('MINIO_REGION') ?? 'us-east-1',
      });
    }
  }

  async onModuleInit() {
    try {
      const exists = await this.client.bucketExists(this.bucket);
      if (!exists) {
        await this.client.makeBucket(this.bucket);
        this.logger.log(`Bucket "${this.bucket}" created`);
      } else {
        this.logger.log(`Bucket "${this.bucket}" already exists`);
      }
    } catch (err: any) {
      if (err?.code === 'BucketAlreadyOwnedByYou') {
        this.logger.log(`Bucket "${this.bucket}" already exists`);
        return;
      }
      this.logger.error('MinIO init error', err);
    }
  }

  async putObject(
    objectKey: string,
    buffer: Buffer,
    mimeType: string,
  ): Promise<void> {
    await this.client.putObject(this.bucket, objectKey, buffer, buffer.length, {
      'Content-Type': mimeType,
    });
  }

  async removeObject(objectKey: string): Promise<void> {
    await this.client.removeObject(this.bucket, objectKey);
  }

  /** Returns a presigned GET URL valid for `expirySeconds` (default 15 min).
   *
   * Uses `publicClient` when available so the HMAC signature is computed
   * against the public hostname (e.g. localhost:9000) rather than the
   * internal Docker service name (minio:9000).  Rewriting the URL after
   * signing would invalidate the signature because `host` is a signed header.
   */
  async presignedGetObject(
    objectKey: string,
    expirySeconds = 900,
  ): Promise<string> {
    const client = this.publicClient ?? this.client;
    return client.presignedGetObject(this.bucket, objectKey, expirySeconds);
  }
}
