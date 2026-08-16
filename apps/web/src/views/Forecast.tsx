'use client';

import { useCallback, useEffect, useState } from 'react';
import { api } from '@/lib/api';
import { won } from '@/lib/format';
import type { View } from '@/components/Shell';
import { MonthPicker } from '@/components/MonthPicker';

interface Contribution {
  kind: string;
  group: 'fixed' | 'certain' | 'estimated';
  label: string;
  categoryCode?: string;
  predicted: number;
  occurred: number;
  remaining: number;
  status: string;
  basis: string;
  confidence: 'high' | 'med' | 'low';
}
interface ForecastData {
  ym: string;
  total: number;
  range: { low: number; high: number };
  abc: { A: number; B: number; C: number };
  progress: { day: number; days: number };
  prev: { ym: string; actual: number };
  contributions: Contribution[];
}

interface FlowLine {
  flow: 'income' | 'expense';
  kind: 'salary' | 'income-recurring' | 'income-etc' | 'card' | 'recurring' | 'variable' | 'actual';
  label: string;
  amount: number;
  day: number | null;
  basis: string;
  confidence: 'high' | 'med' | 'low';
  actual: boolean;
}
interface DayItem {
  flow: 'income' | 'expense';
  label: string;
  amount: number;
  kind: FlowLine['kind'];
  actual: boolean;
}
interface DayRow {
  day: number;
  date: string;
  income: number;
  expense: number;
  net: number;
  balance: number;
  hasActual: boolean;
  isForecast: boolean;
  items: DayItem[];
}
interface FlowSide {
  total: number;
  actual: number;
  predicted: number;
  predictedItems: FlowLine[];
  actualItems: FlowLine[];
}
interface CashflowData {
  ym: string;
  scope: { accountId: number; accountName: string; options: { id: number; name: string }[] };
  daysInMonth: number;
  today: number | null;
  isCurrentMonth: boolean;
  actualUntil: number;
  opening: {
    balance: number;
    asOf: string | null;
    accounts: { id: number; name: string; balance: number; asOf: string | null }[];
    excludedAccounts: string[];
  };
  closing: { balance: number };
  income: FlowSide;
  expense: FlowSide;
  net: number;
  unscheduled: { income: number; expense: number };
  lowest: DayRow;
  daily: DayRow[];
  prevYm: string;
}

const KIND_LABEL: Record<string, string> = {
  R1: '경조사',
  R2: '공과금',
  R3: '할부',
  R4: '정기',
  R6: '연례',
  R7: '대출·적금',
  VAR: '변동',
};
const CONF_LABEL: Record<string, string> = { high: '높음', med: '중', low: '낮음' };
const FLOW_KIND_LABEL: Record<FlowLine['kind'], string> = {
  salary: '급여',
  'income-recurring': '반복 수입',
  'income-etc': '기타',
  card: '카드대금',
  recurring: '정기',
  variable: '변동',
  actual: '실적',
};
const DOW = ['일', '월', '화', '수', '목', '금', '토'];

/** 기본 = 이번 달 */
function thisMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}
const shiftMonth = (ym: string, delta: number) => {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y!, m! - 1 + delta, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
};

export function Forecast(_props: { onNavigate: (v: View) => void }) {
  const [ym, setYm] = useState(thisMonth);
  const [acct, setAcct] = useState<number | null>(null);
  const [cf, setCf] = useState<CashflowData | null>(null);
  const [data, setData] = useState<ForecastData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async (m: string, a: number | null) => {
    const [c, f] = await Promise.all([
      api.get<CashflowData>(`/stats/cashflow?ym=${m}${a ? `&accountId=${a}` : ''}`),
      api.get<ForecastData>(`/stats/forecast?ym=${m}`),
    ]);
    setCf(c);
    setData(f);
    setAcct((prev) => prev ?? c.scope.accountId); // 첫 조회 시 기본 계좌 고정
  }, []);

  useEffect(() => {
    setLoading(true);
    setError(null);
    load(ym, acct)
      .catch((e) => {
        setCf(null);
        setData(null);
        setError((e as Error).message);
      })
      .finally(() => setLoading(false));
  }, [ym, acct, load]);

  const abc = data?.abc ?? { A: 0, B: 0, C: 0 };
  const totalAbc = Math.max(1, abc.A + abc.B + abc.C);

  return (
    <>
      <header className="topbar">
        <span className="crumb">
          집계 / <b>예상 수입•지출</b>
        </span>
      </header>
      <main className="page">
        <div className="page-head">
          <div className="titles">
            <h1>예상 수입•지출</h1>
            <p>
              선택한 <b>은행 계좌 1개</b>를 기준으로 그 달의 수입·지출과 <b>일자별 잔액</b>을
              예측합니다. 카드는 사용 시점이 아니라 <b>전월 이용액이 이번 달 카드대금</b>으로
              빠져나가는 날에 반영됩니다.
            </p>
          </div>
        </div>

        {/* 월 선택 */}
        <div className="card" style={{ marginBottom: 16 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
            <div className="field">
              <label>조회 월</label>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <button
                  className="btn ghost sm"
                  style={{ flex: 'none' }}
                  onClick={() => setYm(shiftMonth(ym, -1))}
                >
                  ‹ 이전
                </button>
                <MonthPicker
                  value={ym}
                  onChange={(v) => v && setYm(v)}
                  placeholder="조회 월"
                  width={120}
                  quickOffsets={[]}
                />
                <button
                  className="btn ghost sm"
                  style={{ flex: 'none' }}
                  onClick={() => setYm(shiftMonth(ym, 1))}
                >
                  다음 ›
                </button>
              </div>
            </div>
            <button className="btn" onClick={() => setYm(thisMonth())}>
              이번 달
            </button>
            {cf && (
              <div className="field" style={{ minWidth: 190 }}>
                <label>기준 계좌</label>
                <select
                  className="select"
                  value={acct ?? cf.scope.accountId}
                  onChange={(e) => setAcct(Number(e.target.value))}
                  title="이 계좌의 입출금만으로 일자별 잔액을 예측합니다"
                >
                  {cf.scope.options.map((o) => (
                    <option key={o.id} value={o.id}>
                      {o.name}
                    </option>
                  ))}
                </select>
              </div>
            )}
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        {loading ? (
          <div className="card">
            <div className="skeleton" style={{ height: 120 }} />
          </div>
        ) : !cf ? (
          <div className="card">
            <div className="empty">
              <p>예측할 데이터가 없습니다.</p>
            </div>
          </div>
        ) : (
          <>
            {/* 요약 */}
            <div className="card" style={{ marginBottom: 18 }}>
              <div
                style={{
                  display: 'grid',
                  gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
                  gap: 14,
                }}
              >
                <Metric
                  label={`기초 잔액${cf.opening.asOf ? ` (${cf.opening.asOf} 기준)` : ''}`}
                  value={cf.opening.balance}
                />
                <Metric label="예상 수입" value={cf.income.total} color="var(--income)" />
                <Metric label="예상 지출" value={cf.expense.total} color="var(--expense)" />
                <Metric
                  label="순증감"
                  value={cf.net}
                  color={cf.net >= 0 ? 'var(--income)' : 'var(--expense)'}
                />
                <Metric
                  label="월말 예상 잔액"
                  value={cf.closing.balance}
                  color={cf.closing.balance >= 0 ? 'var(--ink)' : 'var(--expense)'}
                  strong
                />
                <Metric
                  label={`최저 잔액 (${cf.lowest.date.slice(5)})`}
                  value={cf.lowest.balance}
                  color="var(--warn)"
                  strong
                />
              </div>
              <div className="muted" style={{ fontSize: 12, marginTop: 12, lineHeight: 1.7 }}>
                기준 계좌: <b>{cf.scope.accountName}</b> 1개 — 이 계좌의 입출금만 계산합니다(다른
                계좌에서 들어오는 이체도 이 계좌의 수입으로 잡습니다).
                {cf.opening.excludedAccounts.length > 0 && (
                  <> 제외: {cf.opening.excludedAccounts.join(' · ')}</>
                )}
                <br />
                {cf.actualUntil > 0
                  ? `1~${cf.actualUntil}일은 실제 은행 거래, ${cf.actualUntil + 1}일부터 예측입니다.`
                  : '해당 월의 은행 거래가 아직 없어 전체를 예측했습니다.'}
                <br />
                예측은 <b>날짜가 특정되는 현금 흐름만</b> 잡습니다. 날짜가 일정하지 않은 흐름(수입 약
                ₩{won(cf.unscheduled.income)} · 지출 약 ₩{won(cf.unscheduled.expense)})은 일자별
                잔액에 <b>포함하지 않았습니다</b> — 그만큼 여유를 두고 보세요.
              </div>
            </div>

            {/* 1. 예상 수입 목록 */}
            <FlowSection
              title="예상 수입"
              sub="이 계좌에 반복 입금되는 것 + 관리>정기수입에 등록한 항목(계좌와 무관하게 모두 표시 · 다른 계좌 입금이면 근거에 계좌명 표기 → 월말 잔액은 실제와 다를 수 있음)"
              accent="var(--income)"
              side={cf.income}
              flow="income"
            />

            {/* 2. 예상 지출 목록 */}
            <FlowSection
              title="예상 지출"
              sub="이 계좌에서 실제로 나가는 출금만 — 카드대금·정기 출금·반복 출금 (날짜 미확정 지출은 제외)"
              accent="var(--expense)"
              side={cf.expense}
              flow="expense"
            />

            {/* 3. 일자별 현금흐름 */}
            <DailyTable cf={cf} />

            {/* 4. 소비 기준 예상 지출(카드 포함) — 기존 규칙 엔진 */}
            {data && (
              <>
                <div style={{ margin: '26px 0 10px' }}>
                  <h2 style={{ fontSize: 16, margin: 0 }}>소비 기준 예상 지출 (카드 사용 시점)</h2>
                  <div className="muted" style={{ fontSize: 12 }}>
                    현금이 나가는 시점이 아니라 <b>실제 소비한 시점</b> 기준입니다. 위 현금흐름과
                    합계가 다를 수 있습니다.
                  </div>
                </div>

                <div className="card" style={{ marginBottom: 18 }}>
                  <div className="muted" style={{ fontSize: 12.5 }}>
                    {data.ym} 예상 총지출(소비 기준)
                  </div>
                  <div
                    style={{ display: 'flex', alignItems: 'baseline', gap: 12, flexWrap: 'wrap' }}
                  >
                    <div
                      style={{
                        fontSize: 30,
                        fontWeight: 800,
                        color: 'var(--expense)',
                        letterSpacing: '-0.03em',
                      }}
                    >
                      ₩{won(data.total)}
                    </div>
                    <div className="muted" style={{ fontSize: 13 }}>
                      범위 ₩{won(data.range.low)} ~ ₩{won(data.range.high)}
                    </div>
                  </div>

                  <div style={{ marginTop: 16 }}>
                    <div
                      style={{
                        display: 'flex',
                        height: 26,
                        borderRadius: 8,
                        overflow: 'hidden',
                        boxShadow: 'var(--nm-in-sm)',
                        background: 'var(--surface-2)',
                      }}
                    >
                      {(
                        [
                          ['A', abc.A, 'var(--c6)', '이미 지출'],
                          ['B', abc.B, 'var(--c4)', '남은 정기·스케줄'],
                          ['C', abc.C, 'var(--c1)', '예상 변동'],
                        ] as const
                      ).map(([k, v, color, title]) => (
                        <div
                          key={k}
                          title={`${title} ₩${won(v)}`}
                          style={{ width: `${(v / totalAbc) * 100}%`, background: color }}
                        />
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 18, marginTop: 8, flexWrap: 'wrap' }}>
                      {(
                        [
                          ['이미 지출', abc.A, 'var(--c6)'],
                          ['남은 정기·스케줄', abc.B, 'var(--c4)'],
                          ['예상 변동', abc.C, 'var(--c1)'],
                        ] as const
                      ).map(([t, v, c]) => (
                        <span
                          key={t}
                          style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12.5 }}
                        >
                          <span
                            style={{
                              width: 11,
                              height: 11,
                              borderRadius: 3,
                              background: c,
                              display: 'inline-block',
                            }}
                          />
                          <span className="muted">{t}</span>
                          <b className="money">₩{won(v)}</b>
                        </span>
                      ))}
                    </div>
                  </div>
                </div>

                <ContribSection
                  title="고정 비용 (확정)"
                  sub="정기지출·할부·대출/적금 등 금액이 확정된 항목"
                  accent="var(--c4)"
                  rows={data.contributions.filter((c) => c.group === 'fixed')}
                />
                <ContribSection
                  title="반드시 발생하는 비용 (비고정)"
                  sub="공과금처럼 매월 꼭 나가지만 금액은 변동하는 항목 (전년 동월·최근 추세 기준)"
                  accent="var(--c6)"
                  rows={data.contributions.filter((c) => c.group === 'certain')}
                />
                <ContribSection
                  title="대략적 예측 (변동·경조사)"
                  sub="과거 지출로 추정한 항목 — 실제와 차이가 있을 수 있습니다"
                  accent="var(--c1)"
                  rows={data.contributions.filter((c) => c.group === 'estimated')}
                />
              </>
            )}

            <div className="callout">
              정기지출·대출/적금 만기는 <b>관리 &gt; 정기지출</b>에서 추천을 확정하거나 직접
              설정하면 예측이 더 정확해집니다.
            </div>
          </>
        )}
      </main>
    </>
  );
}

function Metric({
  label,
  value,
  color,
  strong,
}: {
  label: string;
  value: number;
  color?: string;
  strong?: boolean;
}) {
  return (
    <div>
      <div className="muted" style={{ fontSize: 12 }}>
        {label}
      </div>
      <div
        className="money"
        style={{
          fontSize: strong ? 24 : 20,
          fontWeight: strong ? 800 : 700,
          color: color ?? 'var(--ink)',
          letterSpacing: '-0.02em',
          marginTop: 2,
        }}
      >
        ₩{won(value)}
      </div>
    </div>
  );
}

/** 예상 수입 / 예상 지출 목록 */
function FlowSection({
  title,
  sub,
  accent,
  side,
  flow,
}: {
  title: string;
  sub: string;
  accent: string;
  side: FlowSide;
  flow: 'income' | 'expense';
}) {
  const [showActual, setShowActual] = useState(false);
  return (
    <div className="card" style={{ marginBottom: 18, borderLeft: `3px solid ${accent}` }}>
      <div className="card-head">
        <h3>{title}</h3>
        <span className="sub">{sub}</span>
        <div className="r">
          <span className="money" style={{ fontSize: 13 }}>
            합계 <b style={{ color: accent }}>₩{won(side.total)}</b>
            <span className="muted" style={{ fontSize: 12 }}>
              {' '}
              · 실적 ₩{won(side.actual)} / 예측 ₩{won(side.predicted)}
            </span>
          </span>
        </div>
      </div>

      {side.predictedItems.length === 0 ? (
        <div className="empty" style={{ padding: '18px 0' }}>
          <p>예측 항목이 없습니다.</p>
        </div>
      ) : (
        <div className="tbl-wrap" style={{ boxShadow: 'none' }}>
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ width: 62 }}>일자</th>
                <th style={{ width: 82 }}>구분</th>
                <th>항목</th>
                <th style={{ textAlign: 'right' }}>예상 금액</th>
                <th>근거 · 신뢰</th>
              </tr>
            </thead>
            <tbody>
              {side.predictedItems.map((l, i) => (
                <tr key={i}>
                  <td className="mono">{l.day == null ? '—' : `${l.day}일`}</td>
                  <td>
                    <span className="pill plain">{FLOW_KIND_LABEL[l.kind]}</span>
                  </td>
                  <td>
                    <b>{l.label}</b>
                  </td>
                  <td className="money" style={{ color: accent }}>
                    ₩{won(l.amount)}
                  </td>
                  <td className="muted" style={{ fontSize: 12 }}>
                    {l.basis} · {CONF_LABEL[l.confidence]}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {side.actualItems.length > 0 && (
        <div style={{ marginTop: 10 }}>
          <button className="btn ghost sm" onClick={() => setShowActual((v) => !v)}>
            {showActual ? '실제 발생 내역 접기' : `실제 발생 내역 보기 (${side.actualItems.length}건)`}
          </button>
          {showActual && (
            <div className="tbl-wrap" style={{ boxShadow: 'none', marginTop: 8 }}>
              <table className="tbl">
                <thead>
                  <tr>
                    <th style={{ width: 62 }}>일자</th>
                    <th>항목</th>
                    <th style={{ textAlign: 'right' }}>
                      {flow === 'income' ? '입금액' : '출금액'}
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {side.actualItems.map((l, i) => (
                    <tr key={i}>
                      <td className="mono">{l.day == null ? '—' : `${l.day}일`}</td>
                      <td>{l.label}</td>
                      <td className="money">₩{won(l.amount)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/** 1일~말일 현금흐름 표 */
function DailyTable({ cf }: { cf: CashflowData }) {
  const maxFlow = Math.max(1, ...cf.daily.map((d) => Math.max(d.income, d.expense)));
  return (
    <div className="card" style={{ marginBottom: 18 }}>
      <div className="card-head">
        <h3>일자별 현금흐름</h3>
        <span className="sub">
          1일부터 말일까지 수입·지출과 그날의 예상 잔액입니다. 회색 배경 = 실제 거래일
        </span>
        <div className="r">
          <span className="money" style={{ fontSize: 13 }}>
            월말 예상 잔액{' '}
            <b style={{ color: cf.closing.balance >= 0 ? 'var(--ink)' : 'var(--expense)' }}>
              ₩{won(cf.closing.balance)}
            </b>
          </span>
        </div>
      </div>
      <div className="tbl-wrap" style={{ boxShadow: 'none' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th style={{ width: 78 }}>일자</th>
              <th style={{ width: 110, textAlign: 'right' }}>수입</th>
              <th style={{ width: 110, textAlign: 'right' }}>지출</th>
              <th style={{ width: 120, textAlign: 'right' }}>잔액</th>
              <th>내역</th>
            </tr>
          </thead>
          <tbody>
            <tr style={{ background: 'var(--surface-2)' }}>
              <td className="mono">기초</td>
              <td />
              <td />
              <td className="money">
                <b>₩{won(cf.opening.balance)}</b>
              </td>
              <td className="muted" style={{ fontSize: 12 }}>
                {cf.opening.asOf ? `${cf.opening.asOf} 은행 잔액` : '잔액 정보 없음'}
              </td>
            </tr>
            {cf.daily.map((d) => {
              const dow = new Date(`${d.date}T00:00:00Z`).getUTCDay();
              const isToday = cf.isCurrentMonth && cf.today === d.day;
              return (
                <tr
                  key={d.day}
                  style={{
                    background: d.hasActual ? 'var(--surface-2)' : undefined,
                    outline: isToday ? '1px solid var(--c1)' : undefined,
                  }}
                >
                  <td className="mono" style={{ whiteSpace: 'nowrap' }}>
                    {d.day}일{' '}
                    <span
                      className="muted"
                      style={{ color: dow === 0 ? 'var(--expense)' : undefined }}
                    >
                      ({DOW[dow]})
                    </span>
                  </td>
                  <td className="money" style={{ color: d.income > 0 ? 'var(--income)' : 'var(--faint)' }}>
                    {d.income > 0 ? `₩${won(d.income)}` : '—'}
                  </td>
                  <td className="money" style={{ color: d.expense > 0 ? 'var(--expense)' : 'var(--faint)' }}>
                    {d.expense > 0 ? `₩${won(d.expense)}` : '—'}
                  </td>
                  <td
                    className="money"
                    style={{ color: d.balance >= 0 ? 'var(--ink)' : 'var(--expense)' }}
                  >
                    ₩{won(d.balance)}
                  </td>
                  <td style={{ fontSize: 12 }}>
                    <div
                      style={{
                        display: 'flex',
                        gap: 4,
                        alignItems: 'center',
                        flexWrap: 'wrap',
                      }}
                    >
                      {/* 규모 막대 */}
                      <span
                        style={{
                          width: 46,
                          height: 6,
                          borderRadius: 3,
                          background: 'var(--surface-2)',
                          position: 'relative',
                          overflow: 'hidden',
                          flex: '0 0 auto',
                        }}
                      >
                        <span
                          style={{
                            position: 'absolute',
                            inset: 0,
                            width: `${(Math.max(d.income, d.expense) / maxFlow) * 100}%`,
                            background: d.income >= d.expense ? 'var(--income)' : 'var(--expense)',
                          }}
                        />
                      </span>
                      {d.items.length === 0 ? (
                        <span className="muted">—</span>
                      ) : (
                        d.items
                          .slice()
                          .sort((a, b) => b.amount - a.amount)
                          .map((it, i) => (
                            <span
                              key={i}
                              className="pill plain"
                              title={`${it.label} ₩${won(it.amount)}`}
                              style={{
                                fontSize: 11,
                                opacity: it.actual ? 1 : 0.85,
                                borderLeft: `2px solid ${
                                  it.flow === 'income' ? 'var(--income)' : 'var(--expense)'
                                }`,
                              }}
                            >
                              {it.label.length > 14 ? `${it.label.slice(0, 14)}…` : it.label}
                              <span className="muted"> ₩{won(it.amount)}</span>
                            </span>
                          ))
                      )}
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function ContribSection({
  title,
  sub,
  accent,
  rows,
}: {
  title: string;
  sub: string;
  accent: string;
  rows: Contribution[];
}) {
  if (rows.length === 0) return null;
  const predicted = rows.reduce((s, c) => s + c.predicted, 0);
  const remaining = rows.reduce((s, c) => s + c.remaining, 0);
  return (
    <div className="card" style={{ marginBottom: 18, borderLeft: `3px solid ${accent}` }}>
      <div className="card-head">
        <h3>{title}</h3>
        <span className="sub">{sub}</span>
        <div className="r">
          <span className="money" style={{ fontSize: 13 }}>
            예상 합계 <b style={{ color: 'var(--expense)' }}>₩{won(predicted)}</b>
            {remaining > 0 && (
              <span className="muted" style={{ fontSize: 12 }}>
                {' '}
                · 남음 ₩{won(remaining)}
              </span>
            )}
          </span>
        </div>
      </div>
      <div className="tbl-wrap" style={{ boxShadow: 'none' }}>
        <table className="tbl">
          <thead>
            <tr>
              <th>구분</th>
              <th>항목</th>
              <th style={{ textAlign: 'right' }}>예상</th>
              <th style={{ textAlign: 'right' }}>발생</th>
              <th style={{ textAlign: 'right' }}>남음</th>
              <th>근거 · 신뢰</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c, i) => (
              <tr key={i}>
                <td>
                  <span className="pill plain">{KIND_LABEL[c.kind] ?? c.kind}</span>
                </td>
                <td>
                  <b>{c.label}</b>
                </td>
                <td className="money">₩{won(c.predicted)}</td>
                <td className="money muted">{c.occurred > 0 ? `₩${won(c.occurred)}` : '—'}</td>
                <td
                  className="money"
                  style={{ color: c.remaining > 0 ? 'var(--expense)' : 'var(--muted)' }}
                >
                  {c.remaining > 0 ? `₩${won(c.remaining)}` : '—'}
                </td>
                <td className="muted" style={{ fontSize: 12 }}>
                  {c.basis} · {CONF_LABEL[c.confidence] ?? c.confidence}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
