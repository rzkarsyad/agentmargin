#!/usr/bin/env bash
# Verify protected, out-of-band Ed25519 public key BEFORE decryption or restore.
set -euo pipefail
archive=${1:?archive required}; manifest=${2:?manifest required}; signature=${3:?signature required}; verifier=${4:?trusted verifier required}
[[ -f "$archive" && ! -L "$archive" && -f "$manifest" && ! -L "$manifest" && -f "$signature" && ! -L "$signature" && -f "$verifier" && ! -L "$verifier" ]] || exit 2
# Never take the verification root from the downloaded archive/storage bundle.
[[ -O "$verifier" && $(stat -c '%a' "$verifier") =~ ^(400|600)$ ]] || exit 2
verifier=$(realpath -e -- "$verifier")
current=$verifier
while :; do
 read -r owner permissions < <(stat -c '%u %a' -- "$current")
 [[ "$owner" == 0 || "$owner" == "$EUID" ]] || exit 2
 mode=$((8#$permissions))
 if (( (mode & 0022) != 0 )); then
   [[ -d "$current" && "$owner" == 0 ]] && (( (mode & 01000) != 0 )) || exit 2
 fi
 [[ "$current" == / ]] && break
 current=$(dirname -- "$current")
done
[[ $(openssl pkey -pubin -in "$verifier" -text -noout 2>/dev/null | head -n1) == 'ED25519 Public-Key:' ]] || exit 2
[[ $(stat -c '%s' "$manifest") -le 1024 && $(stat -c '%s' "$signature") == 64 ]] || exit 2
openssl pkeyutl -verify -rawin -pubin -inkey "$verifier" -in "$manifest" -sigfile "$signature" >/dev/null 2>&1 || exit 1
mapfile -t fields < "$manifest"
[[ ${#fields[@]} == 4 && ${fields[0]} == agentmargin-backup-v1 && ${fields[1]} =~ ^agentmargin-[A-Za-z0-9-]+\.dump\.enc$ && ${fields[2]} =~ ^[a-f0-9]{64}$ && ${fields[3]} =~ ^[1-9][0-9]*$ ]] || exit 2
[[ $(basename -- "$archive") == "${fields[1]}" && $(stat -c '%s' "$archive") == "${fields[3]}" ]] || exit 1
actual=$(sha256sum < "$archive"); actual=${actual%% *}
[[ "$actual" == "${fields[2]}" ]] || exit 1
echo '{"kind":"backup_origin_verified","status":"pass"}'
