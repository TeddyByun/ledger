'use client';

import { useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { won } from '@/lib/format';
import type { View } from '@/components/Shell';
import { MonthPicker } from '@/components/MonthPicker';
import { CashflowSummary, type CashflowSideSummary } from '@/components/CashflowSummary';

interface Occurrence {
  id?: number; date?: string; day: number | null; label: string; amount: number; accountName?: string;
  source?: 'bank' | 'card';
}
interface FlowLine extends Occurrence {
  flow: 'income' | 'expense'; kind: string; basis: string; confidence: string; actual: boolean;
  planned?: boolean; occurred?: number; remaining: number; revised: number; status: string;
  occurrences: Occurrence[];
}
interface FlowSide extends CashflowSideSummary {
  predictedItems: FlowLine[]; actualItems: FlowLine[]; variableRemaining?: number;
}
interface DayRow {
  day: number; date: string; income: number; expense: number; net: number; balance: number;
  hasActual: boolean; isForecast: boolean; items: FlowLine[];
}
interface CashflowData {
  ym: string; actualUntil: number;
  scope: { accountName: string; accounts: { id: number; name: string }[]; externalAccounts: string[] };
  opening: { balance: number; asOf: string | null; accounts: { id: number; name: string; balance: number; asOf: string | null }[] };
  current: { balance: number; asOf: string | null }; closing: { balance: number };
  income: FlowSide; expense: FlowSide;
  spending: FlowSide & { bankActual: number; cardActual: number; cardSettlementActual: number; variableRemaining: number; regularRemaining: number; actualUntil: number };
  net: number; remainingNet: number; consumptionNet: number; transfer: { in: number; out: number };
  lowest: DayRow; daily: DayRow[]; unscheduled: { income: number; expense: number };
}
const monthNow = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};
const shiftMonth = (ym: string, delta: number) => {
  const [year, month] = ym.split('-').map(Number);
  return new Date(Date.UTC(year!, month! - 1 + delta, 1)).toISOString().slice(0, 7);
};
const money = (amount: number) => `₩${won(amount)}`;
const statuses: Record<string, string> = { occurred: '실적 반영', partial: '일부 발생', pending: '발생 예정', overdue: '예정일 지남 · 미확인', 'not-observed': '마감 · 발생 없음' };

export function Forecast(_props: { onNavigate: (v: View) => void }) {
  const [ym, setYm] = useState(monthNow);
  const [cf, setCf] = useState<CashflowData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [tab, setTab] = useState<'spending' | 'cash'>('spending');
  useEffect(() => {
    let stale = false;
    setLoading(true); setError(null);
    api.get<CashflowData>(`/stats/cashflow?ym=${ym}`)
      .then((data) => { if (!stale) setCf(data); })
      .catch((e) => { if (!stale) { setCf(null); setError((e as Error).message); } })
      .finally(() => { if (!stale) setLoading(false); });
    return () => { stale = true; };
  }, [ym]);
  return <>
    <header className="topbar"><span className="crumb">집계 / <b>예상 수입·지출</b></span></header>
    <main className="page">
      <div className="page-head"><div className="titles">
        <h1>예상 수입·지출</h1>
        <p>기준 통장의 외부 수입과 은행·카드 지출을 정기 계획에 맞춰 예측합니다. 현금흐름은 카드대금이 통장에서 나가는 시점으로 따로 확인합니다.</p>
      </div></div>
      <div className="card" style={{ marginBottom: 18 }}>
        <div style={{ display: 'flex', alignItems: 'center', flexWrap: 'wrap', gap: 10 }}>
          <button className="btn ghost sm" onClick={() => setYm(shiftMonth(ym, -1))}>‹ 이전</button>
          <MonthPicker value={ym} onChange={(v) => v && setYm(v)} placeholder="조회 월" width={120} quickOffsets={[]} />
          <button className="btn ghost sm" onClick={() => setYm(shiftMonth(ym, 1))}>다음 ›</button>
          <button className="btn" onClick={() => setYm(monthNow())}>이번 달</button>
          <span className="muted" style={{ marginLeft: 'auto', fontSize: 12 }}>기준 통장: {cf?.scope.accounts.map((a) => a.name).join(' · ') ?? '불러오는 중'}</span>
        </div>
      </div>
      {error && <div className="error-banner">{error}</div>}
      {loading ? <div className="card"><div className="skeleton" style={{ height: 120 }} /></div> : cf && <>
        <CashflowSummary data={cf} />
        <div className="cashflow-tabs" role="tablist" aria-label="예측 상세 기준">
          <button id="spending-tab" role="tab" aria-selected={tab === 'spending'} aria-controls="forecast-detail" className={`btn ${tab === 'spending' ? '' : 'ghost'}`} onClick={() => setTab('spending')}>수입·소비 지출 계획</button>
          <button id="cash-tab" role="tab" aria-selected={tab === 'cash'} aria-controls="forecast-detail" className={`btn ${tab === 'cash' ? '' : 'ghost'}`} onClick={() => setTab('cash')}>통장 현금흐름·잔액</button>
        </div>
        <div id="forecast-detail" role="tabpanel" aria-labelledby={tab === 'spending' ? 'spending-tab' : 'cash-tab'}>
          {tab === 'spending' ? <>
            <FlowSection title="예상 수입 · 계획과 실적" sub="세 기준 통장의 외부 입금만 반영합니다. 적금·청약 통장에서 들어오는 돈도 포함합니다." side={cf.income} flow="income" />
            <FlowSection title="예상 지출 · 계획과 실적" sub="은행 외부 지출(카드대금 제외) + 이번 달 카드 거래. 등록 정기 항목은 실제 발생일·금액으로 대체합니다." side={cf.spending} flow="expense" />
          </> : <>
            <FlowSection title="현금 출금 · 계획과 실적" sub="세 통장의 외부 출금이며 이번 달 납부하는 카드대금이 포함됩니다. 카드 사용액은 여기서 다시 더하지 않습니다." side={cf.expense} flow="expense" />
            <DailyTable cf={cf} />
          </>}
        </div>
        <div className="callout">기준 예상은 현재 <b>관리 &gt; 정기 수입·정기 지출</b> 등록값과 과거 이력으로 계산합니다. 월초에 저장된 고정값은 아닙니다.</div>
      </>}
    </main>
  </>;
}

function FlowSection({ title, sub, side, flow }: { title: string; sub: string; side: FlowSide; flow: 'income' | 'expense' }) {
  const [showActual, setShowActual] = useState(false);
  const accent = flow === 'income' ? 'var(--income)' : 'var(--expense)';
  return <section className="card" style={{ marginBottom: 18, borderLeft: `3px solid ${accent}` }}>
    <div className="cashflow-detail-heading"><div><h3>{title}</h3><p>{sub}</p></div><span>최종 예상 <b style={{ color: accent }}>{money(side.total)}</b></span></div>
    {side.predictedItems.length > 0 ? <div className="tbl-wrap" style={{ boxShadow: 'none' }}><table className="tbl">
      <thead><tr><th>예정일</th><th>항목 · 결제수단</th><th style={{ textAlign: 'right' }}>기준 예상</th><th style={{ textAlign: 'right' }}>실제 발생</th><th style={{ textAlign: 'right' }}>남은 예상</th><th style={{ textAlign: 'right' }}>수정 예상</th><th>상태 · 실제 일자</th></tr></thead>
      <tbody>{side.predictedItems.map((p, i) => <tr key={i}>
        <td className="mono">{p.day == null ? '—' : `${p.day}일`}</td>
        <td><b>{p.label}</b><div className="muted" style={{ fontSize: 11 }}>{p.accountName ?? '기준 통장'} · {p.basis}</div></td>
        <td className="money muted">{money(p.amount)}</td><td className="money">{p.occurred ? money(p.occurred) : '—'}</td>
        <td className="money">{money(p.remaining)}</td><td className="money" style={{ color: accent }}>{money(p.revised)}</td>
        <td><span className="muted" style={{ fontSize: 12 }}>{statuses[p.status]}</span>
          {p.occurrences.length > 0 && <details className="cashflow-occurrences"><summary>{p.occurrences.map((a) => `${a.day}일`).filter((v, j, all) => all.indexOf(v) === j).join(', ')} · {p.occurrences.length}건</summary>
            {p.occurrences.map((a, j) => <div key={j}>{a.date} · {a.accountName}<br />{a.label} {money(a.amount)}</div>)}
          </details>}
        </td>
      </tr>)}</tbody>
    </table></div> : <p className="muted">해당 월에 적용되는 정기 계획이 없습니다.</p>}
    {side.variableRemaining != null && <p className="muted" style={{ fontSize: 12 }}>남은 날짜의 변동 지출 예상 {money(side.variableRemaining)}이 위 최종 예상에 추가됩니다.</p>}
    {side.actualItems.length > 0 && <>
      <button className="btn ghost sm" style={{ marginTop: 12 }} onClick={() => setShowActual(!showActual)} aria-expanded={showActual}>{showActual ? '실제 내역 접기' : `실제 ${flow === 'income' ? '수입' : '지출'} 전체 보기 (${side.actualItems.length}건)`}</button>
      <p className="muted" style={{ fontSize: 12 }}>정기 계획 외 실제 {flow === 'income' ? '수입' : '지출'} {money(side.unplannedActual)}도 포함했습니다.</p>
      {showActual && <div className="tbl-wrap"><table className="tbl"><thead><tr><th>실제 발생일</th><th>항목</th><th>통장·카드</th><th style={{ textAlign: 'right' }}>금액</th></tr></thead><tbody>
        {side.actualItems.map((a, i) => <tr key={i}><td className="mono">{a.date}</td><td>{a.label}</td><td className="muted">{a.accountName}</td><td className="money">{money(a.amount)}</td></tr>)}
      </tbody></table></div>}
    </>}
  </section>;
}

function DailyTable({ cf }: { cf: CashflowData }) {
  return <section className="card" style={{ marginBottom: 18 }}>
    <div className="cashflow-detail-heading"><div><h3>일자별 현금흐름 · 기준 통장 합산</h3><p>기준 통장 사이의 이체는 제외합니다. 카드대금은 출금일에 반영하며 카드 사용은 포함하지 않습니다.</p></div></div>
    <div className="tbl-wrap"><table className="tbl"><thead><tr><th>일자</th><th style={{ textAlign: 'right' }}>외부 입금</th><th style={{ textAlign: 'right' }}>외부 출금</th><th style={{ textAlign: 'right' }}>합산 잔액</th><th>내역</th></tr></thead><tbody>
      <tr><td>기초</td><td /><td /><td className="money">{money(cf.opening.balance)}</td><td className="muted">통장별 직전 잔액 합산</td></tr>
      {cf.daily.map((d) => <tr key={d.day} style={{ background: d.hasActual ? 'var(--surface-2)' : undefined }}>
        <td className="mono">{d.day}일</td><td className="money" style={{ color: 'var(--income)' }}>{d.income ? money(d.income) : '—'}</td><td className="money" style={{ color: 'var(--expense)' }}>{d.expense ? money(d.expense) : '—'}</td><td className="money">{money(d.balance)}</td>
        <td><div style={{ display: 'flex', gap: 5, flexWrap: 'wrap' }}>{d.items.map((item, i) => <span className="pill plain" key={i} title={`${item.accountName ?? ''} ${item.basis}`} style={{ fontSize: 11 }}>{item.actual ? '' : '예상 · '}{item.label} {money(item.amount)}</span>)}</div></td>
      </tr>)}
    </tbody></table></div>
  </section>;
}
