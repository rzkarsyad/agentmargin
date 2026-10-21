#!/usr/bin/env python3
"""Best-effort content and sensitive-file scan before publishing source.
This is defense in depth, not a guarantee that no secrets exist.
"""
from pathlib import Path
import re
import sys

root = Path(__file__).resolve().parents[1]
ignore_dirs = {'.git', 'node_modules', 'dist', 'coverage', '.next', '__pycache__', '.browser-venv', '.venv'}
forbidden_exact = {'.npmrc', '.pypirc', '.netrc', 'id_rsa', 'id_ed25519', 'credentials.json', 'service-account.json'}
forbidden_suffixes = {'.pem', '.p12', '.pfx', '.key', '.sqlite', '.sqlite3'}
patterns = {
    'private_key': re.compile(r'-----BEGIN (?:RSA |EC |OPENSSH |DSA |ENCRYPTED )?PRIVATE KEY-----'),
    'github_classic_token': re.compile(r'gh[pousr]_[A-Za-z0-9_]{20,}'),
    'github_fine_grained_token': re.compile(r'github_pat_[A-Za-z0-9_]{40,}'),
    'openai_key': re.compile(r'\bsk-(?:proj-)?[A-Za-z0-9_-]{24,}\b'),
    'anthropic_key': re.compile(r'\bsk-ant-[A-Za-z0-9_-]{24,}\b'),
    'aws_access_key': re.compile(r'\bAKIA[0-9A-Z]{16}\b'),
    'slack_token': re.compile(r'\bxox[baprs]-[A-Za-z0-9-]{20,}\b'),
    'sensitive_assignment': re.compile(r'(?im)^\s*(?:DATABASE_URL|OPENAI_API_KEY|ANTHROPIC_API_KEY|GITHUB_TOKEN|AWS_SECRET_ACCESS_KEY)\s*=\s*\S+'),
}
findings = []
for path in root.rglob('*'):
    rel = path.relative_to(root)
    if any(part in ignore_dirs for part in rel.parts):
        continue
    if path.is_symlink():
        findings.append(f'{rel}: symlink requires manual review')
        continue
    if not path.is_file():
        continue
    if path.name in forbidden_exact or (path.name.startswith('.env') and path.name != '.env.example') or path.suffix.lower() in forbidden_suffixes:
        findings.append(f'{rel}: forbidden or sensitive file extension')
        continue
    if path.suffix.lower() in {'.zip', '.png', '.jpg', '.webp', '.pdf', '.lock'}:
        continue
    if path.stat().st_size > 1_000_000:
        findings.append(f'{rel}: oversized unchecked file')
        continue
    try:
        content = path.read_text(encoding='utf-8')
    except UnicodeError:
        findings.append(f'{rel}: unscanned non-text file')
        continue
    for name, pattern in patterns.items():
        if rel.as_posix() == 'scripts/check-release-files.py':
            continue  # Regex pattern definitions are not embedded secrets.
        for match in pattern.finditer(content):
            if name == 'sensitive_assignment' and ('...' in match.group(0) or 'example' in match.group(0).lower()):
                continue
            findings.append(f'{rel}:{content.count(chr(10), 0, match.start()) + 1}: {name}')
if findings:
    print('FAIL: source-file security check\n' + '\n'.join(findings))
    sys.exit(1)
print('PASS: no matching embedded secrets or forbidden sensitive files (heuristic scan)')
