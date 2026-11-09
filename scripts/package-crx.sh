#!/usr/bin/env bash
set -euo pipefail

if [[ $# -ne 4 ]]; then
  printf 'Usage: %s <extension directory> <private key> <expected extension ID> <output.crx>\n' "$0" >&2
  exit 2
fi

extension=$(realpath "$1")
key=$(realpath "$2")
expected_id=$3
output=$(realpath -m "$4")

if [[ ! "$expected_id" =~ ^[a-p]{32}$ ]]; then
  printf 'Invalid expected extension ID.\n' >&2
  exit 1
fi

actual_id=$(openssl pkey -in "$key" -pubout -outform DER 2>/dev/null | sha256sum | cut -c1-32 | tr '0123456789abcdef' 'abcdefghijklmnop')
if [[ "$actual_id" != "$expected_id" ]]; then
  printf 'The signing key does not match the expected Chrome extension ID.\n' >&2
  exit 1
fi

if [[ -e "$output" ]]; then
  printf 'Refusing to replace %s.\n' "$output" >&2
  exit 1
fi

work=$(mktemp -d)
trap 'rm -rf -- "$work"' EXIT
cp -a "$extension" "$work/extension"
timeout 60s google-chrome --headless --no-sandbox \
  --user-data-dir="$work/profile" \
  --pack-extension="$work/extension" \
  --pack-extension-key="$key"

node - "$work/extension.crx" "$work/payload.zip" <<'NODE'
const fs = require('node:fs');
const data = fs.readFileSync(process.argv[2]);
if (data.length < 12 || data.toString('ascii', 0, 4) !== 'Cr24' || data.readUInt32LE(4) !== 3) {
  throw new Error('Chrome did not produce a CRX3 file.');
}
const offset = 12 + data.readUInt32LE(8);
if (offset >= data.length) throw new Error('The CRX payload is missing.');
fs.writeFileSync(process.argv[3], data.subarray(offset));
NODE

unzip -t "$work/payload.zip" >/dev/null
unzip -q "$work/payload.zip" -d "$work/unpacked"
diff -qr "$extension" "$work/unpacked" >/dev/null
cp "$work/extension.crx" "$output"
printf 'Created CRX3 for extension %s.\n' "$actual_id"
