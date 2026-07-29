'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { Category } from '@/lib/types';

interface Keyword {
  id: number;
  pattern: string;
  matchType: 'contains' | 'exact' | 'regex';
  categoryCode: string;
  categoryName: string;
  priority: number;
  useYn: 'Y' | 'N';
}

interface AutoResult {
  classifiedSelfTransfer?: number;
  classifiedByRecurring: number;
  classifiedByHistory: number;
  classifiedByRule: number;
  remaining: number;
}

const matchLabel = (m: string) =>
  m === 'exact' ? '완전일치' : m === 'regex' ? '정규식' : '포함';

export function AutoClassifyKeywords() {
  const [rows, setRows] = useState<Keyword[]>([]);
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // 추가 폼
  const [pattern, setPattern] = useState('');
  const [catCode, setCatCode] = useState('');
  const [adding, setAdding] = useState(false);

  // 필터
  const [filterCat, setFilterCat] = useState('');
  const [search, setSearch] = useState('');

  // 인라인 수정
  const [editId, setEditId] = useState<number | null>(null);
  const [editPattern, setEditPattern] = useState('');
  const [editCat, setEditCat] = useState('');

  // 자동분류 실행
  const [running, setRunning] = useState(false);
  const [runMsg, setRunMsg] = useState<string | null>(null);

  const loadRows = () => api.get<Keyword[]>('/classify-keywords').then(setRows);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadRows(), api.get<Category[]>('/categories').then(setCats)])
      .catch((e) =>
        setError(e instanceof ApiError ? e.message : '불러오지 못했습니다.'),
      )
      .finally(() => setLoading(false));
  }, []);

  const catOptions = useMemo(
    () => [...cats].sort((a, b) => a.code.localeCompare(b.code)),
    [cats],
  );
  const topOptions = useMemo(() => cats.filter((c) => c.depth === 1), [cats]);

  const filtered = useMemo(() => {
    const q = search.trim();
    return rows.filter((r) => {
      if (filterCat && !(r.categoryCode === filterCat || r.categoryCode.startsWith(filterCat)))
        return false;
      if (q && !r.pattern.toLowerCase().includes(q.toLowerCase())) return false;
      return true;
    });
  }, [rows, filterCat, search]);

  const add = async () => {
    if (!pattern.trim() || !catCode) {
      setError('키워드와 분류를 입력하세요.');
      return;
    }
    setAdding(true);
    setError(null);
    try {
      await api.post('/classify-keywords', {
        pattern: pattern.trim(),
        categoryCode: catCode,
      });
      setPattern('');
      await loadRows();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '추가에 실패했습니다.');
    } finally {
      setAdding(false);
    }
  };

  const startEdit = (k: Keyword) => {
    setEditId(k.id);
    setEditPattern(k.pattern);
    setEditCat(k.categoryCode);
  };
  const saveEdit = async (id: number) => {
    if (!editPattern.trim() || !editCat) return;
    setError(null);
    try {
      await api.patch(`/classify-keywords/${id}`, {
        pattern: editPattern.trim(),
        categoryCode: editCat,
      });
      setEditId(null);
      await loadRows();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '수정에 실패했습니다.');
    }
  };

  const del = async (k: Keyword) => {
    if (!confirm(`키워드 "${k.pattern}"를 삭제할까요?`)) return;
    setError(null);
    try {
      await api.del(`/classify-keywords/${k.id}`);
      await loadRows();
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '삭제에 실패했습니다.');
    }
  };

  const runAuto = async () => {
    setRunning(true);
    setRunMsg(null);
    setError(null);
    try {
      const [bank, card] = await Promise.all([
        api.post<AutoResult>('/bank-transactions/auto-classify'),
        api.post<AutoResult>('/card-transactions/auto-classify'),
      ]);
      const byRule = bank.classifiedByRule + card.classifiedByRule;
      const byOther =
        bank.classifiedByRecurring +
        bank.classifiedByHistory +
        card.classifiedByRecurring +
        card.classifiedByHistory;
      const selfTransfer = bank.classifiedSelfTransfer ?? 0;
      const remaining = bank.remaining + card.remaining;
      setRunMsg(
        `키워드 규칙으로 ${byRule}건 분류 (그 외 정기지출·이력 ${byOther}건` +
          (selfTransfer > 0 ? `, 자기이체 분류제외 ${selfTransfer}건` : '') +
          `). 남은 미분류 ${remaining}건.`,
      );
    } catch (e) {
      setError(e instanceof ApiError ? e.message : '자동 분류에 실패했습니다.');
    } finally {
      setRunning(false);
    }
  };

  const catSelect = (value: string, onChange: (v: string) => void, placeholder: string) => (
    <select className="select" value={value} onChange={(e) => onChange(e.target.value)}>
      <option value="">{placeholder}</option>
      {catOptions.map((c) => (
        <option key={c.code} value={c.code}>
          {c.depth === 2 ? '　└ ' : ''}
          {c.name}
        </option>
      ))}
    </select>
  );

  return (
    <main className="page">
      <div className="page-head">
        <div className="titles">
          <h1>자동분류 키워드 관리</h1>
          <p>
            단어를 분류와 연결해 두면, <b>자동 분류</b> 실행 시 미분류 거래의 내용에
            그 단어가 <b>포함</b>된 건이 연결된 분류로 저장됩니다.
          </p>
        </div>
        <div className="actions">
          <button className="btn primary" onClick={runAuto} disabled={running}>
            {running ? '자동 분류 중…' : '지금 자동 분류 실행'}
          </button>
        </div>
      </div>

      {error && <div className="error-banner" style={{ marginBottom: 12 }}>{error}</div>}
      {runMsg && (
        <div className="callout" style={{ marginBottom: 12, fontSize: 13 }}>
          {runMsg}
        </div>
      )}

      {/* 추가 폼 */}
      <div className="card" style={{ marginBottom: 16, padding: 16 }}>
        <div
          style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}
        >
          <div className="field" style={{ flex: 2, minWidth: 200 }}>
            <label>키워드 (내용에 포함될 단어)</label>
            <input
              className="input"
              value={pattern}
              onChange={(e) => setPattern(e.target.value)}
              onKeyDown={(e) => e.key === 'Enter' && add()}
              placeholder="예: 스타벅스, 넷플릭스, 주유"
            />
          </div>
          <div className="field" style={{ flex: 2, minWidth: 200 }}>
            <label>연결할 분류</label>
            {catSelect(catCode, setCatCode, '분류 선택')}
          </div>
          <button className="btn" onClick={add} disabled={adding}>
            {adding ? '추가 중…' : '+ 키워드 추가'}
          </button>
        </div>
      </div>

      {/* 필터 */}
      <div
        className="card"
        style={{ marginBottom: 12, padding: 12, display: 'flex', gap: 10, flexWrap: 'wrap', alignItems: 'flex-end' }}
      >
        <div className="field" style={{ minWidth: 180 }}>
          <label>대분류 필터</label>
          <select className="select" value={filterCat} onChange={(e) => setFilterCat(e.target.value)}>
            <option value="">전체 분류</option>
            {topOptions.map((c) => (
              <option key={c.code} value={c.code}>{c.name}</option>
            ))}
          </select>
        </div>
        <div className="field" style={{ flex: 1, minWidth: 180 }}>
          <label>키워드 검색</label>
          <input
            className="input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="키워드 일부"
          />
        </div>
        <span className="tag" style={{ marginBottom: 6 }}>
          {filtered.length} / {rows.length}건
        </span>
      </div>

      {loading ? (
        <div className="card" style={{ padding: 20 }}>
          <div className="skeleton" style={{ height: 20 }} />
        </div>
      ) : filtered.length === 0 ? (
        <div className="empty">
          <h3>키워드가 없습니다</h3>
          <p>위에서 키워드를 추가해보세요.</p>
        </div>
      ) : (
        <div className="card pad-0">
          <div className="tbl-wrap">
          <table className="tbl">
            <thead>
              <tr>
                <th style={{ textAlign: 'left' }}>키워드</th>
                <th style={{ textAlign: 'left' }}>연결 분류</th>
                <th style={{ textAlign: 'left', width: 90 }}>매칭</th>
                <th style={{ width: 140 }}></th>
              </tr>
            </thead>
            <tbody>
              {filtered.map((k) => (
                <tr key={k.id}>
                  <td>
                    {editId === k.id ? (
                      <input
                        className="input"
                        value={editPattern}
                        onChange={(e) => setEditPattern(e.target.value)}
                        style={{ maxWidth: 220 }}
                      />
                    ) : (
                      <b>{k.pattern}</b>
                    )}
                  </td>
                  <td>
                    {editId === k.id ? (
                      catSelect(editCat, setEditCat, '분류 선택')
                    ) : (
                      <span>{k.categoryName}</span>
                    )}
                  </td>
                  <td>
                    <span className="pill plain">{matchLabel(k.matchType)}</span>
                  </td>
                  <td style={{ textAlign: 'right' }}>
                    {editId === k.id ? (
                      <>
                        <button className="btn sm" onClick={() => saveEdit(k.id)}>저장</button>{' '}
                        <button className="btn ghost sm" onClick={() => setEditId(null)}>취소</button>
                      </>
                    ) : (
                      <>
                        <button className="btn ghost sm" onClick={() => startEdit(k)}>수정</button>{' '}
                        <button
                          className="btn ghost sm"
                          style={{ color: 'var(--danger, #BE3B2A)' }}
                          onClick={() => del(k)}
                        >
                          삭제
                        </button>
                      </>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        </div>
      )}
    </main>
  );
}
