#!/usr/bin/env bash
# PreToolUse hook: block edits to generated / vendored paths.
#
# build/, vendor/, node_modules/, svn/, and dist/ are produced by webpack,
# composer, npm, and the WordPress.org SVN sync. Editing them by hand is always
# a mistake — the change is overwritten on the next build/install and never
# reaches source control. Exit 2 blocks the tool call and tells Claude why.

set -u

# The tool payload arrives as JSON on stdin; pull out the target file path.
file="$(node -e "let s='';process.stdin.on('data',d=>s+=d);process.stdin.on('end',()=>{try{process.stdout.write(JSON.parse(s).tool_input.file_path||'')}catch(e){}})")"

case "$file" in
	*/build/* | */vendor/* | */node_modules/* | */svn/* | */dist/*)
		echo "Refusing to edit a generated/vendored path: $file" >&2
		echo "build/, vendor/, node_modules/, svn/, and dist/ are produced by the build, composer, npm, or SVN sync. Edit the source (e.g. src/) and rebuild instead." >&2
		exit 2
		;;
esac

exit 0
