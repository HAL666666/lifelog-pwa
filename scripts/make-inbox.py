#!/usr/bin/env python3
"""Create the encrypted Lifelog inbox JSON (AES-256-GCM, PBKDF2-SHA256 key).
Usage:
  LIFELOG_INBOX_PASS='...' python3 scripts/make-inbox.py items.json > inbox.enc.json
  echo '[...]' | LIFELOG_INBOX_PASS='...' python3 scripts/make-inbox.py - > inbox.enc.json
items.json: {"items":[...]} or [...]; each item needs a stable unique "id" (re-sending same id = no duplicate).
  {"id":"exam-2026-11","kind":"plan","title":"期末試験","start":"2026-11-20","end":"2026-11-22","type":"big","icon":"📝"}
  {"id":"rep-1","kind":"todo","title":"レポート提出","when":"2026-10-20T17:00:00+09:00"}   (kind todo|reminder|deadline)
  {"id":"m-1","kind":"memo","dateKey":"2026-10-14","text":"..."}
Optional per item: updatedAt (ISO) — a newer updatedAt overwrites the earlier copy in the app.
Requires: pip install cryptography
"""
import base64, json, os, sys
from cryptography.hazmat.primitives.ciphers.aead import AESGCM
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC
from cryptography.hazmat.primitives import hashes

ITER = 310000
def main():
    pw = os.environ.get('LIFELOG_INBOX_PASS')
    if not pw: sys.exit('set LIFELOG_INBOX_PASS')
    src = sys.argv[1] if len(sys.argv) > 1 else '-'
    data = json.load(sys.stdin if src == '-' else open(src, encoding='utf-8'))
    items = data['items'] if isinstance(data, dict) else data
    for it in items:
        if not it.get('id') or it.get('kind') not in ('plan', 'todo', 'reminder', 'deadline', 'memo'):
            sys.exit(f'bad item: {it}')
    salt, iv = os.urandom(16), os.urandom(12)
    key = PBKDF2HMAC(hashes.SHA256(), 32, salt, ITER).derive(pw.encode())
    pt = json.dumps({'items': items}, ensure_ascii=False).encode()
    ct = AESGCM(key).encrypt(iv, pt, None)
    b = lambda x: base64.b64encode(x).decode()
    json.dump({'v': 1, 'alg': 'AES-GCM', 'kdf': 'PBKDF2-SHA256', 'iter': ITER, 'salt': b(salt), 'iv': b(iv), 'ct': b(ct)}, sys.stdout)
    print()
if __name__ == '__main__': main()
