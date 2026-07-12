import {
  Controller,
  Get,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Redis } from 'ioredis';
import { ApiTags } from '@nestjs/swagger';
import { PrismaService } from './prisma/prisma.service.js';

/**
 * 헬스체크 — INFRA_OPS_DESIGN §4.3.
 * /health/live  : 프로세스 생존 (즉시 200)
 * /health/ready : 트래픽 수용 가능 (DB + Redis 확인)
 */
@ApiTags('health')
@Controller('health')
export class HealthController {
  private readonly redis: Redis;

  constructor(
    private readonly prisma: PrismaService,
    config: ConfigService,
  ) {
    this.redis = new Redis(config.get<string>('REDIS_URL')!, {
      lazyConnect: true,
      maxRetriesPerRequest: 1,
      enableOfflineQueue: false,
    });
  }

  @Get()
  root() {
    return { status: 'ok', timestamp: new Date().toISOString() };
  }

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    const checks: Record<string, 'up' | 'down'> = { db: 'down', redis: 'down' };
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      checks.db = 'up';
    } catch {
      /* down */
    }
    try {
      if (this.redis.status !== 'ready') await this.redis.connect();
      await this.redis.ping();
      checks.redis = 'up';
    } catch {
      /* down */
    }

    const ok = checks.db === 'up' && checks.redis === 'up';
    if (!ok) {
      throw new ServiceUnavailableException({ status: 'unready', checks });
    }
    return { status: 'ready', checks };
  }
}
