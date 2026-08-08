/**
 * SKILL_DB_Design.md 규칙 자동 검증 (설계서 DATABASE_V2_DESIGN.md §4.3 메타 테스트).
 *
 * v2 스키마가 규칙을 지키는지 CI 가 감시한다. 특히 **§5.2 (마스터는 다른 마스터를
 * 가리키는 컬럼을 두지 않는다)** 는 사람이 리뷰로 잡기 어렵고, 어기면 테넌트
 * 스코핑 구조가 조용히 무너진다(감사 #2·#4 와 같은 계열).
 *
 * `@prisma/internals`(getDMMF) 가 설치돼 있지 않으므로 스키마 파일을 직접 파싱한다.
 * 구조 규칙만 보므로 이 수준의 파싱으로 충분하다.
 */
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_PATH = resolve(HERE, '../../../prisma/schema.v2.prisma');

type Model = {
  name: string;
  table: string;
  suffix: string;
  body: string;
  /** `*Id` 스칼라 필드 전체 (컬럼명 기준) */
  refColumns: string[];
  /** `@relation(fields: [x])` 로 선언된 스칼라 → 대상 모델명. 자기참조도 정확히 잡힌다. */
  relationTargets: Map<string, string>;
};

function parseModels(schema: string): Model[] {
  const models: Model[] = [];
  const re = /^model\s+(\w+)\s*\{([\s\S]*?)^\}/gm;
  let m: RegExpExecArray | null;

  while ((m = re.exec(schema)) !== null) {
    const [, name, body] = m as unknown as [string, string, string];
    const table = body.match(/@@map\("([a-z0-9_]+)"\)/)?.[1] ?? '';
    const suffix = table.slice(table.lastIndexOf('_') + 1);
    const lines = body.split('\n').filter((l) => !l.trim().startsWith('//'));

    const refColumns = lines
      .filter((l) => !l.includes('@relation'))
      .map((l) => l.trim().match(/^(\w+Id)\s+String/)?.[1])
      .filter((x): x is string => Boolean(x));

    // 예: `parent   CategoryMt @relation(fields: [parentId], references: [id])`
    const relationTargets = new Map<string, string>();
    for (const line of lines) {
      const rel = line
        .trim()
        .match(/^\w+\s+(\w+)\??\s+.*@relation\((?:"[^"]*",\s*)?fields:\s*\[(\w+)\]/);
      if (rel) relationTargets.set(rel[2]!, rel[1]!);
    }

    models.push({ name, table, suffix, body, refColumns, relationTargets });
  }
  return models;
}

const schema = readFileSync(SCHEMA_PATH, 'utf-8');
const models = parseModels(schema);
const byName = new Map(models.map((x) => [x.name, x]));

/**
 * 스칼라 컬럼이 가리키는 모델을 찾는다.
 * ① `@relation` 선언이 있으면 그 대상(자기참조 포함 정확)
 * ② 없으면 이름으로 추정 — 코드(_ct) 참조는 의도적으로 relation 을 걸지 않았다
 */
function resolveTarget(model: Model, refColumn: string): Model | undefined {
  const declared = model.relationTargets.get(refColumn);
  if (declared) return byName.get(declared);

  const base = refColumn.replace(/Id$/, '');
  const pascal = base.charAt(0).toUpperCase() + base.slice(1);
  return (
    byName.get(`${pascal}Mt`) ?? byName.get(`${pascal}Ct`) ?? byName.get(`${pascal}Tt`)
  );
}

/** 모델이 참조하는 대상 목록 (스칼라 + relation 선언 양쪽) */
function targetsOf(model: Model): Model[] {
  const columns = new Set([...model.refColumns, ...model.relationTargets.keys()]);
  return [...columns]
    .map((c) => resolveTarget(model, c))
    .filter((t): t is Model => Boolean(t));
}

describe('DB 설계 규칙 — 스키마 파싱', () => {
  it('모델을 읽었다', () => {
    expect(models.length).toBeGreaterThan(30);
    expect(models.every((x) => x.table !== '')).toBe(true);
  });
});

describe('§2 명명 — 모든 테이블은 _mt/_ct/_tt/_rt 로 끝난다', () => {
  it.each(models.map((x) => [x.table, x.suffix] as const))('%s', (_table, suffix) => {
    expect(['mt', 'ct', 'tt', 'rt']).toContain(suffix);
  });

  it('분류별 개수 (설계서 §1)', () => {
    const count = (s: string) => models.filter((x) => x.suffix === s).length;
    expect({ mt: count('mt'), ct: count('ct'), rt: count('rt'), tt: count('tt') }).toEqual({
      mt: 8,
      ct: 5,
      rt: 10,
      tt: 12,
    });
  });
});

describe('§5.2 마스터는 **다른** 마스터를 가리키는 컬럼을 두지 않는다', () => {
  const masters = models.filter((x) => x.suffix === 'mt');

  it.each(masters.map((x) => [x.table, x] as const))('%s', (_table, model) => {
    const columns = new Set([...model.refColumns, ...model.relationTargets.keys()]);
    const violations = [...columns]
      .map((col) => ({ col, target: resolveTarget(model, col) }))
      // 인라인 허용 예외 ⓐ 코드(_ct) 참조 — suffix 'mt' 가 아니라 자동 제외
      // 인라인 허용 예외 ⓑ 같은 테이블 자기참조 계층 (SKILL §5.4)
      .filter((x) => x.target?.suffix === 'mt' && x.target.name !== model.name)
      .map((x) => `${x.col} → ${x.target!.table}`);

    expect(violations).toEqual([]);
  });

  it('자기참조 계층은 _rt 가 아니라 인라인 parent_id 로 둔다 (SKILL §5.4 예외 B)', () => {
    // category_mt 는 트리 마스터다 — 인라인이어야 하고, 관계 테이블이 있으면 안 된다.
    const category = byName.get('CategoryMt')!;
    expect(category.relationTargets.get('parentId')).toBe('CategoryMt');
    expect(models.find((x) => x.table === 'category_parent_rt')).toBeUndefined();
  });

  it('household_id 는 어떤 마스터에도 없다 (결정 V1 엄격 적용)', () => {
    const offenders = masters
      .filter((x) => /household_id/.test(x.body))
      .map((x) => x.table);
    expect(offenders).toEqual([]);
  });
});

describe('§8.1 업무 테이블은 household_id 를 인라인으로 갖는다', () => {
  // 계정/토큰계는 가구에 속하지 않는다 — 자동 스코핑 대상이 아님.
  const NOT_TENANT_SCOPED = ['refresh_token_tt', 'password_reset_token_tt'];
  const scoped = models.filter(
    (x) => x.suffix === 'tt' && !NOT_TENANT_SCOPED.includes(x.table),
  );

  it.each(scoped.map((x) => [x.table, x] as const))('%s', (_table, model) => {
    expect(model.body).toMatch(/householdId\s+String\s+@map\("household_id"\)/);
  });
});

describe('§4 공통 표준 컬럼', () => {
  it.each(models.map((x) => [x.table, x] as const))('%s — id/created_at/updated_at', (
    _table,
    model,
  ) => {
    expect(model.body).toMatch(/id\s+String\s+@id/);
    expect(model.body).toMatch(/@map\("created_at"\)/);
    // append-only 는 updated_at 생략 가능(§4 예외)
    const APPEND_ONLY = ['refresh_token_tt', 'password_reset_token_tt'];
    if (!APPEND_ONLY.includes(model.table)) {
      expect(model.body).toMatch(/@map\("updated_at"\)/);
    }
  });

  /** 소프트삭제 예외 — append-only(§4) + 재생성 대상 집계(설계서 §1.5) */
  const NO_SOFT_DELETE = [
    'refresh_token_tt',
    'password_reset_token_tt',
    'monthly_summary_tt',
    'monthly_category_stat_tt',
    'monthly_source_stat_tt',
    'monthly_payment_stat_tt',
  ];
  const softDeletable = models.filter(
    (x) => x.suffix === 'tt' && !NO_SOFT_DELETE.includes(x.table),
  );

  it.each(softDeletable.map((x) => [x.table, x] as const))(
    '%s — is_deleted/deleted_at',
    (_table, model) => {
      expect(model.body).toMatch(/@map\("is_deleted"\)/);
      expect(model.body).toMatch(/@map\("deleted_at"\)/);
    },
  );

  it.each(
    models.filter((x) => x.suffix === 'mt' || x.suffix === 'ct').map((x) => [x.table, x] as const),
  )('%s — is_active (물리 삭제 대신)', (_table, model) => {
    expect(model.body).toMatch(/@map\("is_active"\)/);
  });
});

describe('§6 코드 테이블', () => {
  const codes = models.filter((x) => x.suffix === 'ct');

  it("이름에 'code' 를 중복해 넣지 않는다", () => {
    expect(codes.filter((x) => x.table.includes('code'))).toEqual([]);
  });

  it.each(codes.map((x) => [x.table, x] as const))(
    '%s — code_group + UNIQUE(code_group, code)',
    (_table, model) => {
      expect(model.body).toMatch(/@map\("code_group"\)/);
      expect(model.body).toMatch(/@@unique\(\[codeGroup,\s*code\]\)/);
    },
  );
});

describe('§3 물리 FK 없음', () => {
  it('relationMode = "prisma"', () => {
    expect(schema).toMatch(/relationMode\s*=\s*"prisma"/);
  });
});

describe('§7 _rt 는 서로 다른 두 마스터를 잇는다', () => {
  const rts = models.filter((x) => x.suffix === 'rt');

  it.each(rts.map((x) => [x.table, x] as const))(
    '%s — 서로 다른 마스터 2개',
    (_table, model) => {
      // 코드 참조(householdRoleId 등)를 뺀 마스터 참조가 정확히 2개이고,
      // 둘이 서로 달라야 한다 — 자기참조 _rt 는 만들지 않는다(SKILL §7.3).
      const masterRefs = targetsOf(model).filter((t) => t.suffix === 'mt');
      expect(masterRefs.length).toBe(2);
      expect(new Set(masterRefs.map((t) => t.name)).size).toBe(2);
    },
  );
});
