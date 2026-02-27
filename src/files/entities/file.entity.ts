import { Transform, Type } from 'class-transformer';
import { FileCategory } from 'src/generated/prisma/client';

export class UploaderEntity {
  id: string;
  username: string;
  firstName: string;
  lastName: string;
}

export class FileEntity {
  id: string;
  name: string;
  description: string | null;
  storageKey: string;
  mimeType: string;

  /** Prisma returns BigInt — transform to Number for JSON serialisation. */
  @Transform(({ value }: { value: bigint | number }) => Number(value))
  size: number;

  category: FileCategory;
  tags: string[];
  subject: string | null;
  yearLevel: number | null;
  isPublic: boolean;
  downloadCount: number;
  roomId: string | null;
  uploadedById: string;
  createdAt: Date;
  updatedAt: Date;

  @Type(() => UploaderEntity)
  uploadedBy: UploaderEntity;
}
