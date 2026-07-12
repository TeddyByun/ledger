import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectQueue } from '@nestjs/bullmq';
import type { Queue } from 'bullmq';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service.js';
import { StorageService } from './storage/storage.service.js';
import { IMPORT_QUEUE, type ImportJobPayload } from './pipeline/import.queue.js';
import { ImportPipelineService } from './pipeline/import-pipeline.service.js';
import type { CreateImportDto } from './dto/import.dto.js';

@Injectable()
export class IngestionService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly pipeline: ImportPipelineService,
    @InjectQueue(IMPORT_QUEUE) private readonly queue: Queue<ImportJobPayload>,
  ) {}

  /** 업로드 → 원본 저장 → 잡 생성 → 큐 등록. 즉시 잡 반환(202). */
  async enqueue(dto: CreateImportDto, file: Express.Multer.File) {
    const jobId = `imp_${randomUUID()}`;
    const fileKey = `${new Date().getUTCFullYear()}/${jobId}_${file.originalname}`;
    await this.storage.save(fileKey, file.buffer);

    const job = await this.prisma.importJob.create({
      data: {
        id: jobId,
        issuer: dto.issuer,
        fileKey,
        originalName: file.originalname,
        paymentMethodId: dto.paymentMethodId
          ? Number(dto.paymentMethodId)
          : null,
        status: 'queued',
      },
    });

    // 큐가 있으면 비동기, 없으면(개발환경) 즉시 처리 fallback
    try {
      await this.queue.add('process', { jobId }, { removeOnComplete: true });
    } catch {
      void this.pipeline.process(jobId);
    }
    return job;
  }

  async getJob(jobId: string) {
    const job = await this.prisma.importJob.findUnique({ where: { id: jobId } });
    if (!job) throw new NotFoundException(`import job ${jobId} not found`);
    return job;
  }

  /** 검토 대기(미분류) 건 — 은행/카드 스테이징에서 미연결 행 조회. */
  async getPending(jobId: string) {
    const job = await this.getJob(jobId);
    const pmId = job.paymentMethodId ?? -1;
    const [bank, card] = await Promise.all([
      this.prisma.bankTransaction.findMany({
        where: {
          paymentMethodId: pmId,
          transactionId: null,
          excludeReason: null,
        },
        orderBy: { txnAt: 'desc' },
      }),
      this.prisma.cardTransaction.findMany({
        where: { paymentMethodId: pmId, transactionId: null, isCanceled: 'N' },
        orderBy: { txnDate: 'desc' },
      }),
    ]);
    return { bank, card };
  }
}
