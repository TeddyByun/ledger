import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  UploadedFile,
  UseInterceptors,
  BadRequestException,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiConsumes,
  ApiOperation,
  ApiTags,
  ApiBody,
} from '@nestjs/swagger';
import { IngestionService } from './ingestion.service.js';
import { CreateImportDto } from './dto/import.dto.js';

@ApiTags('imports')
@Controller('imports')
export class IngestionController {
  constructor(private readonly ingestion: IngestionService) {}

  @Post()
  @ApiOperation({ summary: '명세서 업로드 → 비동기 적재 잡 생성' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      properties: {
        issuer: { type: 'string' },
        paymentMethodId: { type: 'number' },
        file: { type: 'string', format: 'binary' },
      },
      required: ['issuer', 'file'],
    },
  })
  @UseInterceptors(FileInterceptor('file'))
  upload(
    @Body() dto: CreateImportDto,
    @UploadedFile() file?: Express.Multer.File,
  ) {
    if (!file) throw new BadRequestException('file is required');
    return this.ingestion.enqueue(dto, file);
  }

  @Get()
  @ApiOperation({ summary: '업로드 기록 목록 (최근 순)' })
  list() {
    return this.ingestion.listJobs();
  }

  @Get(':jobId')
  @ApiOperation({ summary: '적재 잡 진행 상태 조회 (폴링)' })
  status(@Param('jobId') jobId: string) {
    return this.ingestion.getJob(jobId);
  }

  @Get(':jobId/pending')
  @ApiOperation({ summary: '검토 대기(미분류) 건 조회' })
  pending(@Param('jobId') jobId: string) {
    return this.ingestion.getPending(jobId);
  }
}
