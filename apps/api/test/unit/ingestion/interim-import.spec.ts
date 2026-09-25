import { ImportPipelineService } from '../../../src/ingestion/pipeline/import-pipeline.service.js';
import { ParserRegistry } from '../../../src/ingestion/parsers/parser.registry.js';
import { interimCardStatements, interimWorkbook } from '../../fixtures/interim-card-statements.js';

interface StoredCard {
  id: number;
  dedupHash: string;
  usageAmount: number;
  principal: number;
  fee: number;
  txnDate: Date;
}

describe('중간이용내역 업로드 → 거래 저장', () => {
  it.each(interimCardStatements)('$issuer의 거래 금액·이용일을 저장하고 재업로드 중복을 막는다', async (fixture) => {
    const savedCards: StoredCard[] = [];
    const savedExpenses: Array<{ id: number; amount: number; transactionDate: Date }> = [];
    const jobUpdates: Array<Record<string, unknown>> = [];
    let createdPaymentMethods = 0;
    const job = {
      id: 'test-import', householdId: 1, issuer: fixture.issuer,
      fileKey: 'test.xlsx', originalName: '중간이용내역.xlsx', statementYm: null,
      paymentMethodId: null,
    };
    const prisma = {
      $transaction: async <T>(fn: (db: unknown) => Promise<T>): Promise<T> => fn(prisma),
      $executeRaw: async () => 1,
      importJob: {
        findUnique: async () => job,
        update: async ({ data }: { data: Record<string, unknown> }) => {
          jobUpdates.push(data);
          return job;
        },
      },
      paymentMethod: {
        // 기존 카드번호가 3자리여도 승인내역의 뒤4자리와 매칭한다.
        findMany: async () => [
          { id: 1, cardNo: '252' }, { id: 2, cardNo: '4480' },
          { id: 3, cardNo: '9540' }, { id: 4, cardNo: '160' }, { id: 5, cardNo: '253' },
        ],
        findFirst: async () => ({ id: 6 }),
        create: async () => { createdPaymentMethods++; return { id: 7 }; },
      },
      cardStatement: { upsert: async () => ({ id: 1 }) },
      installmentPlan: { upsert: async () => ({ id: 1 }) },
      cardTransaction: {
        findMany: async () => [],
        findFirst: async ({ where }: { where: { dedupHash: string } }) =>
          savedCards.find((r) => r.dedupHash === where.dedupHash) ?? null,
        create: async ({ data }: { data: Omit<StoredCard, 'id'> }) => {
          const row = { id: savedCards.length + 1, ...data };
          savedCards.push(row);
          return row;
        },
        update: async () => ({}),
      },
      transaction: {
        create: async ({ data }: { data: { amount: number; transactionDate: Date } }) => {
          const row = { id: savedExpenses.length + 1, ...data };
          savedExpenses.push(row);
          return row;
        },
      },
    };
    const pipeline = new ImportPipelineService(
      prisma as never,
      { load: async () => interimWorkbook(fixture.rows) } as never,
      new ParserRegistry(),
      { classify: async () => '04' } as never,
      {} as never,
      {} as never,
      { autoClassifyBank: async () => {}, autoClassifyCard: async () => {} } as never,
    );

    await pipeline.process(job.id);

    expect(jobUpdates.at(-1)).toEqual({
      status: 'completed', parsedRows: fixture.amounts.length,
      classifiedRows: fixture.amounts.length, pendingRows: 0,
    });
    expect(savedCards.map((r) => r.usageAmount)).toEqual(fixture.usageAmounts);
    expect(savedExpenses.map((r) => r.amount)).toEqual(fixture.amounts);
    expect(savedCards.map((r) => r.txnDate.toISOString().slice(0, 10))).toEqual(fixture.storedDates);
    expect(savedExpenses.map((r) => r.transactionDate.toISOString().slice(0, 10))).toEqual(fixture.storedDates);
    expect(createdPaymentMethods).toBe(0);

    await pipeline.process(job.id);

    expect(savedCards).toHaveLength(fixture.amounts.length);
    expect(savedExpenses).toHaveLength(fixture.amounts.length);
  });
});
