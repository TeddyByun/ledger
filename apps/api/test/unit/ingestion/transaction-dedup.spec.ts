import { bankIdentity, cardIdentity, compatibleCardIdentity, duplicateKeyError, sameLegacyCard } from '../../../src/ingestion/pipeline/transaction-dedup.js';
import type { NormalizedBankRow, NormalizedCardRow } from '../../../src/ingestion/parsers/types.js';

const bank: NormalizedBankRow = { txnAt: new Date('2026-09-01T10:01:20Z'), txnTypeRaw: '이체', description: '거래처', withdrawal: 100, deposit: 0, balance: 900, branch: null, dedupHash: '' };
const card: NormalizedCardRow = { txnDate: new Date('2026-09-01T10:01:20Z'), merchantName: '카페', usageAmount: 100, principal: 100, fee: 0, cardLabel: '본인', cardNo: '1234', installmentPeriod: null, billingRound: null, benefitType: null, benefitAmount: 0, region: null, saleType: null, isCanceled: false, point: 0, dedupHash: '' };
const day = new Date('2026-09-01T00:00:00Z');

describe('저장 거래 공통 중복 키', () => {
  it('동일 통장·일시·금액·거래처는 파일/잔액/공백 차이와 무관하게 같은 거래다', () => {
    expect(bankIdentity(1, bank)).toBe(bankIdentity(1, { ...bank, balance: 800, dedupHash: 'other-format', description: ' 거래처 ' }));
  });
  it('같은 날이라도 시각 또는 통장이 다르면 별도 거래다', () => {
    expect(bankIdentity(1, bank)).not.toBe(bankIdentity(1, { ...bank, txnAt: new Date('2026-09-01T10:01:21Z') }));
    expect(bankIdentity(1, bank)).not.toBe(bankIdentity(2, bank));
  });
  it('카드 원본에 있는 시각은 날짜 표시와 별도로 키에 유지한다', () => {
    expect(cardIdentity(1, card, day)).not.toBe(cardIdentity(1, { ...card, txnDate: new Date('2026-09-01T11:01:20Z') }, day));
  });
  it('실지출 금액과 카드가 같으면 파서별 해시·승인금액 표기가 달라도 동일하다', () => {
    expect(cardIdentity(1, card, day)).toBe(cardIdentity(1, { ...card, dedupHash: 'different', usageAmount: 200 }, day));
    expect(cardIdentity(1, card, day)).not.toBe(cardIdentity(2, card, day));
  });
  it('할부의 다른 회차와 실제 승인번호가 다른 별도 결제는 구별한다', () => {
    expect(cardIdentity(1, { ...card, installmentPeriod: '3', billingRound: '1' }, day)).not.toBe(cardIdentity(1, { ...card, installmentPeriod: '3', billingRound: '2' }, day));
    const a = cardIdentity(1, { ...card, approvalNo: '111' }, day);
    const b = cardIdentity(1, { ...card, approvalNo: '222' }, day);
    expect(compatibleCardIdentity(a, b)).toBe(false);
    expect(compatibleCardIdentity(a, a)).toBe(true);
    expect(compatibleCardIdentity(a, cardIdentity(1, card, day))).toBe(true);
  });
  it('이전 버전 데이터는 거래처·실지출 금액·회차를 대조한다', () => {
    const old = { dedupHash: 'old-key#2', merchantName: '카페', principal: 100, fee: 0, installmentPeriod: null, billingRound: null, isCanceled: 'N' };
    expect(sameLegacyCard(old, card)).toBe(true);
    expect(sameLegacyCard({ ...old, principal: 200 }, card)).toBe(false);
    expect(sameLegacyCard({ ...old, billingRound: '2' }, card)).toBe(false);
  });
  it('중복 키 충돌만 중복으로 취급하고 다른 DB 오류는 숨기지 않는다', () => {
    expect(duplicateKeyError({ code: 'P2002', meta: { target: ['household_id', 'dedup_hash'] } })).toBe(true);
    expect(duplicateKeyError({ code: 'P2002', meta: { target: ['transaction_id'] } })).toBe(false);
    expect(duplicateKeyError(new Error('database disconnected'))).toBe(false);
  });
});
