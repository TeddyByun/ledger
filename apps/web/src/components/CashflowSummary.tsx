'use client';

import { won } from '@/lib/format';

export interface CashflowSideSummary {
  baseline: number;
  actual: number;
  predicted: number;
  total: number;
  change: number;
  unplannedActual: number;
  registeredBaseline: number;
  inferredBaseline: number;
}
interface SummaryData {
  ym: string;
  actualUntil: number;
  scope: { accountName: string; accounts: { id: number; name: string }[]; externalAccounts: string[] };
  opening: { balance: number; asOf: string | null; accounts: { id: number; name: string; balance: number; asOf: string | null }[] };
  current: { balance: number; asOf: string | null };
  closing: { balance: number };
  income: CashflowSideSummary;
  expense: CashflowSideSummary;
  spending: CashflowSideSummary & { bankActual: number; cardActual: number; cardSettlementActual: number; variableRemaining: number; regularRemaining: number; actualUntil: number };
  consumptionNet: number;
  transfer: { in: number; out: number };
  net: number;
  remainingNet: number;
  lowest: { date: string; balance: number };
  unscheduled: { income: number; expense: number };
}

const money = (value: number) => `₩${won(value)}`;
const signedMoney = (value: number) => `${value > 0 ? '+' : ''}${money(value)}`;

function FlowSummaryCard({ side, flow }: { side: CashflowSideSummary; flow: 'income' | 'expense' }) {
  const income = flow === 'income';
  const actualShare = side.total > 0 ? Math.min(100, side.actual / side.total * 100) : 0;
  return (
    <article className={`card cashflow-flow-card cashflow-${flow}`}>
      <div className="cashflow-card-heading">
        <h3>{income ? '이번 달 예상 수입' : '이번 달 예상 지출 · 소비 기준'}</h3>
        <span className="tag">{income ? '통장 외부 입금' : '은행 외부 지출 + 카드 사용'}</span>
      </div>
      <div className="cashflow-comparison">
        <div>
          <span className="cashflow-label">기준 예상 · 정기 등록 + 이력</span>
          <b className="cashflow-baseline">{money(side.baseline)}</b>
        </div>
        <span className="cashflow-arrow" aria-hidden="true">→</span>
        <div>
          <span className="cashflow-label">이번 달 최종 예상</span>
          <strong className="cashflow-revised">{money(side.total)}</strong>
        </div>
      </div>
      <p className="cashflow-footnote">정기 등록 {money(side.registeredBaseline)} + 이력 보완 {money(side.inferredBaseline)}</p>
      <div className="cashflow-delta">
        {side.change === 0 ? '기준 예상과 동일' :
          `기준보다 ${money(Math.abs(side.change))} ${side.change > 0 ? '증가' : '감소'}`}
      </div>
      <div className="cashflow-components">
        <div><span className="cashflow-label">{income ? '실제 외부 수입' : '실제 소비 지출'}</span><b>{money(side.actual)}</b></div>
        <span className="cashflow-plus" aria-hidden="true">＋</span>
        <div><span className="cashflow-label">{income ? '남은 수입 예상' : '남은 지출 예상'}</span><b>{money(side.predicted)}</b></div>
      </div>
      <div className="cashflow-progress" role="img" aria-label={`실제 ${money(side.actual)} + 남은 예상 ${money(side.predicted)} = 최종 예상 ${money(side.total)}`}>
        <span style={{ width: `${actualShare}%` }} />
      </div>
      <div className="cashflow-progress-caption"><span>실제 발생</span><span>남은 예상</span></div>
      {side.unplannedActual > 0 && <p className="cashflow-footnote">실제 발생에 계획 외 {income ? '수입' : '지출'} {money(side.unplannedActual)} 포함</p>}
    </article>
  );
}

export function CashflowSummary({ data }: { data: SummaryData }) {
  return (
    <section className="cashflow-summary" aria-label="이번 달 현금흐름 요약">
      <div className="cashflow-summary-context">
        <span><b>{data.scope.accounts.map((a) => a.name).join(' · ')}</b></span>
        <span className="tag">{data.actualUntil > 0 ? `${data.ym}-${String(data.actualUntil).padStart(2, '0')}까지 실적 반영` : '실적 없음 · 전체 예상'}</span>
      </div>
      <div className="cashflow-summary-grid">
        <FlowSummaryCard side={data.income} flow="income" />
        <FlowSummaryCard side={data.spending} flow="expense" />
      </div>
      <div className="cashflow-spending-equation">
        <p>실제 소비 지출 = 은행 외부 지출 {money(data.spending.bankActual)} + 이번 달 카드 거래 {money(data.spending.cardActual)}</p>
        <p>은행에서 빠진 카드대금 {money(data.spending.cardSettlementActual)}은 아래 현금 출금에만 반영합니다.</p>
        <p>남은 예상 = 정기·할부 {money(data.spending.regularRemaining)} + 과거 남은 날짜 기준 변동 지출 {money(data.spending.variableRemaining)}</p>
        <b>예상 수입 − 예상 소비 지출 = {signedMoney(data.consumptionNet)}</b>
      </div>
      <article className="card cashflow-balance-card">
        <div className="cashflow-card-heading"><h3>이번 달 현금흐름 · 통장 입출금 기준</h3><span className="tag">카드대금 출금 포함</span></div>
        <div className="cashflow-balance-grid" style={{ marginBottom: 20 }}>
          <div><span className="cashflow-label">현금 출금 기준 예상</span><b>{money(data.expense.baseline)}</b><small>정기 등록 + 과거 이력</small></div>
          <div><span className="cashflow-label">실제 외부 출금</span><b>{money(data.expense.actual)}</b><small>카드대금 포함</small></div>
          <div><span className="cashflow-label">남은 출금 예상</span><b>{money(data.expense.predicted)}</b><small>미발생 계획 + 변동 출금</small></div>
          <div><span className="cashflow-label">이번 달 최종 출금 예상</span><b>{money(data.expense.total)}</b><small>실제 출금 + 남은 예상</small></div>
        </div>
        <div className="cashflow-card-heading">
          <h3>기준 통장 합산 잔액 전망</h3>
          <span className="muted">기준 통장 사이의 내부 이체 제외</span>
        </div>
        <div className="cashflow-balance-grid">
          <div><span className="cashflow-label">기초 잔액</span><b>{money(data.opening.balance)}</b><small>{data.opening.asOf ?? '통장별 직전 잔액 합산'}</small></div>
          <div><span className="cashflow-label">실적 반영 잔액</span><b>{money(data.current.balance)}</b><small>{data.current.asOf ?? '실적 없음'} 기준</small></div>
          <div><span className="cashflow-label">앞으로의 잔액 증감</span><b>{signedMoney(data.remainingNet)}</b><small>남은 입금 예상 − 남은 출금 예상</small></div>
          <div className="cashflow-closing"><span className="cashflow-label">월말 예상 잔액</span><strong style={{ color: data.closing.balance < 0 ? 'var(--expense)' : 'var(--ink)' }}>{money(data.closing.balance)}</strong><small>실적 반영 잔액 + 앞으로의 잔액 증감</small></div>
        </div>
        <div className="cashflow-net-equation">
          <div><span>이번 달 현금 순증감</span><b style={{ color: data.net >= 0 ? 'var(--income)' : 'var(--expense)' }}>{signedMoney(data.net)}</b></div>
          <p>최종 입금 예상 {money(data.income.total)} − 최종 출금 예상 {money(data.expense.total)}</p>
          <p>기초 잔액 {money(data.opening.balance)} + 잔액 증감 {signedMoney(data.net)} = 월말 {money(data.closing.balance)}</p>
        </div>
        <div className="cashflow-lowest">월중 최저 예상 잔액 <b>{money(data.lowest.balance)}</b> <span>({data.lowest.date.slice(5)})</span></div>
      </article>
      <p className="cashflow-summary-note">
        세부 계획은 관리의 정기 수입·지출을 우선하고 과거 거래로 일정과 미등록 항목을 보완합니다.
        실적은 실제 발생일·금액에 연결하며 미발생 계획과 남은 날짜의 변동 지출만 추가합니다.
        기준 통장 사이의 이체 {money(data.transfer.out)}은 제외하고, {data.scope.externalAccounts.join(' · ') || '범위 밖 통장'}과의 거래는 외부 수입·지출에 포함합니다.
      </p>
      <details className="cashflow-uncertain">
        <summary>통장별 기초 잔액과 기준일</summary>
        {data.opening.accounts.map((a) => <p key={a.id}>{a.name} · {money(a.balance)} · {a.asOf ?? '잔액 정보 없음'}</p>)}
      </details>
    </section>
  );
}
