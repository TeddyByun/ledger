import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@prisma/client';
import { getTenant } from '../common/tenant/tenant-context.js';

/**
 * 가구(household) 스코프가 적용되는 도메인 모델.
 * 전역 코드성(Category/BankTxnType/MerchantCategoryMap)·계정(User/Household/…)은 제외.
 * (monthly_* 집계는 Phase 4 에서 스코프 예정)
 */
const SCOPED_MODELS = new Set<string>([
  'PaymentMethod',
  'Counterparty',
  'Transaction',
  'BankTransaction',
  'CardStatement',
  'CardTransaction',
  'ImportJob',
]);

/** where 를 갖는(또는 주입 대상) 액션. */
const WHERE_ACTIONS = new Set<Prisma.PrismaAction>([
  'findUnique',
  'findUniqueOrThrow',
  'findFirst',
  'findFirstOrThrow',
  'findMany',
  'count',
  'aggregate',
  'groupBy',
  'update',
  'updateMany',
  'delete',
  'deleteMany',
]);

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  async onModuleInit() {
    this.applyTenantScope();
    await this.$connect();
  }

  async onModuleDestroy() {
    await this.$disconnect();
  }

  /**
   * 멀티테넌시 자동 스코핑 (AUTH_DESIGN §4.1).
   * 요청 스코프 테넌트가 있으면, 스코프 대상 모델의 모든 쿼리에 householdId 를
   * 자동 주입한다 — 읽기/수정/삭제는 where 필터로, 생성은 data 로.
   * (Prisma 5 extendedWhereUnique GA 덕분에 findUnique/update/delete where 에도 주입 가능)
   */
  private applyTenantScope() {
    this.$use(async (params, next) => {
      const tenant = getTenant();
      if (!tenant || !params.model || !SCOPED_MODELS.has(params.model)) {
        return next(params);
      }
      const hid = tenant.householdId;
      const action = params.action;
      params.args ??= {};

      if (action === 'create') {
        params.args.data = { householdId: hid, ...params.args.data };
      } else if (action === 'createMany') {
        const data = params.args.data;
        params.args.data = Array.isArray(data)
          ? data.map((d: Record<string, unknown>) => ({
              householdId: hid,
              ...d,
            }))
          : { householdId: hid, ...data };
      } else if (action === 'upsert') {
        params.args.where = { ...params.args.where, householdId: hid };
        params.args.create = { householdId: hid, ...params.args.create };
      } else if (WHERE_ACTIONS.has(action)) {
        params.args.where = { ...(params.args.where ?? {}), householdId: hid };
      }

      return next(params);
    });
  }
}
