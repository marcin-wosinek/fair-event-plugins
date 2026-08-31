#!/usr/bin/env node

import { readFileSync, existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const WORKFLOWS = [
	'write-ticket',
	'plan-ticket',
	'make-pr',
	'pr',
	'release',
	'translate',
	'new-plugin',
];

const LEGACY_HOOKS = [
	'.claude/hooks/guard-generated-files.sh',
	'.claude/hooks/format-edited-file.sh',
	'.codex/hooks/guard-generated-files.sh',
	'.codex/hooks/format-edited-file.sh',
];

function read(root, relative) {
	return readFileSync(path.join(root, relative), 'utf8');
}

function hookCommands(value) {
	if (Array.isArray(value)) {
		return value.flatMap(hookCommands);
	}
	if (value && typeof value === 'object') {
		return Object.entries(value).flatMap(([key, child]) =>
			key === 'command' && typeof child === 'string'
				? [child]
				: hookCommands(child)
		);
	}
	return [];
}

export function validateAgentWorkflows(root) {
	const errors = [];

	for (const workflow of WORKFLOWS) {
		const skillPath = `.agents/skills/${workflow}/SKILL.md`;
		const adapterPath = `.claude/commands/${workflow}.md`;
		if (!existsSync(path.join(root, skillPath))) {
			errors.push(`Missing canonical skill: ${skillPath}`);
			continue;
		}
		const skill = read(root, skillPath);
		const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/);
		if (
			!frontmatter ||
			!new RegExp(`^name: ${workflow}$`, 'm').test(frontmatter[1])
		) {
			errors.push(
				`Canonical skill frontmatter name must be ${workflow}: ${skillPath}`
			);
		}

		if (!existsSync(path.join(root, adapterPath))) {
			errors.push(`Missing Claude adapter: ${adapterPath}`);
			continue;
		}
		const adapter = read(root, adapterPath);
		const reference = `.agents/skills/${workflow}/SKILL.md`;
		if (!adapter.includes(reference)) {
			errors.push(
				`Claude adapter must reference ${reference}: ${adapterPath}`
			);
		}
		if (!adapter.includes('$ARGUMENTS')) {
			errors.push(`Claude adapter must pass $ARGUMENTS: ${adapterPath}`);
		}
		const body = adapter.replace(/^---\n[\s\S]*?\n---\n?/, '').trim();
		const bodyLines = body.split('\n').filter((line) => line.trim());
		if (bodyLines.length > 3 || /^(?:#|[-*]|\d+\.)\s/m.test(body)) {
			errors.push(
				`Claude adapter contains substantive workflow instructions: ${adapterPath}`
			);
		}
	}

	for (const legacyHook of LEGACY_HOOKS) {
		if (existsSync(path.join(root, legacyHook))) {
			errors.push(`Legacy hook implementation remains: ${legacyHook}`);
		}
	}

	const runnerPath = 'scripts/agent-hook.mjs';
	if (!existsSync(path.join(root, runnerPath))) {
		errors.push(`Missing shared hook runner: ${runnerPath}`);
	} else {
		for (const [configPath, platform] of [
			['.claude/settings.json', 'claude'],
			['.codex/hooks.json', 'codex'],
		]) {
			const config = read(root, configPath);
			const commands = hookCommands(JSON.parse(config)).filter(
				(command) => command.includes('agent-hook.mjs')
			);
			for (const action of ['guard', 'format']) {
				if (
					!commands.some((command) =>
						command.endsWith(` ${platform} ${action}`)
					)
				) {
					errors.push(
						`${configPath} must invoke ${runnerPath} ${platform} ${action}`
					);
				}
			}
			for (const command of commands) {
				if (
					!['guard', 'format'].some((action) =>
						command.endsWith(` ${platform} ${action}`)
					)
				) {
					errors.push(
						`Unsupported shared hook invocation in ${configPath}: ${command}`
					);
				}
			}
		}
	}

	for (const configPath of [
		'.claude/settings.json',
		'.codex/hooks.json',
		'.codex/config.toml',
	]) {
		const config = read(root, configPath);
		if (/\/(?:Users|home)\/[^/\s"']+\//.test(config)) {
			errors.push(`Personal absolute path in ${configPath}`);
		}
		if (
			/(?:api[_-]?key|token|password)\s*[=:]\s*["'][^"']+["']/i.test(
				config
			)
		) {
			errors.push(`Embedded credential in ${configPath}`);
		}
	}

	return errors;
}

function main() {
	const root = process.argv[2]
		? path.resolve(process.argv[2])
		: process.cwd();
	const errors = validateAgentWorkflows(root);
	if (errors.length > 0) {
		process.stderr.write(`${errors.join('\n')}\n`);
		process.exitCode = 1;
		return;
	}
	process.stdout.write('Agent workflow validation passed.\n');
}

if (
	process.argv[1] &&
	path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
	main();
}
