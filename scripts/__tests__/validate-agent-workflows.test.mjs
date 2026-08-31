import assert from 'node:assert/strict';
import {
	cpSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

import { validateAgentWorkflows } from '../validate-agent-workflows.mjs';

function fixture() {
	const root = mkdtempSync(path.join(tmpdir(), 'agent-workflows-'));
	for (const relative of ['.agents', '.claude', '.codex', 'scripts']) {
		cpSync(relative, path.join(root, relative), { recursive: true });
	}
	return root;
}

function withFixture(callback) {
	const root = fixture();
	try {
		callback(root);
	} finally {
		rmSync(root, { recursive: true, force: true });
	}
}

test('accepts all seven valid workflow pairs and hook configurations', () => {
	withFixture((root) => assert.deepEqual(validateAgentWorkflows(root), []));
});

test('detects a missing canonical skill', () => {
	withFixture((root) => {
		rmSync(path.join(root, '.agents/skills/pr/SKILL.md'));
		assert.match(
			validateAgentWorkflows(root).join('\n'),
			/Missing canonical skill/
		);
	});
});

test('detects a missing adapter', () => {
	withFixture((root) => {
		rmSync(path.join(root, '.claude/commands/pr.md'));
		assert.match(
			validateAgentWorkflows(root).join('\n'),
			/Missing Claude adapter/
		);
	});
});

test('detects a broken canonical reference', () => {
	withFixture((root) => {
		const file = path.join(root, '.claude/commands/pr.md');
		writeFileSync(
			file,
			readFileSync(file, 'utf8').replace(
				'/pr/SKILL.md',
				'/release/SKILL.md'
			)
		);
		assert.match(validateAgentWorkflows(root).join('\n'), /must reference/);
	});
});

test('detects duplicated adapter instructions', () => {
	withFixture((root) => {
		const file = path.join(root, '.claude/commands/pr.md');
		writeFileSync(
			file,
			`${readFileSync(file, 'utf8')}\n- Also stage every file.\n`
		);
		assert.match(
			validateAgentWorkflows(root).join('\n'),
			/substantive workflow instructions/
		);
	});
});

test('detects mismatched skill frontmatter', () => {
	withFixture((root) => {
		const file = path.join(root, '.agents/skills/pr/SKILL.md');
		writeFileSync(
			file,
			readFileSync(file, 'utf8').replace('name: pr', 'name: release')
		);
		assert.match(
			validateAgentWorkflows(root).join('\n'),
			/frontmatter name must be pr/
		);
	});
});

test('detects a wrong hook platform or unsupported action', () => {
	withFixture((root) => {
		const file = path.join(root, '.codex/hooks.json');
		writeFileSync(
			file,
			readFileSync(file, 'utf8').replace('codex guard', 'claude rewrite')
		);
		const errors = validateAgentWorkflows(root).join('\n');
		assert.match(
			errors,
			/must invoke scripts\/agent-hook\.mjs codex guard/
		);
		assert.match(errors, /Unsupported shared hook invocation/);
	});
});
