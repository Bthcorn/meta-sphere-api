import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Client } from 'minio';

@Injectable()
export class MinioService implements OnModuleInit {
  private readonly logger = new Logger(MinioService.name);
  private readonly client: Client;
  readonly bucket: string;

  constructor(private readonly config: ConfigService) {
    this.bucket = this.config.getOrThrow<string>('MINIO_BUCKET');

    this.client = new Client({
      endPoint: this.config.getOrThrow<string>('MINIO_ENDPOINT'),
      port: parseInt(this.config.getOrThrow<string>('MINIO_PORT'), 10),
      useSSL: this.config.get<string>('MINIO_USE_SSL') === 'true',
      accessKey: this.config.getOrThrow<string>('MINIO_ACCESS_KEY'),
      secretKey: this.config.getOrThrow<string>('MINIO_SECRET_KEY'),
    });
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
    } catch (err) {
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

  /** Returns a presigned GET URL valid for `expirySeconds` (default 15 min). */
  async presignedGetObject(
    objectKey: string,
    expirySeconds = 900,
  ): Promise<string> {
    return this.client.presignedGetObject(
      this.bucket,
      objectKey,
      expirySeconds,
    );
  }
}
