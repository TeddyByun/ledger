#!/usr/bin/env python3
"""Install on the Docker host as root; authentication stays outside this script."""
import argparse
import json
import os
from pathlib import Path
import secrets
import shutil
import subprocess

parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--app-container', required=True)
parser.add_argument('--database-container', default='postgresql')
parser.add_argument('--database-user', default='ledger')
parser.add_argument('--database-name', default='ledger')
args = parser.parse_args()
if os.geteuid() != 0:
    parser.error('Run with sudo on the Docker host')
os.umask(0o077)
for tool in ['docker', 'rclone', 'gpg', 'python3', 'tar', 'gzip', 'git', 'sha256sum', 'systemctl']:
    if not shutil.which(tool):
        parser.error('Required tool is missing: ' + tool)
docker = ['docker', '--host', 'unix:///var/run/docker.sock']
mounts = json.loads(subprocess.check_output(docker + ['inspect', '--format', '{{json .Mounts}}', args.app_container], text=True))
mount = next((entry for entry in mounts if entry['Destination'] == '/home/coder'), None)
if not mount:
    parser.error('The app container must have a persistent /home/coder mount')
home = Path(mount['Source'])
repo = home / 'ledger'
if not (repo / '.env').is_file():
    parser.error('Expected ledger/.env in the home volume')
settings = Path('/etc/ledger-backup')
settings.mkdir(mode=0o700, exist_ok=True)
settings.chmod(0o700)
(settings / 'gnupg').mkdir(mode=0o700, exist_ok=True)
backups = Path('/var/backups/ledger')
backups.mkdir(mode=0o700, exist_ok=True)
backups.chmod(0o700)
key = settings / 'recovery.key'
if not key.exists():
    with key.open('x') as file:
        file.write(secrets.token_urlsafe(48) + '\n')
key.chmod(0o600)
# A second private copy is outside the Git repository and every application archive.
recovery = home / '.config/ledger-backup'
recovery.mkdir(mode=0o700, exist_ok=True)
recovery.chmod(0o700)
owner = repo.stat()
os.chown(recovery, owner.st_uid, owner.st_gid)
recovery_key = recovery / 'recovery.key'
if recovery_key.exists() and recovery_key.read_bytes() != key.read_bytes():
    parser.error('Existing recovery key differs; refusing to replace it')
shutil.copyfile(key, recovery_key)
recovery_key.chmod(0o600)
os.chown(recovery_key, owner.st_uid, owner.st_gid)
rclone_config = settings / 'rclone.conf'
if not rclone_config.exists():
    shutil.copyfile(home / '.config/rclone/rclone.conf', rclone_config)
rclone_config.chmod(0o600)
config = {'repository': str(repo), 'backup_directory': str(backups),
          'database_container': args.database_container, 'database_user': args.database_user,
          'database_name': args.database_name, 'encryption_key_file': str(key),
          'rclone_config': str(rclone_config),
          'remote_directory': 'gdrive:My Dev/Ledger/secure-snapshots', 'keep_local': 14, 'keep_remote': 30}
(settings / 'config.json').write_text(json.dumps(config, indent=2) + '\n')
source = Path(__file__).resolve().parent
script = Path('/usr/local/sbin/ledger-backup')
shutil.copyfile(source / 'ledger-backup.py', script)
script.chmod(0o755)
for name in ['ledger-db-backup.service', 'ledger-db-backup.timer']:
    target = Path('/etc/systemd/system') / name
    shutil.copyfile(source / name, target)
    target.chmod(0o644)
subprocess.run(['systemd-analyze', 'verify', '/etc/systemd/system/ledger-db-backup.service',
                '/etc/systemd/system/ledger-db-backup.timer'], check=True)
subprocess.run(['systemctl', 'daemon-reload'], check=True)
# Enable after the first successful manual backup; an installation alone is not a verification.
print('Installed. Run systemctl start ledger-db-backup.service; after success, enable --now ledger-db-backup.timer.')
print('Recovery key stored separately with owner-only access; no SSH password was saved.')
