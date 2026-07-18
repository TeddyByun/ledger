'use client';

import { useEffect, useRef, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { PaymentMethod, ImportJob, ImportRecord } from '@/lib/types';

const ISSUERS = [
  { value: 'hana_bank', label: '하나은행', kind: 'bank' as const },
  { value: 'hana_card', label: '하나카드', kind: 'card' as const },
  { value: 'hyundai_card', label: '현대카드', kind: 'card' as const },
  { value: 'shinhan_card', label: '신한카드', kind: 'card' as const },
  { value: 'samsung_card', label: '삼성카드', kind: 'card' as const },
];

/** 파일명에서 발급사 추정 (예: '2604_신한카드-…' → shinhan_card) */
function detectIssuer(filename: string): string | null {
  const name = filename.replace(/\s/g, '');
  for (const i of ISSUERS) {
    if (name.includes(i.label)) return i.value;
  }
  return null;
}

const STATUS_LABEL: Record<ImportJob['status'], string> = {
  queued: '대기 중',
  parsing: '파싱 중',
  classifying: '분류 중',
  review: '검토 대기',
  completed: '완료',
  failed: '실패',
};

export function Imports() {
  const [issuer, setIssuer] = useState('hana_bank');
  const [pms, setPms] = useState<PaymentMethod[]>([]);
  const [paymentMethodId, setPaymentMethodId] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [job, setJob] = useState<ImportJob | null>(null);
  const [autoDetected, setAutoDetected] = useState(false);
  const [records, setRecords] = useState<ImportRecord[]>([]);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const loadRecords = () =>
    api.get<ImportRecord[]>('/imports').then(setRecords).catch(() => {});

  // 파일 선택 시 파일명으로 발급사 자동 선택(추정 실패 시 현재 값 유지)
  const onPickFile = (f: File | null) => {
    setFile(f);
    setError(null);
    if (f) {
      const det = detectIssuer(f.name);
      if (det && det !== issuer) setIssuer(det);
      setAutoDetected(!!det);
    } else {
      setAutoDetected(false);
    }
  };

  const kind = ISSUERS.find((i) => i.value === issuer)?.kind ?? 'bank';
  const options = pms.filter((p) => p.methodType === kind);

  useEffect(() => {
    api.get<PaymentMethod[]>('/payment-methods').then(setPms).catch(() => {});
    loadRecords();
    return () => {
      if (timer.current) clearTimeout(timer.current);
    };
  }, []);

  // 발급사 유형이 바뀌면 결제수단 선택 초기화
  useEffect(() => {
    setPaymentMethodId('');
  }, [issuer]);

  const poll = (jobId: string) => {
    api
      .get<ImportJob>(`/imports/${jobId}`)
      .then((j) => {
        setJob(j);
        if (j.status !== 'completed' && j.status !== 'review' && j.status !== 'failed') {
          timer.current = setTimeout(() => poll(jobId), 1500);
        } else {
          loadRecords(); // 완료/실패 시 기록 목록 갱신
        }
      })
      .catch(() => {});
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!file) return setError('파일을 선택하세요.');
    // 은행·카드 모두 파일 내용에서 계좌/카드번호로 자동 인식 → 선택 안 해도 됨.
    setBusy(true);
    setJob(null);
    try {
      const form = new FormData();
      form.append('issuer', issuer);
      form.append('paymentMethodId', paymentMethodId);
      form.append('file', file);
      const created = await api.upload<ImportJob>('/imports', form);
      poll(created.id);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : '업로드에 실패했습니다.');
    } finally {
      setBusy(false);
    }
  };

  const done = job && (job.status === 'completed' || job.status === 'review');

  return (
    <>
      <header className="topbar">
        <span className="crumb">
          관리 / <b>명세서 업로드</b>
        </span>
      </header>
      <main className="page">
        <div className="page-head">
          <div className="titles">
            <h1>명세서 업로드</h1>
            <p>카드·은행 명세서(엑셀)를 올리면 자동으로 분류·적재됩니다.</p>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="grid cols-2">
          <div className="card" style={{ alignSelf: 'start' }}>
            <div className="card-head">
              <h3>새 업로드</h3>
            </div>
            <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div className="field">
                <label htmlFor="file">명세서 파일 (.xlsx)</label>
                <input
                  id="file"
                  className="input"
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => onPickFile(e.target.files?.[0] ?? null)}
                  style={{ padding: 9 }}
                />
                {!file && (
                  <span className="muted" style={{ fontSize: 11 }}>
                    파일을 선택하면 발급사와 계좌/카드가 자동으로 인식됩니다.
                  </span>
                )}
              </div>

              {file && (
                <>
                  <div className="field">
                    <label htmlFor="issuer">
                      발급사
                      {autoDetected && (
                        <span className="muted"> (파일명에서 자동 선택됨)</span>
                      )}
                    </label>
                    <select
                      id="issuer"
                      className="select"
                      value={issuer}
                      onChange={(e) => {
                        setIssuer(e.target.value);
                        setAutoDetected(false);
                      }}
                    >
                      {ISSUERS.map((i) => (
                        <option key={i.value} value={i.value}>
                          {i.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label htmlFor="pm">
                      {kind === 'bank' ? '계좌' : '카드'}
                      <span className="muted"> (선택 — 파일에서 자동 인식)</span>
                    </label>
                    <select
                      id="pm"
                      className="select"
                      value={paymentMethodId}
                      onChange={(e) => setPaymentMethodId(e.target.value)}
                    >
                      <option value="">파일에서 자동 인식</option>
                      {options.map((p) => (
                        <option key={p.id} value={p.id}>
                          {p.name}
                          {p.cardNo ? ` (${p.cardNo})` : ''}
                        </option>
                      ))}
                    </select>
                    <span className="muted" style={{ fontSize: 11 }}>
                      {kind === 'bank'
                        ? '은행 명세서는 파일 안 계좌번호로 자동 매칭·등록됩니다. (특정 계좌로 강제하려면 선택)'
                        : '카드 명세서는 파일 안 카드번호로 자동 매칭·등록됩니다. (특정 카드로 강제하려면 선택)'}
                    </span>
                  </div>
                </>
              )}

              <button
                className="btn primary"
                type="submit"
                disabled={busy || !file}
                style={{ justifyContent: 'center', padding: 11 }}
              >
                {busy ? '업로드 중…' : '업로드'}
              </button>
            </form>
          </div>

          <div className="card" style={{ alignSelf: 'start' }}>
            <div className="card-head">
              <h3>진행 상태</h3>
              {job && (
                <div className="r">
                  <span className={`pill ${job.status === 'failed' ? 'expense' : done ? 'settled' : 'pending'}`}>
                    {STATUS_LABEL[job.status]}
                  </span>
                </div>
              )}
            </div>
            {!job ? (
              <div className="empty">
                <p>업로드하면 여기에 진행 상태가 표시됩니다.</p>
              </div>
            ) : job.status === 'failed' ? (
              <div className="error-banner">적재 실패: {job.error ?? '알 수 없는 오류'}</div>
            ) : (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
                <div className="grid cols-3">
                  <Stat label="파싱" value={job.parsedRows} />
                  <Stat label="자동분류" value={job.classifiedRows} />
                  <Stat label="검토 대기" value={job.pendingRows} />
                </div>
                {done && (
                  <div className="callout" style={{ fontSize: 13 }}>
                    적재 완료 —{' '}
                    <b>{job.classifiedRows}건 자동분류</b>
                    {job.pendingRows > 0 && `, ${job.pendingRows}건은 검토가 필요합니다`}. “거래
                    내역”에서 확인하세요.
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {/* 업로드 기록 */}
        <div className="card" style={{ marginTop: 16 }}>
          <div className="card-head">
            <h3>업로드 기록</h3>
            <div className="r">
              <span className="tag">{records.length}건</span>
            </div>
          </div>
          {records.length === 0 ? (
            <div className="empty">
              <p>아직 업로드한 명세서가 없습니다.</p>
            </div>
          ) : (
            <div className="tbl-wrap">
              <table className="tbl">
                <thead>
                  <tr>
                    <th>업로드일시</th>
                    <th>발급사</th>
                    <th>파일명</th>
                    <th>명세서월</th>
                    <th style={{ textAlign: 'right' }}>파싱</th>
                    <th style={{ textAlign: 'right' }}>자동분류</th>
                    <th style={{ textAlign: 'right' }}>검토대기</th>
                    <th>상태</th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((r) => (
                    <tr key={r.id}>
                      <td className="date" style={{ whiteSpace: 'nowrap' }}>
                        {r.createdAt.slice(0, 16).replace('T', ' ')}
                      </td>
                      <td className="muted">{issuerLabel(r.issuer)}</td>
                      <td>
                        <b>{r.originalName ?? '—'}</b>
                      </td>
                      <td className="muted">{r.statementYm ?? '—'}</td>
                      <td className="money">{r.parsedRows.toLocaleString()}</td>
                      <td className="money inc">{r.classifiedRows.toLocaleString()}</td>
                      <td className="money">{r.pendingRows.toLocaleString()}</td>
                      <td>
                        <span
                          className={`pill ${
                            r.status === 'failed'
                              ? 'expense'
                              : r.status === 'completed' || r.status === 'review'
                                ? 'settled'
                                : 'pending'
                          }`}
                          title={r.error ?? ''}
                        >
                          {STATUS_LABEL[r.status]}
                        </span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </main>
    </>
  );
}

/** 발급사 코드 → 표시명 */
function issuerLabel(value: string): string {
  return ISSUERS.find((i) => i.value === value)?.label ?? value;
}

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="stat" style={{ padding: '14px 16px' }}>
      <div className="lbl">{label}</div>
      <div className="val" style={{ fontSize: 24 }}>
        {value}
        <span className="w"> 건</span>
      </div>
    </div>
  );
}
