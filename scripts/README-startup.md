# 워크스페이스 부팅 시 서비스 자동 기동

이 컨테이너는 **PID 1 이 `coder agent`** 라서 systemd·cron 을 쓸 수 없다.
그래서 서비스(API :4000, 웹 :3000)는 **PM2** 로 관리하고, 워크스페이스가 뜰 때
`scripts/coder-startup.sh` 가 이를 기동한다.

## 지금 동작하는 것 (컨테이너 안, 이미 설정됨)

| 상황 | 복구 방식 |
|---|---|
| 프로세스가 죽음(크래시·OOM) | **PM2 가 자동 재시작** (`ecosystem.config.cjs`) |
| PM2 데몬까지 죽음 / 컨테이너 재시작 후 **셸을 열면** | `~/.bashrc` 훅이 `pm2 resurrect` |
| 컨테이너 재시작 후 **셸을 안 열어도** | ← **아래 템플릿 설정이 필요** |

## 남은 한 단계 — Coder 템플릿에 등록 (컨테이너 밖에서 작업)

워크스페이스를 한 번도 열지 않고 `https://ledger.so4.kr` 로만 접속해도 서비스가
떠 있게 하려면, Coder **템플릿**(`main.tf`)의 `coder_agent` 에 아래를 추가한다.
템플릿은 컨테이너 밖에 있으므로 Coder 웹 UI(Templates → 해당 템플릿 → Edit)나
`coder templates push` 로 수정해야 한다.

```hcl
resource "coder_agent" "main" {
  # ... 기존 설정 유지 ...

  startup_script_behavior = "non-blocking"   # 서비스 기동을 기다리지 않고 워크스페이스 오픈

  startup_script = <<-EOT
    #!/usr/bin/env bash
    # 가계부(ledger) 서비스 기동 — 스크립트가 없으면 조용히 건너뜀
    if [ -f /home/coder/ledger/scripts/coder-startup.sh ]; then
      bash /home/coder/ledger/scripts/coder-startup.sh
    fi
  EOT
}
```

이미 `startup_script` 가 있다면 **기존 내용 끝에 위 `if` 블록만** 이어 붙이면 된다.

> `startup_script_behavior`
> - `non-blocking` (권장): 서비스가 뜨는 동안 워크스페이스를 바로 쓸 수 있다.
> - `blocking`: 서비스가 다 뜬 뒤에 워크스페이스가 열린다. 첫 빌드가 필요한
>   경우 수 분 걸릴 수 있다.

## 스크립트가 하는 일

1. `pm2` 확인 (없으면 `~/.local` 에 설치)
2. **postgres:5432 최대 60초 대기** — DB 보다 API 가 먼저 뜨면 크래시 루프가 됨
3. 빌드 산출물(`apps/api/dist`, `apps/web/.next`) 없으면 **빌드**
4. `pm2 startOrRestart ecosystem.config.cjs` (**멱등** — 여러 번 실행해도 안전)
5. `pm2 save` 후 **헬스체크**(api/web) 결과를 로그에 기록

로그: `~/ledger/.pm2-logs/startup.log`

## 자주 쓰는 명령

```bash
pm2 status                 # 상태
pm2 logs ledger-api        # 로그
pm2 restart ledger-web     # 재시작
bash ~/ledger/scripts/coder-startup.sh   # 수동 기동(멱등)
```

**코드 수정 후에는 빌드가 필요하다** (스크립트는 산출물이 *없을 때만* 빌드한다):

```bash
cd ~/ledger/apps/api && pnpm build && pm2 restart ledger-api
cd ~/ledger/apps/web && pnpm build && pm2 restart ledger-web
```

## 참고: DB/Redis

`docker-compose.yml` 의 postgres·redis 는 **별도 컨테이너**라 워크스페이스와 별개로
살아있다. 만약 내려가 있으면 스크립트가 로그에 `WARN postgres 미도달` 을 남기므로,
그때는 호스트에서 `docker compose up -d` 를 실행한다.
