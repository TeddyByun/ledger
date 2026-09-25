#!/usr/bin/env python3
"""Host-managed encrypted Ledger snapshots. No SSH credentials are used or stored."""
import fcntl
import hashlib
import json
import os
from pathlib import Path
import re
import selectors
import signal
import shutil
import subprocess
import sys
import tempfile
import time
from datetime import datetime, timezone

CONFIG = Path(os.environ.get('LEDGER_BACKUP_CONFIG', '/etc/ledger-backup/config.json'))
NAME = re.compile(r'^ledger_\d{8}T\d{6}Z\.tar\.gpg$')
EXCLUDE = ['node_modules', '.next', 'dist', 'build', 'out', '.turbo', 'coverage',
           '.pm2-logs', '*.log', '*.tsbuildinfo']


def run(args, **kwargs):
    return subprocess.run([str(arg) for arg in args], check=True, **kwargs)


def output(args, **kwargs):
    return run(args, stdout=subprocess.PIPE, text=True, **kwargs).stdout.strip()


def sha256(path):
    digest = hashlib.sha256()
    with path.open('rb') as file:
        for chunk in iter(lambda: file.read(1024 * 1024), b''):
            digest.update(chunk)
    return digest.hexdigest()


def quote(name):
    return '"' + name.replace('"', '""') + '"'


def table_query(schema, table):
    return ("SELECT row_to_json(v)::text FROM (SELECT count(*)::text AS rows, "
            "md5(coalesce(string_agg(md5(row_to_json(t)::text), '' "
            "ORDER BY md5(row_to_json(t)::text)), '')) AS fingerprint "
            f"FROM {quote(schema)}.{quote(table)} t) v;")


class SnapshotSession:
    def __init__(self, command):
        self.process = subprocess.Popen(command, stdin=subprocess.PIPE, stdout=subprocess.PIPE,
                                        text=True, bufsize=1)
        self.selector = selectors.DefaultSelector()
        self.selector.register(self.process.stdout, selectors.EVENT_READ)

    def send(self, sql):
        self.process.stdin.write(sql + '\n')
        self.process.stdin.flush()

    def query(self, sql):
        self.send(sql)
        if not self.selector.select(timeout=90):
            raise RuntimeError('Timed out reading database snapshot')
        line = self.process.stdout.readline().strip()
        if not line:
            raise RuntimeError('Database snapshot query failed')
        return line

    def close(self):
        try:
            self.process.communicate(input='ROLLBACK;\n\\q\n', timeout=10)
        except (BrokenPipeError, subprocess.TimeoutExpired):
            self.process.kill()
            self.process.wait()
        finally:
            self.selector.close()


def main():
    os.umask(0o077)
    config = json.loads(CONFIG.read_text())
    repo = Path(config['repository'])
    root = Path(config['backup_directory'])
    root.mkdir(parents=True, exist_ok=True, mode=0o700)
    lock = (root / '.lock').open('a')
    try:
        fcntl.flock(lock, fcntl.LOCK_EX | fcntl.LOCK_NB)
    except BlockingIOError:
        raise RuntimeError('Another Ledger backup is already running')
    docker = ['docker', '--host', 'unix:///var/run/docker.sock']
    db_container = config['database_container']
    db_user = config['database_user']
    db_name = config['database_name']
    psql = ['psql', '-X', '-qAt', '--set=ON_ERROR_STOP=1', '-U', db_user, '-d', db_name]
    timestamp = datetime.now(timezone.utc).strftime('%Y%m%dT%H%M%SZ')
    filename = f'ledger_{timestamp}.tar.gpg'
    encrypted = root / filename
    partial = root / ('.' + filename + '.partial')
    key = Path(config['encryption_key_file'])
    if key.stat().st_mode & 0o077:
        raise RuntimeError('Encryption key must have owner-only permissions')
    remote = config['remote_directory'].rstrip('/')
    rclone = ['rclone', '--config', config['rclone_config'], '--contimeout', '15s',
              '--timeout', '60s', '--retries', '3', '--low-level-retries', '3',
              '--tpslimit', '2', '--checkers', '2', '--transfers', '1', '--retries-sleep', '20s']
    print(f'Starting encrypted snapshot {filename}', flush=True)
    verifier = None
    try:
        with tempfile.TemporaryDirectory(prefix='.stage-', dir=root) as temporary:
            stage = Path(temporary)
            session = SnapshotSession(docker + ['exec', '-i', db_container] + psql)
            try:
                session.send("BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY; SET LOCAL TIME ZONE 'UTC'; SET LOCAL DateStyle='ISO,YMD';")
                snapshot = session.query('SELECT pg_export_snapshot();')
                version = session.query('SELECT version();')
                tables = json.loads(session.query(
                    "SELECT coalesce(jsonb_agg(t), '[]'::jsonb)::text FROM (SELECT table_schema, table_name "
                    "FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema') "
                    "AND table_type='BASE TABLE' ORDER BY 1,2) t;"))
                for table in tables:
                    table.update(json.loads(session.query(table_query(table['table_schema'], table['table_name']))))
                with (stage / 'database.dump').open('wb') as dump:
                    run(docker + ['exec', db_container, 'pg_dump', '-U', db_user, '-d', db_name,
                                  '--format=custom', '--no-owner', '--no-privileges', '--snapshot=' + snapshot],
                        stdout=dump, timeout=300)
            finally:
                session.close()
            with (stage / 'database.dump').open('rb') as dump:
                run(docker + ['exec', '-i', db_container, 'pg_restore', '--list'],
                    stdin=dump, stdout=subprocess.DEVNULL, timeout=60)
            run(['tar', *['--exclude=' + entry for entry in EXCLUDE], '-czf',
                 stage / 'application.tar.gz', '-C', repo, '.'], timeout=300)
            run(['gzip', '--test', stage / 'application.tar.gz'])
            archive = set(output(['tar', '-tzf', stage / 'application.tar.gz']).splitlines())
            for required in ['./.env', './package.json', './pnpm-lock.yaml', './apps/api/prisma/schema.prisma']:
                if required not in archive:
                    raise RuntimeError('Missing recovery file: ' + required)
            runtime = stage / 'host-backup-configuration'
            runtime.mkdir(mode=0o700)
            for item in [Path('/usr/local/sbin/ledger-backup'),
                         Path('/etc/systemd/system/ledger-db-backup.service'),
                         Path('/etc/systemd/system/ledger-db-backup.timer'), CONFIG]:
                shutil.copyfile(item, runtime / item.name)
            # Restore into a disposable container with no network or exposed ports.
            # The live PostgreSQL server is only read by the snapshot above.
            image = output(docker + ['inspect', '--format', '{{.Config.Image}}', db_container])
            verifier = 'ledger-backup-verify-' + timestamp.lower()
            run(docker + ['run', '--detach', '--rm', '--name', verifier, '--network', 'none',
                          '--memory', '512m', '--cpus', '1', '--tmpfs', '/var/lib/postgresql:rw',
                          '--label', 'ledger.backup.verification=true', '-e', 'POSTGRES_USER=ledger_verify',
                          '-e', 'POSTGRES_DB=ledger_verify', '-e', 'POSTGRES_HOST_AUTH_METHOD=trust',
                          '--mount', f'type=bind,src={stage},dst=/backup,readonly', image],
                stdout=subprocess.DEVNULL, timeout=60)
            for attempt in range(90):
                ready = subprocess.run(docker + ['exec', verifier, 'pg_isready', '-h', '127.0.0.1', '-U', 'ledger_verify', '-d', 'ledger_verify'],
                                       stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=10)
                if ready.returncode == 0:
                    break
                time.sleep(1)
            else:
                raise RuntimeError('Isolated restore server did not become ready')
            run(docker + ['exec', verifier, 'pg_restore', '-U', 'ledger_verify', '-d', 'ledger_verify',
                          '--no-owner', '--no-privileges', '--exit-on-error', '--single-transaction', '/backup/database.dump'],
                timeout=300)
            for table in tables:
                result = json.loads(output(docker + ['exec', '-e', 'PGOPTIONS=-c timezone=UTC -c datestyle=ISO,YMD',
                    verifier, 'psql', '-X', '-qAt', '--set=ON_ERROR_STOP=1', '-U', 'ledger_verify', '-d', 'ledger_verify',
                    '-c', table_query(table['table_schema'], table['table_name'])], timeout=60))
                if any(result[field] != table[field] for field in ['rows', 'fingerprint']):
                    raise RuntimeError('Restore verification mismatch: ' + table['table_name'])
            run(docker + ['stop', '--time', '10', verifier], stdout=subprocess.DEVNULL, timeout=30)
            verifier = None
            git = ['git', '-c', f'safe.directory={repo}', '-C', repo]
            git_env = dict(os.environ, GIT_OPTIONAL_LOCKS='0')
            manifest = {'format': 2, 'timestamp': timestamp, 'databaseVersion': version,
                        'tables': tables, 'restoreVerification': 'passed: all row counts and content fingerprints match',
                        'gitHead': output(git + ['rev-parse', 'HEAD'], env=git_env),
                        'gitStatus': output(git + ['status', '--short'], env=git_env),
                        'sourceExclusions': EXCLUDE,
                        'artifacts': {name: sha256(stage / name) for name in ['database.dump', 'application.tar.gz']}}
            (stage / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n')
            payload = stage / 'snapshot.tar'
            run(['tar', '-cf', payload, '-C', stage, 'database.dump', 'application.tar.gz',
                 'manifest.json', 'host-backup-configuration'], timeout=300)
            gpg = ['gpg', '--batch', '--no-tty', '--pinentry-mode', 'loopback',
                   '--passphrase-file', key, '--no-symkey-cache']
            run(gpg + ['--symmetric', '--cipher-algo', 'AES256', '--output', partial, payload], timeout=300)
            run(gpg + ['--yes', '--decrypt', '--output', '/dev/null', partial],
                stdout=subprocess.DEVNULL, timeout=300)
            partial.rename(encrypted)
        checksum = root / (filename + '.sha256')
        checksum.write_text(sha256(encrypted) + '  ' + filename + '\n')
        run(['sha256sum', '--check', checksum.name], cwd=root)
        local_state = {'lastLocalSuccess': datetime.now(timezone.utc).isoformat(), 'snapshot': filename,
                       'bytes': encrypted.stat().st_size, 'tables': len(tables),
                       'rows': sum(int(table['rows']) for table in tables),
                       'restoreVerified': True, 'gitHead': manifest['gitHead']}
        local_status = root / '.local-status.json.partial'
        local_status.write_text(json.dumps(local_state, indent=2) + '\n')
        local_status.replace(root / 'local-status.json')
        print('Local encrypted backup and restore verified: ' + filename, flush=True)
        run(rclone + ['copyto', encrypted, remote + '/' + filename], timeout=300)
        run(rclone + ['copyto', checksum, remote + '/' + checksum.name], timeout=300)
        # Compare the actual encrypted bytes, not just the remote filename or size.
        run(rclone + ['check', root, remote, '--one-way', '--download',
                      '--include', '/' + filename, '--include', '/' + checksum.name], timeout=300)
        state = {'lastSuccess': datetime.now(timezone.utc).isoformat(), 'snapshot': filename,
                 'bytes': encrypted.stat().st_size, 'tables': len(tables),
                 'rows': sum(int(table['rows']) for table in tables),
                 'restoreVerified': True, 'remoteVerified': True, 'gitHead': manifest['gitHead']}
        # Only files generated by this job are eligible for retention, and only after success.
        keep_local = max(1, int(config.get('keep_local', 14)))
        keep_remote = max(1, int(config.get('keep_remote', 30)))
        local_files = sorted(path for path in root.iterdir() if NAME.fullmatch(path.name))
        for old in local_files[:-keep_local]:
            if old != encrypted:
                old.unlink()
                old.with_name(old.name + '.sha256').unlink(missing_ok=True)
        remote_files = sorted(name for name in output(rclone + ['lsf', remote, '--files-only'], timeout=90).splitlines()
                              if NAME.fullmatch(name))
        for old in remote_files[:-keep_remote]:
            if old != filename:
                run(rclone + ['deletefile', remote + '/' + old], timeout=90)
                run(rclone + ['deletefile', remote + '/' + old + '.sha256'], timeout=90)
        status_file = root / '.status.json.partial'
        status_file.write_text(json.dumps(state, indent=2) + '\n')
        status_file.replace(root / 'status.json')
        print(json.dumps(state), flush=True)
    finally:
        if verifier:
            subprocess.run(docker + ['rm', '--force', verifier], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL, timeout=30)
        partial.unlink(missing_ok=True)


if __name__ == '__main__':
    def terminate(signum, frame):
        raise RuntimeError('Backup interrupted by termination signal')
    signal.signal(signal.SIGTERM, terminate)
    try:
        main()
    except Exception as error:
        # No connection strings, environment values, SSH passwords or database rows are logged.
        print('Ledger backup FAILED: ' + str(error), file=sys.stderr, flush=True)
        sys.exit(1)
