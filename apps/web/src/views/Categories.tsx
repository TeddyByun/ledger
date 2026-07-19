'use client';

import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '@/lib/api';
import type { Category } from '@/lib/types';

type Mode = 'none' | 'view' | 'edit' | 'create';
type TxType = 'income' | 'expense';

interface CatForm {
  code?: string;
  name: string;
  type: TxType;
  parentCode?: string; // 있으면 소분류
}

const TYPE_LABEL: Record<TxType, string> = { expense: '지출', income: '수입' };
/** 공통(집계제외) 분류명 — 수입/지출과 별도 섹션으로 분리 표시 */
const COMMON_NAME = '집계제외';

export function Categories() {
  const [cats, setCats] = useState<Category[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [mode, setMode] = useState<Mode>('none');
  const [selectedCode, setSelectedCode] = useState<string | null>(null);
  const [form, setForm] = useState<CatForm>({ name: '', type: 'expense' });
  const [busy, setBusy] = useState(false);
  // 접힌 대분류 코드 집합 (기본: 모두 펼침)
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());

  const toggle = (code: string) =>
    setCollapsed((s) => {
      const n = new Set(s);
      if (n.has(code)) n.delete(code);
      else n.add(code);
      return n;
    });
  const expand = (code: string) =>
    setCollapsed((s) => {
      if (!s.has(code)) return s;
      const n = new Set(s);
      n.delete(code);
      return n;
    });
  const expandAll = () => setCollapsed(new Set());

  const selected = cats.find((c) => c.code === selectedCode) ?? null;
  const editing = mode === 'edit' || mode === 'create';

  const load = async () => {
    const rows = await api.get<Category[]>('/categories');
    setCats(rows);
  };

  useEffect(() => {
    load()
      .catch((e) => setError((e as Error).message))
      .finally(() => setLoading(false));
  }, []);

  // 유형별 대분류(=roots) → 소분류(children) 트리
  const tree = useMemo(() => {
    const roots = cats.filter((c) => !c.parentCode);
    const childrenOf = (code: string) =>
      cats
        .filter((c) => c.parentCode === code)
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0));
    const isCommon = (r: Category) => r.name === COMMON_NAME;
    const byType = (t: TxType) =>
      roots
        .filter((r) => r.type === t && !isCommon(r))
        .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
        .map((r) => ({ root: r, children: childrenOf(r.code) }));
    const common = roots
      .filter(isCommon)
      .sort((a, b) => (a.sortOrder ?? 0) - (b.sortOrder ?? 0))
      .map((r) => ({ root: r, children: childrenOf(r.code) }));
    return { expense: byType('expense'), income: byType('income'), common };
  }, [cats]);

  const parentName = (code: string | null | undefined) =>
    code ? cats.find((c) => c.code === code)?.name ?? code : null;
  const childCount = (code: string) => cats.filter((c) => c.parentCode === code).length;
  // 공통(집계제외) 분류 여부 — 대분류 또는 그 하위
  const commonRootCodes = cats.filter((c) => c.name === COMMON_NAME).map((c) => c.code);
  const isCommonCat = (c: Category) =>
    c.name === COMMON_NAME || (!!c.parentCode && commonRootCodes.includes(c.parentCode));

  const parentsWithKids = [...tree.expense, ...tree.income]
    .filter((x) => x.children.length > 0)
    .map((x) => x.root.code);
  const collapseAll = () => setCollapsed(new Set(parentsWithKids));
  const allCollapsed = parentsWithKids.length > 0 && parentsWithKids.every((c) => collapsed.has(c));

  const viewCat = (c: Category) => {
    setError(null);
    setSelectedCode(c.code);
    setMode('view');
  };

  const startEdit = () => {
    if (!selected) return;
    setForm({
      code: selected.code,
      name: selected.name,
      type: selected.type,
      parentCode: selected.parentCode ?? undefined,
    });
    setMode('edit');
  };

  const startCreateTop = (type: TxType) => {
    setError(null);
    setSelectedCode(null);
    setForm({ name: '', type });
    setMode('create');
  };

  const startCreateSub = (parent: Category) => {
    setError(null);
    setSelectedCode(null);
    expand(parent.code);
    setForm({ name: '', type: parent.type, parentCode: parent.code });
    setMode('create');
  };

  const cancel = () => {
    setError(null);
    setMode(selected ? 'view' : 'none');
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      if (mode === 'edit' && form.code) {
        await api.patch(`/categories/${form.code}`, { name: form.name });
        await load();
        setSelectedCode(form.code);
      } else {
        const created = await api.post<Category>('/categories', {
          name: form.name,
          type: form.parentCode ? undefined : form.type,
          parentCode: form.parentCode,
        });
        await load();
        setSelectedCode(created?.code ?? null);
      }
      setMode('view');
    } catch (err) {
      setError(
        err instanceof ApiError ? err.message : (err as Error).message,
      );
    } finally {
      setBusy(false);
    }
  };

  const remove = async (c: Category) => {
    const msg =
      childCount(c.code) > 0
        ? `'${c.name}'에는 하위 분류가 있어 삭제할 수 없습니다. 하위 분류를 먼저 삭제하세요.`
        : `'${c.name}' 분류를 삭제할까요?\n(거래에 사용된 분류는 이력 보존을 위해 목록에서만 숨겨집니다.)`;
    if (childCount(c.code) > 0) {
      alert(msg);
      return;
    }
    if (!confirm(msg)) return;
    setError(null);
    try {
      await api.del(`/categories/${c.code}`);
      await load();
      if (selectedCode === c.code) {
        setSelectedCode(null);
        setMode('none');
      }
    } catch (err) {
      setError((err as Error).message);
    }
  };

  return (
    <>
      <header className="topbar">
        <span className="crumb">
          관리 / <b>분류 관리</b>
        </span>
      </header>
      <main className="page">
        <div className="page-head">
          <div className="titles">
            <h1>분류 관리</h1>
            <p>수입·지출 분류 체계를 추가·수정·삭제합니다. 대분류 아래에 소분류를 둘 수 있습니다.</p>
          </div>
        </div>

        {error && <div className="error-banner">{error}</div>}

        <div className="grid cols-2">
          {/* 좌측: 분류 트리 */}
          <div className="card pad-0" style={{ alignSelf: 'start' }}>
            {loading ? (
              <div style={{ padding: 20, display: 'grid', gap: 10 }}>
                <div className="skeleton" style={{ height: 20 }} />
                <div className="skeleton" style={{ height: 20 }} />
              </div>
            ) : (
              <div style={{ padding: '8px 12px 12px' }}>
                <div
                  style={{
                    display: 'flex',
                    justifyContent: 'flex-end',
                    gap: 6,
                    padding: '4px 4px 2px',
                    borderBottom: '1px solid var(--line)',
                    marginBottom: 4,
                  }}
                >
                  <button
                    className="btn ghost sm"
                    onClick={expandAll}
                    disabled={parentsWithKids.length === 0 || collapsed.size === 0}
                  >
                    전체 펼치기
                  </button>
                  <button
                    className="btn ghost sm"
                    onClick={collapseAll}
                    disabled={allCollapsed}
                  >
                    전체 접기
                  </button>
                </div>
                {[
                  {
                    key: 'expense',
                    label: '지출 분류',
                    color: 'var(--expense)',
                    groups: tree.expense,
                    addType: 'expense' as TxType | undefined,
                  },
                  {
                    key: 'income',
                    label: '수입 분류',
                    color: 'var(--income)',
                    groups: tree.income,
                    addType: 'income' as TxType | undefined,
                  },
                  ...(tree.common.length > 0
                    ? [
                        {
                          key: 'common',
                          label: '공통 분류',
                          color: 'var(--brand-ink)',
                          groups: tree.common,
                          addType: undefined as TxType | undefined,
                        },
                      ]
                    : []),
                ].map((sec) => (
                  <div key={sec.key} style={{ marginBottom: 10 }}>
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        padding: '10px 8px 6px',
                      }}
                    >
                      <b style={{ fontSize: 13, color: sec.color }}>{sec.label}</b>
                      {sec.addType && (
                        <button className="btn ghost sm" onClick={() => startCreateTop(sec.addType!)}>
                          + 대분류
                        </button>
                      )}
                    </div>
                    {sec.groups.length === 0 ? (
                      <div className="muted" style={{ fontSize: 12, padding: '4px 8px 8px' }}>
                        분류가 없습니다.
                      </div>
                    ) : (
                      sec.groups.map(({ root, children }) => {
                        const hasKids = children.length > 0;
                        const open = hasKids && !collapsed.has(root.code);
                        return (
                          <div key={root.code}>
                            <TreeRow
                              active={selectedCode === root.code}
                              onClick={() => viewCat(root)}
                              caret={
                                hasKids ? (
                                  <button
                                    className="tree-caret"
                                    aria-label={open ? '접기' : '펼치기'}
                                    onClick={(e) => {
                                      e.stopPropagation();
                                      toggle(root.code);
                                    }}
                                  >
                                    {open ? '▾' : '▸'}
                                  </button>
                                ) : (
                                  <span className="tree-caret" aria-hidden="true" />
                                )
                              }
                              label={<b style={{ fontSize: 13.5 }}>{root.name}</b>}
                              right={`${root.code}${hasKids ? ` · ${children.length}` : ''}`}
                              action={
                                <button
                                  className="btn ghost sm"
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    startCreateSub(root);
                                  }}
                                  title="소분류 추가"
                                >
                                  +
                                </button>
                              }
                            />
                            {open &&
                              children.map((ch) => (
                                <TreeRow
                                  key={ch.code}
                                  indent
                                  active={selectedCode === ch.code}
                                  onClick={() => viewCat(ch)}
                                  caret={<span className="tree-caret" aria-hidden="true" />}
                                  label={<span style={{ fontSize: 13 }}>{ch.name}</span>}
                                  right={ch.code}
                                />
                              ))}
                          </div>
                        );
                      })
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>

          {/* 우측: 분류 정보 / 수정 / 추가 */}
          <div className="card" style={{ alignSelf: 'start' }}>
            <div className="card-head">
              <h3>
                {mode === 'create'
                  ? form.parentCode
                    ? '새 소분류'
                    : '새 대분류'
                  : mode === 'edit'
                    ? '분류 수정'
                    : '분류 정보'}
              </h3>
              {mode === 'view' && selected && (
                <div className="r" style={{ display: 'flex', gap: 6 }}>
                  <button className="btn ghost sm" onClick={startEdit}>
                    수정
                  </button>
                  <button
                    className="btn ghost sm"
                    style={{ color: 'var(--expense)' }}
                    onClick={() => remove(selected)}
                  >
                    삭제
                  </button>
                </div>
              )}
            </div>

            {mode === 'view' && selected ? (
              <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                <div style={{ fontSize: 18, fontWeight: 700 }}>{selected.name}</div>
                <Info
                  label="유형"
                  value={isCommonCat(selected) ? '공통' : TYPE_LABEL[selected.type]}
                />
                <Info label="구분" value={selected.parentCode ? '소분류' : '대분류'} />
                {selected.parentCode && (
                  <Info label="상위 분류" value={parentName(selected.parentCode) ?? '—'} />
                )}
                <Info label="코드" value={selected.code} mono />
                {!selected.parentCode && (
                  <Info label="소분류 수" value={`${childCount(selected.code)}개`} />
                )}
              </div>
            ) : editing ? (
              <form onSubmit={submit} style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
                {mode === 'create' && (
                  <div className="field">
                    <label>유형 · 구분</label>
                    <div style={{ fontSize: 14, padding: '2px 0' }}>
                      {TYPE_LABEL[form.type]} ·{' '}
                      {form.parentCode
                        ? `소분류 (상위: ${parentName(form.parentCode)})`
                        : '대분류'}
                    </div>
                  </div>
                )}
                {mode === 'edit' && selected && (
                  <div className="field">
                    <label>유형 · 구분</label>
                    <div style={{ fontSize: 14, padding: '2px 0' }}>
                      {isCommonCat(selected) ? '공통' : TYPE_LABEL[selected.type]} ·{' '}
                      {selected.parentCode ? '소분류' : '대분류'}
                    </div>
                  </div>
                )}
                <div className="field">
                  <label>분류 이름</label>
                  <input
                    className="input"
                    value={form.name}
                    onChange={(e) => setForm({ ...form, name: e.target.value })}
                    placeholder={form.parentCode ? '예: 외식, 카페·간식' : '예: 공과금·주거, 여가'}
                    autoFocus
                    required
                  />
                </div>
                <div style={{ display: 'flex', gap: 8 }}>
                  <button
                    className="btn primary"
                    type="submit"
                    disabled={busy}
                    style={{ flex: 1, justifyContent: 'center', padding: 11 }}
                  >
                    {busy ? '저장 중…' : mode === 'edit' ? '수정 저장' : '추가'}
                  </button>
                  <button
                    className="btn ghost"
                    type="button"
                    onClick={cancel}
                    disabled={busy}
                    style={{ flex: 'none' }}
                  >
                    취소
                  </button>
                </div>
              </form>
            ) : (
              <div className="empty">
                <h3>분류를 선택하세요</h3>
                <p>왼쪽에서 분류를 클릭하면 정보가 표시됩니다. “+ 대분류 / +”로 추가할 수 있어요.</p>
              </div>
            )}
          </div>
        </div>
      </main>
    </>
  );
}

function TreeRow({
  caret,
  label,
  right,
  action,
  active,
  indent,
  onClick,
}: {
  caret?: React.ReactNode;
  label: React.ReactNode;
  right?: string;
  action?: React.ReactNode;
  active?: boolean;
  indent?: boolean;
  onClick: () => void;
}) {
  return (
    <div
      onClick={onClick}
      className={`tree-row${active ? ' active' : ''}`}
      style={{
        display: 'flex',
        alignItems: 'center',
        gap: 6,
        padding: '5px 8px',
        paddingLeft: indent ? 30 : 8,
        borderRadius: 8,
        cursor: 'pointer',
      }}
    >
      {caret}
      <span
        style={{
          flex: '0 1 auto',
          minWidth: 0,
          whiteSpace: 'nowrap',
          overflow: 'hidden',
          textOverflow: 'ellipsis',
        }}
      >
        {label}
      </span>
      {right && (
        <span className="muted mono" style={{ fontSize: 11, flex: 'none' }}>
          {right}
        </span>
      )}
      <span style={{ flex: 1 }} />
      {action}
    </div>
  );
}

function Info({ label, value, mono }: { label: string; value: string; mono?: boolean }) {
  return (
    <div className="field">
      <label>{label}</label>
      <div className={mono ? 'mono' : undefined} style={{ fontSize: 14, padding: '2px 0' }}>
        {value}
      </div>
    </div>
  );
}
