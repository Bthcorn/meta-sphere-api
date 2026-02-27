import { Module } from '@nestjs/common';
import { FilesService } from './files.service';
import { FilesController } from './files.controller';
import { PrismaModule } from 'src/prisma/prisma.module';
import { MinioModule } from 'src/minio/minio.module';

@Module({
  imports: [PrismaModule, MinioModule],
  controllers: [FilesController],
  providers: [FilesService],
})
export class FilesModule {}
