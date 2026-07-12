import { Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { IMPORT_QUEUE, type ImportJobPayload } from './import.queue.js';
import { ImportPipelineService } from './import-pipeline.service.js';

/**
 * 적재 큐 워커 — 업로드 잡을 비동기로 처리(파싱·분류·대사·집계).
 * 큐/워커 분리 덕에 업로드 응답은 즉시 반환되고 무거운 작업은 백그라운드에서 수행.
 */
@Processor(IMPORT_QUEUE)
export class ImportProcessor extends WorkerHost {
  private readonly log = new Logger(ImportProcessor.name);

  constructor(private readonly pipeline: ImportPipelineService) {
    super();
  }

  async process(job: Job<ImportJobPayload>): Promise<void> {
    this.log.log(`processing import job ${job.data.jobId}`);
    await this.pipeline.process(job.data.jobId);
  }
}
