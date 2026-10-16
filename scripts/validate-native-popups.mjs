#!/usr/bin/env node

/**
 * Rejects browser-native confirm/alert/prompt popups in the production
 * source of the core plugins. The policy lives in UI_GUIDELINES.md
 * ("Popups and confirmations"); there is deliberately no allowlist or
 * baseline — a native popup is replaced, not exempted.
 *
 * Detection is syntax-aware: comments, strings, object keys, method calls on
 * other objects and locally bound functions of the same name are ignored.
 * Navigation protection (`beforeunload`) uses none of these globals and is
 * therefore allowed.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default ?? traverseModule;

export const SCANNED_PLUGINS = [
	'fair-events',
	'fair-payments-connector',
	'fair-form',
	'fair-audience',
];

const NATIVE_POPUPS = new Set(['confirm', 'alert', 'prompt']);

const GLOBAL_OBJECTS = new Set(['window', 'globalThis', 'self']);

const SOURCE_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs']);

const SKIPPED_DIRECTORIES = new Set(['__tests__', 'node_modules', 'build']);

const TEST_FILE = /\.(test|spec)\.[cm]?jsx?$/;

function isUnboundGlobal(nodePath, name) {
	return !nodePath.scope.hasBinding(name, true);
}

function staticPropertyName(member) {
	const { property, computed } = member;
	if (!computed && property.type === 'Identifier') {
		return property.name;
	}
	if (computed && property.type === 'StringLiteral') {
		return property.value;
	}
	if (
		computed &&
		property.type === 'TemplateLiteral' &&
		property.expressions.length === 0
	) {
		return property.quasis[0].value.cooked;
	}
	return null;
}

function isGlobalObject(nodePath, node) {
	return (
		node.type === 'Identifier' &&
		GLOBAL_OBJECTS.has(node.name) &&
		isUnboundGlobal(nodePath, node.name)
	);
}

function patternPropertyName(property) {
	if (property.type !== 'ObjectProperty') {
		return null;
	}
	if (!property.computed && property.key.type === 'Identifier') {
		return property.key.name;
	}
	if (property.key.type === 'StringLiteral') {
		return property.key.value;
	}
	return null;
}

/**
 * Finds native popup references in one source file.
 *
 * @param {string} source   File contents.
 * @param {string} filename Path used in parse errors.
 * @return {{line: number, column: number, name: string}[]} Violations.
 * @throws {SyntaxError} When the file cannot be parsed.
 */
export function findNativePopups(source, filename = 'source.js') {
	const ast = parse(source, {
		sourceType: 'unambiguous',
		sourceFilename: filename,
		plugins: ['jsx'],
	});
	const found = [];
	const report = (node, name) =>
		found.push({
			line: node.loc.start.line,
			column: node.loc.start.column + 1,
			name,
		});

	const visitMember = (memberPath) => {
		const name = staticPropertyName(memberPath.node);
		if (
			NATIVE_POPUPS.has(name) &&
			isGlobalObject(memberPath, memberPath.node.object)
		) {
			report(memberPath.node, name);
		}
	};

	traverse(ast, {
		Identifier(identifierPath) {
			const { name } = identifierPath.node;
			if (
				NATIVE_POPUPS.has(name) &&
				identifierPath.isReferencedIdentifier() &&
				isUnboundGlobal(identifierPath, name)
			) {
				report(identifierPath.node, name);
			}
		},
		MemberExpression: visitMember,
		OptionalMemberExpression: visitMember,
		VariableDeclarator(declaratorPath) {
			const { id, init } = declaratorPath.node;
			if (
				id.type !== 'ObjectPattern' ||
				!init ||
				!isGlobalObject(declaratorPath, init)
			) {
				return;
			}
			for (const property of id.properties) {
				const name = patternPropertyName(property);
				if (NATIVE_POPUPS.has(name)) {
					report(property, name);
				}
			}
		},
	});

	return found.sort((a, b) => a.line - b.line || a.column - b.column);
}

function sourceFiles(directory) {
	let entries;
	try {
		entries = readdirSync(directory, { withFileTypes: true });
	} catch {
		return [];
	}
	return entries
		.sort((a, b) => a.name.localeCompare(b.name))
		.flatMap((entry) => {
			const full = path.join(directory, entry.name);
			if (entry.isDirectory()) {
				return SKIPPED_DIRECTORIES.has(entry.name)
					? []
					: sourceFiles(full);
			}
			return entry.isFile() &&
				SOURCE_EXTENSIONS.has(path.extname(entry.name)) &&
				!TEST_FILE.test(entry.name)
				? [full]
				: [];
		});
}

/**
 * Scans the production source of every core plugin.
 *
 * @param {string}   root    Repository root.
 * @param {string[]} plugins Plugin directories to scan.
 * @return {string[]} One message per violation or parse error.
 */
export function validateNativePopups(root, plugins = SCANNED_PLUGINS) {
	const errors = [];
	for (const plugin of plugins) {
		const src = path.join(root, plugin, 'src');
		if (!statSync(src, { throwIfNoEntry: false })?.isDirectory()) {
			errors.push(`${plugin}/src: directory not found`);
			continue;
		}
		for (const file of sourceFiles(src)) {
			const relative = path
				.relative(root, file)
				.split(path.sep)
				.join('/');
			let found;
			try {
				found = findNativePopups(readFileSync(file, 'utf8'), relative);
			} catch (error) {
				errors.push(`${relative}: parse error: ${error.message}`);
				continue;
			}
			for (const { line, column, name } of found) {
				errors.push(
					`${relative}:${line}:${column}: native ${name}() — use a dialog or notice (UI_GUIDELINES.md § Popups and confirmations)`
				);
			}
		}
	}
	return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
	const root = path.resolve(
		path.dirname(fileURLToPath(import.meta.url)),
		'..'
	);
	const errors = validateNativePopups(root);
	if (errors.length > 0) {
		console.error(errors.join('\n'));
		console.error(
			`\n${errors.length} native popup problem(s) in ${SCANNED_PLUGINS.join(', ')}.`
		);
		process.exit(1);
	}
	console.log(
		`No native confirm/alert/prompt in ${SCANNED_PLUGINS.join(', ')}.`
	);
}
