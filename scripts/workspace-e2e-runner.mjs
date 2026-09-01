#!/usr/bin/env node
/* eslint-disable no-console */

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const SIGNAL_EXIT_CODES = { SIGINT: 130, SIGTERM: 143 };

export function playwrightArguments(forwarded) {
	const hasSpecPath = forwarded.some((argument) =>
		/\.spec\.[cm]?[jt]sx?$/.test(argument)
	);
	return ['test', ...(hasSpecPath ? [] : ['e2e/']), ...forwarded];
}

export function runWorkspaceE2E(args = process.argv.slice(2)) {
	return new Promise((resolve) => {
		const child = spawn('playwright', playwrightArguments(args), {
			env: process.env,
			stdio: 'inherit',
		});
		child.on('error', () => resolve(1));
		child.on('exit', (code, signal) => {
			resolve(code ?? SIGNAL_EXIT_CODES[signal] ?? 1);
		});
	});
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	process.exitCode = await runWorkspaceE2E();
}
