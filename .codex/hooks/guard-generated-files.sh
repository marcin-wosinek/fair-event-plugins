#!/usr/bin/env bash
# PreToolUse hook: block edits to generated / vendored paths.
#
# build/, vendor/, node_modules/, svn/, and dist/ are produced by webpack,
# composer, npm, and the WordPress.org SVN sync. Editing them by hand is always
# a mistake — the change is overwritten on the next build/install and never
# reaches source control. Exit 2 blocks the tool call and tells Codex why.

set -u

# Codex sends the complete apply_patch command as tool_input.command. Extract
# every path from Add/Update/Delete directives before allowing the patch.
files="$(node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{const c=JSON.parse(s).tool_input.command||'';for(const m of c.matchAll(/^\\*\\*\\* (?:Add|Update|Delete) File: (.+)$/gm))console.log(m[1])}catch(e){}})")"

while IFS= read -r file; do
	case "/$file" in
		*/build/* | */vendor/* | */node_modules/* | */svn/* | */dist/*)
			echo "Refusing to edit a generated/vendored path: $file" >&2
			echo "build/, vendor/, node_modules/, svn/, and dist/ are generated. Edit source and rebuild instead." >&2
			exit 2
			;;
	esac
done <<<"$files"

exit 0
