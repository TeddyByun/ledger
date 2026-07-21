/**
 * PM2 프로세스 정의 — API(:4000) / 웹(:3000) 상시 실행 + 자동 재시작.
 *
 * 이 컨테이너는 PID 1 이 coder agent 라 systemd 를 쓸 수 없어 PM2 로 관리한다.
 *   실행:   pm2 start ecosystem.config.cjs && pm2 save
 *   상태:   pm2 status / pm2 logs ledger-api
 *   재시작: pm2 restart ledger-api ledger-web
 *   복구:   pm2 resurrect     (컨테이너 재시작 후. ~/.bashrc 훅이 자동 수행)
 *
 * 주의: 코드 변경 후에는 빌드가 필요하다.
 *   apps/api: pnpm build → pm2 restart ledger-api
 *   apps/web: pnpm build → pm2 restart ledger-web
 */
const ROOT = '/home/coder/ledger';

module.exports = {
  apps: [
    {
      name: 'ledger-api',
      cwd: `${ROOT}/apps/api`,
      script: 'dist/main.js',
      interpreter: 'node',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      restart_delay: 2000,
      max_restarts: 50,
      min_uptime: '10s',
      max_memory_restart: '600M',
      out_file: `${ROOT}/.pm2-logs/api.out.log`,
      error_file: `${ROOT}/.pm2-logs/api.err.log`,
      merge_logs: true,
      time: true,
    },
    {
      name: 'ledger-web',
      cwd: `${ROOT}/apps/web`,
      // 셸 래퍼 대신 next 진입점을 직접 실행해야 PM2 가 실제 node 프로세스를 관리한다.
      script: 'node_modules/next/dist/bin/next',
      args: 'start -p 3000',
      interpreter: 'node',
      env: { NODE_ENV: 'production' },
      autorestart: true,
      restart_delay: 2000,
      max_restarts: 50,
      min_uptime: '10s',
      max_memory_restart: '600M',
      out_file: `${ROOT}/.pm2-logs/web.out.log`,
      error_file: `${ROOT}/.pm2-logs/web.err.log`,
      merge_logs: true,
      time: true,
    },
  ],
};
