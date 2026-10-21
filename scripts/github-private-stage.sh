#!/usr/bin/env bash
# Fail-closed one-time GitHub private staging for CI verification.
# Requires OrbStack/Docker, Node >=22.18, npm, git, and GitHub CLI authenticated as rzkarsyad.
# Explicitly DOES NOT make the repository public.
set -Eeuo pipefail
cd "$(dirname "$0")/.."
repo="rzkarsyad/agentmargin"
for tool in gh git docker node npm python3; do
  command -v "$tool" >/dev/null || { echo "Missing $tool (no GitHub writes performed)" >&2; exit 2; }
done
gh auth status >/dev/null 2>&1 || { echo 'Authenticate GitHub CLI first: gh auth login' >&2; exit 2; }
login="$(gh api user --jq .login)"
[[ "$login" == 'rzkarsyad' ]] || { echo "Wrong GitHub account ($login). Expected rzkarsyad" >&2; exit 2; }
# Gate on a full fresh test execution, including real PostgreSQL and source scan.
bash scripts/orbstack-release-check.sh
# The repository must be nonexistent or explicitly private, never public at this stage.
if gh repo view "$repo" --json visibility --jq .visibility >/tmp/agentmargin-repo-visibility.$$ 2>/dev/null; then
  visibility="$(cat /tmp/agentmargin-repo-visibility.$$)"
  rm -f /tmp/agentmargin-repo-visibility.$$
  [[ "$visibility" == 'PRIVATE' ]] || { echo 'Refusing to push to a non-private repository' >&2; exit 2; }
  echo "Using existing PRIVATE repository $repo"
else
  rm -f /tmp/agentmargin-repo-visibility.$$
  echo "Creating PRIVATE repository $repo"
  gh repo create "$repo" --private --description 'Customer-level AI inference cost and margin analytics (experimental, self-hosted)'
fi
if [[ ! -d .git ]]; then git init -b main; fi
if git remote get-url origin >/dev/null 2>&1; then
  [[ "$(git remote get-url origin)" == "https://github.com/$repo.git" || "$(git remote get-url origin)" == "git@github.com:$repo.git" ]] || {
    echo 'Existing origin points elsewhere. Refusing to push.' >&2; exit 2;
  }
else
  git remote add origin "https://github.com/$repo.git"
fi
# Only source/doc files tracked. .gitignore excludes node_modules, env secrets, caches.
git add .
if git diff --cached --name-only | grep -E '(^|/)(\.env($|\.)|\.npmrc$|node_modules/|\.browser-venv/|\.venv/|__pycache__/)' ; then
  echo 'Unsafe staged files detected; refusing to push' >&2; exit 2
fi
if ! git diff --cached --quiet; then git commit -m 'Prepare AgentMargin experimental source release candidate'; fi
git push -u origin main
# GitHub Actions run is asynchronous; verify its conclusion before proceeding.
echo "Private staging pushed to https://github.com/$repo"
echo 'Check https://github.com/rzkarsyad/agentmargin/actions and do NOT switch to public until CI is green.'
