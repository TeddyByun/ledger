#!/usr/bin/env python3
"""PostgreSQL 연결 테스트 프로그램 (의존성 없음, 표준 라이브러리만 사용).

.env 의 DATABASE_URL 또는 DB_* 값을 읽어 PostgreSQL 서버에 실제로 접속하고,
인증(SCRAM-SHA-256 / MD5 / cleartext)까지 마친 뒤 `SELECT version()` 을 실행해
연결이 정상인지 확인합니다.

사용법:
    python3 scripts/db_conn_test.py                # 프로젝트 .env 사용
    python3 scripts/db_conn_test.py --env .env.dev # 다른 env 파일 지정
    DATABASE_URL=postgresql://... python3 scripts/db_conn_test.py
"""
from __future__ import annotations

import argparse
import base64
import hashlib
import hmac
import os
import socket
import ssl
import struct
import sys
import time
from urllib.parse import unquote, urlparse

PROTOCOL_VERSION = 196608  # 3.0


# --------------------------------------------------------------------------- #
# 설정 로딩
# --------------------------------------------------------------------------- #
def load_env_file(path: str) -> dict[str, str]:
    env: dict[str, str] = {}
    if not os.path.exists(path):
        return env
    with open(path, encoding="utf-8") as fh:
        for raw in fh:
            line = raw.strip()
            if not line or line.startswith("#") or "=" not in line:
                continue
            key, _, val = line.partition("=")
            env[key.strip()] = val.strip().strip('"').strip("'")
    return env


def resolve_config(env_path: str) -> dict[str, object]:
    file_env = load_env_file(env_path)

    def get(key: str, default: str | None = None) -> str | None:
        return os.environ.get(key) or file_env.get(key) or default

    url = get("DATABASE_URL")
    if url:
        p = urlparse(url)
        return {
            "host": p.hostname or "localhost",
            "port": p.port or 5432,
            "user": unquote(p.username) if p.username else "postgres",
            "password": unquote(p.password) if p.password else "",
            "dbname": (p.path or "/postgres").lstrip("/") or "postgres",
            "source": f"DATABASE_URL ({env_path})",
        }
    return {
        "host": get("DB_HOST", "localhost"),
        "port": int(get("DB_PORT", "5432")),
        "user": get("DB_USER", "postgres"),
        "password": get("DB_PASSWORD", ""),
        "dbname": get("DB_NAME", "postgres"),
        "source": f"DB_* 변수 ({env_path})",
    }


# --------------------------------------------------------------------------- #
# 메시지 입출력
# --------------------------------------------------------------------------- #
class Conn:
    def __init__(self, sock: socket.socket):
        self.sock = sock
        self.buf = b""

    def _recv(self, n: int) -> bytes:
        while len(self.buf) < n:
            chunk = self.sock.recv(65536)
            if not chunk:
                raise ConnectionError("서버가 연결을 닫았습니다 (EOF)")
            self.buf += chunk
        out, self.buf = self.buf[:n], self.buf[n:]
        return out

    def read_message(self) -> tuple[str, bytes]:
        """타입 바이트가 있는 일반 메시지 하나를 읽어 (type, payload) 반환."""
        tag = self._recv(1).decode("latin1")
        (length,) = struct.unpack("!I", self._recv(4))
        payload = self._recv(length - 4) if length > 4 else b""
        return tag, payload

    def send(self, tag: bytes, payload: bytes) -> None:
        body = struct.pack("!I", len(payload) + 4) + payload
        self.sock.sendall((tag + body) if tag else body)


def parse_error(payload: bytes) -> str:
    fields, cur = {}, b""
    parts = payload.split(b"\x00")
    for part in parts:
        if part:
            fields[chr(part[0])] = part[1:].decode("utf-8", "replace")
    sev = fields.get("S", "ERROR")
    code = fields.get("C", "")
    msg = fields.get("M", "")
    detail = fields.get("D", "")
    text = f"{sev} [{code}] {msg}"
    return text + (f" — {detail}" if detail else "")


# --------------------------------------------------------------------------- #
# SCRAM-SHA-256
# --------------------------------------------------------------------------- #
def scram_auth(conn: Conn, password: str, mechanisms: list[str]) -> None:
    if "SCRAM-SHA-256" not in mechanisms:
        raise RuntimeError(f"지원하지 않는 SASL 메커니즘: {mechanisms}")

    client_nonce = base64.b64encode(os.urandom(18)).decode("ascii")
    client_first_bare = f"n=,r={client_nonce}"
    client_first = "n,," + client_first_bare
    # SASLInitialResponse: 메커니즘명 + Int32 길이 + 메시지
    payload = (
        b"SCRAM-SHA-256\x00"
        + struct.pack("!I", len(client_first))
        + client_first.encode("utf-8")
    )
    conn.send(b"p", payload)

    tag, data = conn.read_message()
    if tag == "E":
        raise RuntimeError(parse_error(data))
    if tag != "R":
        raise RuntimeError(f"예상치 못한 응답: {tag!r}")
    (code,) = struct.unpack("!I", data[:4])
    if code != 11:  # SASLContinue
        raise RuntimeError(f"SASLContinue 를 기대했으나 code={code}")
    server_first = data[4:].decode("utf-8")
    attrs = dict(kv.split("=", 1) for kv in server_first.split(","))
    server_nonce = attrs["r"]
    salt = base64.b64decode(attrs["s"])
    iterations = int(attrs["i"])
    if not server_nonce.startswith(client_nonce):
        raise RuntimeError("서버 nonce 검증 실패")

    salted = hashlib.pbkdf2_hmac("sha256", password.encode("utf-8"), salt, iterations)
    client_key = hmac.new(salted, b"Client Key", hashlib.sha256).digest()
    stored_key = hashlib.sha256(client_key).digest()
    final_no_proof = f"c=biws,r={server_nonce}"
    auth_message = f"{client_first_bare},{server_first},{final_no_proof}"
    client_sig = hmac.new(stored_key, auth_message.encode("utf-8"), hashlib.sha256).digest()
    proof = bytes(a ^ b for a, b in zip(client_key, client_sig))
    client_final = final_no_proof + ",p=" + base64.b64encode(proof).decode("ascii")
    conn.send(b"p", client_final.encode("utf-8"))

    tag, data = conn.read_message()
    if tag == "E":
        raise RuntimeError(parse_error(data))
    (code,) = struct.unpack("!I", data[:4])
    if code != 12:  # SASLFinal
        raise RuntimeError(f"SASLFinal 을 기대했으나 code={code}")
    # 서버 서명 검증
    server_key = hmac.new(salted, b"Server Key", hashlib.sha256).digest()
    expected = hmac.new(server_key, auth_message.encode("utf-8"), hashlib.sha256).digest()
    server_final = data[4:].decode("utf-8")
    server_sig = base64.b64decode(dict(kv.split("=", 1) for kv in server_final.split(","))["v"])
    if not hmac.compare_digest(expected, server_sig):
        raise RuntimeError("서버 서명 검증 실패 (중간자 공격 가능성)")


def md5_auth(conn: Conn, user: str, password: str, salt: bytes) -> None:
    inner = hashlib.md5((password + user).encode("utf-8")).hexdigest()
    token = "md5" + hashlib.md5(inner.encode("ascii") + salt).hexdigest()
    conn.send(b"p", token.encode("ascii") + b"\x00")


# --------------------------------------------------------------------------- #
# 인증 흐름
# --------------------------------------------------------------------------- #
def authenticate(conn: Conn, cfg: dict) -> None:
    startup = struct.pack("!I", PROTOCOL_VERSION)
    for k, v in (("user", cfg["user"]), ("database", cfg["dbname"]),
                 ("application_name", "db_conn_test")):
        startup += k.encode("utf-8") + b"\x00" + str(v).encode("utf-8") + b"\x00"
    startup += b"\x00"
    conn.send(b"", startup)

    while True:
        tag, data = conn.read_message()
        if tag == "E":
            raise RuntimeError(parse_error(data))
        if tag != "R":
            raise RuntimeError(f"인증 중 예상치 못한 메시지: {tag!r}")
        (code,) = struct.unpack("!I", data[:4])
        if code == 0:              # AuthenticationOk
            return
        if code == 3:              # cleartext
            conn.send(b"p", cfg["password"].encode("utf-8") + b"\x00")
        elif code == 5:            # MD5
            md5_auth(conn, cfg["user"], cfg["password"], data[4:8])
        elif code == 10:           # SASL
            mechs = [m.decode() for m in data[4:].split(b"\x00") if m]
            scram_auth(conn, cfg["password"], mechs)
        else:
            raise RuntimeError(f"지원하지 않는 인증 방식 code={code}")


def wait_ready(conn: Conn) -> dict[str, str]:
    """ReadyForQuery 까지 읽으며 서버 파라미터를 수집."""
    params: dict[str, str] = {}
    while True:
        tag, data = conn.read_message()
        if tag == "S":  # ParameterStatus
            k, v, _ = data.split(b"\x00", 2)
            params[k.decode()] = v.decode()
        elif tag == "E":
            raise RuntimeError(parse_error(data))
        elif tag == "Z":  # ReadyForQuery
            return params
        # 'K'(BackendKeyData) 등은 무시


def simple_query(conn: Conn, sql: str) -> list[str]:
    conn.send(b"Q", sql.encode("utf-8") + b"\x00")
    rows: list[str] = []
    while True:
        tag, data = conn.read_message()
        if tag == "D":  # DataRow
            (nfields,) = struct.unpack("!H", data[:2])
            off, vals = 2, []
            for _ in range(nfields):
                (ln,) = struct.unpack("!i", data[off:off + 4])
                off += 4
                if ln == -1:
                    vals.append(None)
                else:
                    vals.append(data[off:off + ln].decode("utf-8", "replace"))
                    off += ln
            rows.append(" | ".join(v if v is not None else "NULL" for v in vals))
        elif tag == "E":
            raise RuntimeError(parse_error(data))
        elif tag == "Z":  # ReadyForQuery
            return rows
        # 'T'(RowDescription), 'C'(CommandComplete) 는 무시


# --------------------------------------------------------------------------- #
# 메인
# --------------------------------------------------------------------------- #
def open_socket(host: str, port: int, timeout: float, use_ssl: bool) -> socket.socket:
    sock = socket.create_connection((host, port), timeout=timeout)
    if use_ssl:
        # SSLRequest: Int32(8) + Int32(80877103)
        sock.sendall(struct.pack("!II", 8, 80877103))
        resp = sock.recv(1)
        if resp == b"S":
            ctx = ssl.create_default_context()
            ctx.check_hostname = False
            ctx.verify_mode = ssl.CERT_NONE
            sock = ctx.wrap_socket(sock, server_hostname=host)
        elif resp == b"N":
            raise RuntimeError("서버가 SSL 을 지원하지 않습니다 (--no-ssl 로 재시도).")
        else:
            raise RuntimeError(f"예상치 못한 SSLRequest 응답: {resp!r}")
    return sock


def main() -> int:
    ap = argparse.ArgumentParser(description="PostgreSQL 연결 테스트")
    ap.add_argument("--env", default=".env", help="env 파일 경로 (기본: .env)")
    ap.add_argument("--timeout", type=float, default=10.0, help="연결 타임아웃(초)")
    ap.add_argument("--no-ssl", action="store_true", help="SSL 시도 생략")
    args = ap.parse_args()

    cfg = resolve_config(args.env)
    masked = "*" * len(cfg["password"]) if cfg["password"] else "(없음)"
    print("PostgreSQL 연결 테스트")
    print("─" * 48)
    print(f"  설정 출처 : {cfg['source']}")
    print(f"  호스트    : {cfg['host']}:{cfg['port']}")
    print(f"  사용자    : {cfg['user']}")
    print(f"  DB        : {cfg['dbname']}")
    print(f"  비밀번호  : {masked}")
    print("─" * 48)

    start = time.monotonic()
    sock = None
    try:
        # SSL 우선 시도, 실패 시 평문으로 폴백
        try:
            sock = open_socket(cfg["host"], cfg["port"], args.timeout, not args.no_ssl)
            ssl_on = not args.no_ssl
        except (ssl.SSLError, RuntimeError) as ssl_err:
            if args.no_ssl:
                raise
            print(f"  ⚠ SSL 실패, 평문으로 재시도: {ssl_err}")
            sock = open_socket(cfg["host"], cfg["port"], args.timeout, False)
            ssl_on = False

        conn = Conn(sock)
        authenticate(conn, cfg)
        params = wait_ready(conn)
        version = simple_query(conn, "SELECT version();")
        elapsed = (time.monotonic() - start) * 1000

        print(f"  ✅ 연결 성공  ({elapsed:.0f} ms, SSL={'on' if ssl_on else 'off'})")
        if version:
            print(f"  서버 버전 : {version[0]}")
        if "server_encoding" in params:
            print(f"  인코딩    : {params.get('server_encoding')}")
        # 정상 종료(Terminate)
        conn.send(b"X", b"")
        return 0
    except Exception as exc:  # noqa: BLE001
        elapsed = (time.monotonic() - start) * 1000
        print(f"  ❌ 연결 실패  ({elapsed:.0f} ms)")
        print(f"     {type(exc).__name__}: {exc}")
        return 1
    finally:
        if sock is not None:
            try:
                sock.close()
            except OSError:
                pass


if __name__ == "__main__":
    sys.exit(main())
