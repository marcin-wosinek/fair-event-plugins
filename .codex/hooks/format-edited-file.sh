#!/usr/bin/env bash
# PostToolUse hook: format files after Codex edits them.
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

root="$(git rev-parse --show-toplevel 2>/dev/null || pwd)"

# Codex sends the complete apply_patch command as tool_input.command. Extract
# every Add/Update path; deleted files need no formatting.
files="$(node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{const c=JSON.parse(s).tool_input.command||'';for(const m of c.matchAll(/^\\*\\*\\* (?:Add|Update) File: (.+)$/gm))console.log(m[1])}catch(e){}})")"

cd "$root" || exit 0

while IFS= read -r file; do
	[ -n "$file" ] || continue
	case "$file" in
		/*) absolute="$file" ;;
		*) absolute="$root/$file" ;;
	esac
	[ -f "$absolute" ] || continue
	case "$absolute" in
		"$root"/*) ;;
		*) continue ;;
	esac
	case "$absolute" in
		*.js | *.jsx | *.ts | *.tsx | *.css | *.scss | *.json)
			npx wp-scripts format "$absolute" >/dev/null 2>&1 || true
			;;
		*.php)
			vendor/bin/phpcbf --standard=WordPress --extensions=php "$absolute" >/dev/null 2>&1 || true
			;;
	esac
done <<<"$files"

exit 0
