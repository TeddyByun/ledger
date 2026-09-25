import { ImportPipelineService } from '../../../src/ingestion/pipeline/import-pipeline.service.js';
import { ParserRegistry } from '../../../src/ingestion/parsers/parser.registry.js';
import type { NormalizedBankRow, NormalizedCardRow, ParseResult } from '../../../src/ingestion/parsers/types.js';

const card: NormalizedCardRow = {
  txnDate: new Date('2026-08-13T10:12:00Z'), merchantName: '테스트식당',
  usageAmount: 12000, principal: 12000, fee: 0, cardLabel: '본인253', cardNo: '253',
  installmentPeriod: null, billingRound: null, benefitType: null, benefitAmount: 0,
  region: null, saleType: null, isCanceled: false, point: 0, dedupHash: 'parser-key',
};
const bank: NormalizedBankRow = {
  txnAt: new Date('2026-09-01T10:12:00Z'), txnTypeRaw: '이체', description: '테스트식당',
  withdrawal: 12000, deposit: 0, balance: 100000, branch: null, dedupHash: 'parser-key',
};
const cards = (rows: NormalizedCardRow[]): ParseResult => ({ kind: 'card', statement: {
  statementYm: '2026-09', billingDate: null, totalAmount: rows.reduce((n, r) => n + r.principal + r.fee, 0), totalCount: rows.length, rows,
} });
const banks = (rows: NormalizedBankRow[]): ParseResult => ({ kind: 'bank', account: { accountNo: '123', identifier: '123' }, rows });

type StoredCard = Omit<NormalizedCardRow, 'isCanceled'> & {
  id: number; householdId: number; paymentMethodId: number; isCanceled: string; transactionId?: number;
};
type StoredBank = NormalizedBankRow & {
  id: number; householdId: number; paymentMethodId: number; transactionId?: number;
};

function harness(result: ParseResult) {
  const input = { result, file: Buffer.from('test'), actualParser: false };
  const savedCards: StoredCard[] = [];
  const savedBanks: StoredBank[] = [];
  const ledger: Array<{ id: number; amount: number }> = [];
  const updates: Array<Record<string, unknown>> = [];
  const job = { id: 'job', householdId: 1, issuer: 'shinhan_card', fileKey: 'test.csv', originalName: 'test.csv', statementYm: '2026-09', paymentMethodId: 1 };
  const prisma = {
    $transaction: async <T>(fn: (db: unknown) => Promise<T>): Promise<T> => fn(prisma),
    $executeRaw: async () => 1,
    importJob: {
      findUnique: async () => job,
      update: async ({ data }: { data: Record<string, unknown> }) => { updates.push(data); return job; },
    },
    cardStatement: { upsert: async () => ({ id: 1 }) },
    installmentPlan: { upsert: async () => ({ id: 1 }) },
    cardTransaction: {
      findFirst: async ({ where }: { where: { dedupHash: string } }) => savedCards.find((r) => r.dedupHash === where.dedupHash) ?? null,
      findMany: async ({ where }: { where: { householdId: number; paymentMethodId: number; txnDate: Date } }) => savedCards.filter((r) => r.householdId === where.householdId && r.paymentMethodId === where.paymentMethodId && r.txnDate.getTime() === where.txnDate.getTime()),
      create: async ({ data }: { data: Omit<StoredCard, 'id'> }) => {
        const r = { ...data, id: savedCards.length + 1 }; savedCards.push(r); return r;
      },
      update: async ({ where, data }: { where: { id: number }; data: Partial<StoredCard> }) => Object.assign(savedCards.find((r) => r.id === where.id)!, data),
    },
    bankTxnType: { findMany: async () => [] },
    bankTransaction: {
      findFirst: async ({ where }: { where: { dedupHash: string } }) => savedBanks.find((r) => r.dedupHash === where.dedupHash) ?? null,
      findMany: async ({ where }: { where: { paymentMethodId: number; txnAt?: { gte: Date; lt: Date }; withdrawal?: number; deposit?: number } }) => savedBanks.filter((r) => r.paymentMethodId === where.paymentMethodId && (where.txnAt ? r.txnAt >= where.txnAt.gte && r.txnAt < where.txnAt.lt && r.withdrawal === where.withdrawal && r.deposit === where.deposit : r.transactionId == null)),
      create: async ({ data }: { data: Omit<StoredBank, 'id'> }) => {
        const r = { ...data, id: savedBanks.length + 1 }; savedBanks.push(r); return r;
      },
      updateMany: async ({ where, data }: { where: { id: number }; data: Partial<StoredBank> }) => {
        const row = savedBanks.find((r) => r.id === where.id && r.transactionId == null);
        if (!row) return { count: 0 };
        Object.assign(row, data); return { count: 1 };
      },
    },
    transaction: {
      create: async ({ data }: { data: { amount: number } }) => {
        const r = { id: ledger.length + 1, ...data }; ledger.push(r); return r;
      },
      delete: async ({ where }: { where: { id: number } }) => ledger.splice(ledger.findIndex((r) => r.id === where.id), 1),
    },
  };
  const registry = { get: () => input.actualParser ? new ParserRegistry().get('shinhan_card' as never) : { parse: () => input.result } };
  const pipeline = new ImportPipelineService(
    prisma as never, { load: async () => input.file } as never, registry as never,
    { classify: async () => '04' } as never,
    { classifyCardSettlements: async () => {}, classifySelfTransfers: async () => {} } as never,
    {} as never, { autoClassifyBank: async () => {}, autoClassifyCard: async () => {} } as never,
  );
  return { input, savedCards, savedBanks, ledger, updates, job, run: () => pipeline.process(job.id) };
}

describe('저장 직전 중복 차단', () => {
  it('카드 파일 안의 동일 행은 한 번만 저장하고 재업로드에서는 신규만 저장한다', async () => {
    const h = harness(cards([card, { ...card }]));
    await h.run();
    expect(h.savedCards).toHaveLength(1);
    expect(h.ledger).toHaveLength(1);
    h.input.result = cards([{ ...card, txnDate: new Date('2026-08-14T10:12:00Z') }, { ...card, dedupHash: 'another-file-key' }, card]);
    await h.run();
    expect(h.savedCards).toHaveLength(2);
    expect(h.ledger).toHaveLength(2);
    expect(h.updates.at(-1)?.status).toBe('completed');
  });

  it('승인번호가 있는 이용내역과 승인번호 없는 명세서의 같은 거래를 중복 등록하지 않는다', async () => {
    const h = harness(cards([{ ...card, approvalNo: '123456' }]));
    await h.run();
    h.input.result = cards([card]);
    await h.run();
    expect(h.savedCards).toHaveLength(1);
    expect(h.ledger).toHaveLength(1);
  });

  it('다른 시각·실제 승인번호·카드의 거래는 각각 보존한다', async () => {
    const h = harness(cards([{ ...card, approvalNo: '111' }, { ...card, approvalNo: '222' }, { ...card, txnDate: new Date('2026-08-13T11:12:00Z') }]));
    await h.run();
    expect(h.savedCards).toHaveLength(3);
    h.job.paymentMethodId = 2;
    h.input.result = cards([card]);
    await h.run();
    expect(h.savedCards).toHaveLength(4);
    expect(h.ledger).toHaveLength(4);
  });

  it('구버전 키로 저장된 동일 카드 거래도 건너뛴다', async () => {
    const h = harness(cards([card]));
    h.savedCards.push({ ...card, txnDate: new Date('2026-08-13T00:00:00Z'), id: 1, householdId: 1, paymentMethodId: 1, isCanceled: 'N', dedupHash: 'legacy#2', transactionId: 123 });
    await h.run();
    expect(h.savedCards).toHaveLength(1);
    expect(h.ledger).toHaveLength(0);
  });

  it('은행 동일 거래는 한 번만 저장하고 다른 시각·통장은 유지한다', async () => {
    const h = harness(banks([bank, { ...bank, balance: 80000 }]));
    await h.run();
    expect(h.savedBanks).toHaveLength(1);
    expect(h.ledger).toHaveLength(1);
    h.input.result = banks([bank, { ...bank, txnAt: new Date('2026-09-01T10:12:01Z') }]);
    await h.run();
    expect(h.savedBanks).toHaveLength(2);
    expect(h.ledger).toHaveLength(2);
    h.job.paymentMethodId = 2;
    await h.run();
    expect(h.savedBanks).toHaveLength(4);
    expect(h.ledger).toHaveLength(4);
  });

  it('잘못된 이용일이 섞인 신한 파일은 앞부분의 정상 거래도 저장하지 않는다', async () => {
    const h = harness(cards([]));
    h.input.actualParser = true;
    h.input.file = Buffer.from('이용일,이용카드,이용가맹점,이용금액,할부기간,회차,원금,수수료,적용구분\n2026.08.13,본인253,정상거래,12000,,,12000,0,정상\n날짜오류,본인253,잘못된거래,12000,,,12000,0,정상');
    await h.run();
    expect(h.savedCards).toHaveLength(0);
    expect(h.ledger).toHaveLength(0);
    expect(h.updates.at(-1)).toMatchObject({ status: 'failed', error: expect.stringContaining('거래일을 임의로 대체하지 않았습니다') });
  });
});
