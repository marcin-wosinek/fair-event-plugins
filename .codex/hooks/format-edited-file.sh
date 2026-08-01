#!/usr/bin/env bash
# PostToolUse hook: format a single file after Claude edits it.
#
# Formats only the file that changed (by extension), not the whole tree —
# `npm run format` rewrites every file and is too slow to run per-edit.
#   - JS/CSS/JSON  -> wp-scripts format   (@wordpress/prettier-config)
#   - PHP          -> phpcbf              (WordPress standard)
#
# Build is intentionally NOT run here: it is slow and would block every edit.
# Run `npm run build` in the affected plugin manually after JS/CSS changes.
#
# Always exits 0: formatters return non-zero when they fix something, which is
# expected and must not surface as a hook failure.

set -u

root="${CLAUDE_PROJECT_DIR:-$(pwd)}"

# The tool payload arrives as JSON on stdin; pull out the edited file path.
file="$(node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{process.stdout.write(JSON.parse(s).tool_input.file_path||'')}catch(e){}})")"

# Ignore edits outside the repo (e.g. scratch files in /tmp).
case "$file" in
	"$root"/*) ;;
	*) exit 0 ;;
esac

cd "$root" || exit 0

case "$file" in
	*.js | *.jsx | *.ts | *.tsx | *.css | *.scss | *.json)
		npx wp-scripts format "$file" >/dev/null 2>&1 || true
		;;
	*.php)
		vendor/bin/phpcbf --standard=WordPress --extensions=php "$file" >/dev/null 2>&1 || true
		;;
esac

exit 0
