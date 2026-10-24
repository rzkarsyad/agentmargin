#!/usr/bin/env python3
"""Fail if the manual publication boundary regains build/install authority."""
from pathlib import Path
import re
source = Path('.github/workflows/publish-sdk.yml').read_text()
root, jobs = source.split('jobs:\n', 1)
assert 'id-token:' not in root
build, publish = jobs.split('\n  npm:\n', 1)
assert 'id-token:' not in build
assert 'npm ci --ignore-scripts' in build
assert 'environment: npm-publish' in publish and 'id-token: write' in publish
assert "github.ref == 'refs/heads/main'" in build and "github.ref == 'refs/heads/main'" in publish
assert 'test "$release_commit" = "$GITHUB_SHA"' in build
for forbidden in ['actions/checkout@', 'npm ci', 'npm install', 'npm run', '--workspace']:
    assert forbidden not in publish, forbidden
assert '--ignore-scripts --access public --provenance --tag alpha' in publish
assert '11.9.0' in build and 'sha512-BBZoU926' in build and 'sha512-BBZoU926' in publish
for action in re.findall(r'uses:\s*([^\s#]+)', source):
    assert re.fullmatch(r'[A-Za-z0-9_./-]+@[a-f0-9]{40}', action), action
print('PASS: manual publish authority isolated from checkout, build, install and lifecycle scripts')
