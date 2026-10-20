#!/usr/bin/env node

/**
 * Checks that every plugin-owned translatable string, block metadata entry
 * and translation registration uses the owning plugin's text domain.
 *
 * A companion plugin split out of a parent (Fair Finance from Fair Payments
 * Connector, the experimental plugins, Fair Form) can keep the parent's
 * domain without anything failing: the string still renders, just never
 * translated. Checking that a domain merely exists would let those calls
 * through, so this checks it against the plugin that ships the file.
 *
 * Covered:
 * - JS `__`, `_x`, `_n`, `_nx` from `@wordpress/i18n` (or `wp.i18n`).
 * - PHP gettext functions (`__`, `_e`, `esc_html__`, `_x`, `_n`, `_nx`, …).
 * - PHP `wp_set_script_translations()` and `load_plugin_textdomain()`.
 * - `block.json` `textdomain` and the main plugin file's `Text Domain:`.
 *
 * A missing or non-literal domain is reported too: `wp i18n make-pot` can't
 * extract it, so the string can never be translated.
 *
 * Enforcement is opt-in per plugin through TEXT_DOMAIN_OWNERS, so plugins
 * can be corrected one pull request at a time.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@babel/parser';
import traverseModule from '@babel/traverse';

const traverse = traverseModule.default ?? traverseModule;

/**
 * Plugin directory => the text domain its own source must use.
 */
export const TEXT_DOMAIN_OWNERS = {
	'fair-audience-experimental': 'fair-audience-experimental',
	'fair-events-experimental': 'fair-events-experimental',
	'fair-finance': 'fair-finance',
	'fair-form': 'fair-form',
};

/**
 * JS i18n function => zero-based position of its domain argument.
 */
const JS_DOMAIN_ARGUMENT = {
	__: 1,
	_x: 2,
	_n: 3,
	_nx: 4,
};

/**
 * PHP function => zero-based position of its domain argument.
 */
const PHP_DOMAIN_ARGUMENT = {
	__: 1,
	_e: 1,
	esc_html__: 1,
	esc_html_e: 1,
	esc_attr__: 1,
	esc_attr_e: 1,
	translate: 1,
	_x: 2,
	_ex: 2,
	esc_html_x: 2,
	esc_attr_x: 2,
	translate_with_gettext_context: 2,
	_n: 3,
	_n_noop: 2,
	_nx: 4,
	_nx_noop: 3,
	wp_set_script_translations: 1,
	load_plugin_textdomain: 0,
};

const JS_EXTENSIONS = new Set(['.js', '.jsx', '.mjs', '.cjs']);

const SKIPPED_DIRECTORIES = new Set([
	'__tests__',
	'tests',
	'node_modules',
	'build',
	'vendor',
]);

const TEST_FILE = /\.(test|spec)\.[cm]?jsx?$/;

function literalValue(node) {
	if (node.type === 'StringLiteral') {
		return node.value;
	}
	if (node.type === 'TemplateLiteral' && node.expressions.length === 0) {
		return node.quasis[0].value.cooked;
	}
	return null;
}

function isI18nObject(node) {
	if (node.type === 'Identifier') {
		return node.name === 'i18n';
	}
	return (
		node.type === 'MemberExpression' &&
		!node.computed &&
		node.property.type === 'Identifier' &&
		node.property.name === 'i18n'
	);
}

/**
 * Whether a called identifier is the i18n function rather than a local
 * helper that happens to share its name.
 *
 * @param {Object} calleePath Babel path of the callee identifier.
 * @return {boolean} True for imports from `@wordpress/i18n`, destructures
 *                   from `wp.i18n` and unbound globals.
 */
function isI18nBinding(calleePath) {
	const binding = calleePath.scope.getBinding(calleePath.node.name);
	if (!binding) {
		return true;
	}
	const declaration = binding.path;
	if (declaration.isImportSpecifier()) {
		return declaration.parent.source.value === '@wordpress/i18n';
	}
	if (declaration.isVariableDeclarator()) {
		const { id, init } = declaration.node;
		return id.type === 'ObjectPattern' && !!init && isI18nObject(init);
	}
	return false;
}

/**
 * Finds i18n calls in JS source and the domain each one uses.
 *
 * @param {string} source   File contents.
 * @param {string} filename Path used in parse errors.
 * @return {{line: number, name: string, domain: string|null, reason?: string}[]}
 *         One entry per call; `domain` is null when missing or non-literal.
 * @throws {SyntaxError} When the file cannot be parsed.
 */
export function findJsDomains(source, filename = 'source.js') {
	const ast = parse(source, {
		sourceType: 'unambiguous',
		sourceFilename: filename,
		plugins: ['jsx'],
	});
	const found = [];

	traverse(ast, {
		CallExpression(callPath) {
			const { callee, arguments: args } = callPath.node;
			let name = null;
			if (callee.type === 'Identifier') {
				name = callee.name;
				if (
					!(name in JS_DOMAIN_ARGUMENT) ||
					!isI18nBinding(callPath.get('callee'))
				) {
					return;
				}
			} else if (
				callee.type === 'MemberExpression' &&
				!callee.computed &&
				callee.property.type === 'Identifier' &&
				isI18nObject(callee.object)
			) {
				name = callee.property.name;
				if (!(name in JS_DOMAIN_ARGUMENT)) {
					return;
				}
			} else {
				return;
			}

			const argument = args[JS_DOMAIN_ARGUMENT[name]];
			const line = callPath.node.loc.start.line;
			if (!argument) {
				found.push({ line, name, domain: null, reason: 'missing' });
				return;
			}
			const domain = literalValue(argument);
			found.push(
				domain === null
					? { line, name, domain: null, reason: 'non-literal' }
					: { line, name, domain }
			);
		},
	});

	return found;
}

/**
 * Splits PHP source into identifiers, string literals and punctuation,
 * skipping inline HTML, comments and whitespace.
 *
 * @param {string} source PHP file contents.
 * @return {{type: string, value: string, line: number}[]} Tokens.
 */
export function tokenizePhp(source) {
	const tokens = [];
	let index = 0;
	let line = 1;
	let inPhp = false;

	const advance = (to) => {
		for (let i = index; i < to; i++) {
			if (source[i] === '\n') {
				line++;
			}
		}
		index = to;
	};

	while (index < source.length) {
		if (!inPhp) {
			const open = source.indexOf('<?php', index);
			const short = source.indexOf('<?=', index);
			const candidates = [open, short].filter((at) => at !== -1);
			if (candidates.length === 0) {
				break;
			}
			const at = Math.min(...candidates);
			advance(at + (at === open ? 5 : 3));
			inPhp = true;
			continue;
		}

		const char = source[index];
		const next = source[index + 1];

		if (char === '?' && next === '>') {
			advance(index + 2);
			inPhp = false;
			continue;
		}
		if (/\s/.test(char)) {
			advance(index + 1);
			continue;
		}
		if ((char === '/' && next === '/') || (char === '#' && next !== '[')) {
			let end = index;
			while (
				end < source.length &&
				source[end] !== '\n' &&
				!(source[end] === '?' && source[end + 1] === '>')
			) {
				end++;
			}
			advance(end);
			continue;
		}
		if (char === '/' && next === '*') {
			const end = source.indexOf('*/', index + 2);
			advance(end === -1 ? source.length : end + 2);
			continue;
		}
		if (char === "'" || char === '"') {
			const startLine = line;
			let end = index + 1;
			let raw = '';
			while (end < source.length && source[end] !== char) {
				if (source[end] === '\\' && end + 1 < source.length) {
					raw += source[end] + source[end + 1];
					end += 2;
				} else {
					raw += source[end];
					end++;
				}
			}
			advance(Math.min(end + 1, source.length));
			let value = raw;
			let interpolated = false;
			if (char === "'") {
				value = raw.replace(/\\(['\\])/g, '$1');
			} else {
				interpolated = /(^|[^\\])\$/.test(raw);
				value = raw.replace(/\\(["\\$])/g, '$1');
			}
			tokens.push({
				type: interpolated ? 'interpolated' : 'string',
				value,
				line: startLine,
			});
			continue;
		}
		if (char === '<' && source.startsWith('<<<', index)) {
			// Heredoc/nowdoc: skip to the closing identifier.
			const header = /^<<<\s*(['"]?)([A-Za-z_]\w*)\1/.exec(
				source.slice(index)
			);
			if (header) {
				const closing = new RegExp(`\\n\\s*${header[2]}\\b`, 'g');
				closing.lastIndex = index + header[0].length;
				const match = closing.exec(source);
				tokens.push({ type: 'interpolated', value: '', line });
				advance(match ? match.index + match[0].length : source.length);
				continue;
			}
		}
		const identifier = /^[A-Za-z_\\][\w\\]*/.exec(
			source.slice(index, index + 200)
		);
		if (identifier) {
			tokens.push({ type: 'ident', value: identifier[0], line });
			advance(index + identifier[0].length);
			continue;
		}
		const operator = /^(\?->|->|::|=>)/.exec(
			source.slice(index, index + 3)
		);
		const value = operator ? operator[0] : char;
		tokens.push({ type: 'punct', value, line });
		advance(index + value.length);
	}

	return tokens;
}

/**
 * Finds gettext calls and translation registrations in PHP source.
 *
 * @param {string} source PHP file contents.
 * @return {{line: number, name: string, domain: string|null, reason?: string}[]}
 *         One entry per call; `domain` is null when missing or non-literal.
 */
export function findPhpDomains(source) {
	const tokens = tokenizePhp(source);
	const found = [];

	tokens.forEach((token, position) => {
		if (token.type !== 'ident') {
			return;
		}
		const name = token.value.replace(/^\\/, '');
		if (!(name in PHP_DOMAIN_ARGUMENT)) {
			return;
		}
		const open = tokens[position + 1];
		if (!open || open.type !== 'punct' || open.value !== '(') {
			return;
		}
		const previous = tokens[position - 1];
		if (
			previous &&
			((previous.type === 'punct' &&
				['->', '?->', '::'].includes(previous.value)) ||
				(previous.type === 'ident' &&
					['function', 'new'].includes(previous.value.toLowerCase())))
		) {
			return;
		}

		const args = [[]];
		let depth = 0;
		for (let i = position + 1; i < tokens.length; i++) {
			const current = tokens[i];
			if (current.type === 'punct' && '([{'.includes(current.value)) {
				depth++;
				if (depth === 1) {
					continue;
				}
			} else if (
				current.type === 'punct' &&
				')]}'.includes(current.value)
			) {
				depth--;
				if (depth === 0) {
					break;
				}
			} else if (
				depth === 1 &&
				current.type === 'punct' &&
				current.value === ','
			) {
				args.push([]);
				continue;
			}
			args[args.length - 1].push(current);
		}
		if (args[args.length - 1].length === 0) {
			// Trailing comma or an empty argument list.
			args.pop();
		}

		const argument = args[PHP_DOMAIN_ARGUMENT[name]];
		if (!argument) {
			found.push({
				line: token.line,
				name,
				domain: null,
				reason: 'missing',
			});
			return;
		}
		found.push(
			argument.length === 1 && argument[0].type === 'string'
				? { line: token.line, name, domain: argument[0].value }
				: {
						line: token.line,
						name,
						domain: null,
						reason: 'non-literal',
					}
		);
	});

	return found;
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
			const extension = path.extname(entry.name);
			return entry.isFile() &&
				(JS_EXTENSIONS.has(extension) ||
					extension === '.php' ||
					entry.name === 'block.json') &&
				!TEST_FILE.test(entry.name)
				? [full]
				: [];
		});
}

function describe(found, expected) {
	if (found.domain === null) {
		return found.reason === 'missing'
			? `${found.name}() has no text domain; expected '${expected}'`
			: `${found.name}() has a non-literal text domain; expected '${expected}'`;
	}
	return `${found.name}() uses text domain '${found.domain}'; expected '${expected}'`;
}

/**
 * Checks one file against the domain its plugin owns.
 *
 * @param {string} source   File contents.
 * @param {string} filename Path, used for the file type and messages.
 * @param {string} expected Owning text domain.
 * @return {string[]} One message per violation.
 */
export function checkFile(source, filename, expected) {
	if (path.basename(filename) === 'block.json') {
		const metadata = JSON.parse(source);
		return metadata.textdomain === expected
			? []
			: [
					`${filename}: block textdomain is ${
						metadata.textdomain === undefined
							? 'missing'
							: `'${metadata.textdomain}'`
					}; expected '${expected}'`,
				];
	}

	const found = filename.endsWith('.php')
		? findPhpDomains(source)
		: findJsDomains(source, filename);
	return found
		.filter(({ domain }) => domain !== expected)
		.map(
			(entry) => `${filename}:${entry.line}: ${describe(entry, expected)}`
		);
}

/**
 * Scans every enforced plugin's source and main file.
 *
 * @param {string}                 root   Repository root.
 * @param {Object<string, string>} owners Plugin directory => text domain.
 * @return {string[]} One message per violation or parse error.
 */
export function validateTextDomains(root, owners = TEXT_DOMAIN_OWNERS) {
	const errors = [];
	for (const [plugin, expected] of Object.entries(owners)) {
		const pluginDir = path.join(root, plugin);
		const src = path.join(pluginDir, 'src');
		if (!statSync(src, { throwIfNoEntry: false })?.isDirectory()) {
			errors.push(`${plugin}/src: directory not found`);
			continue;
		}

		const mainFile = path.join(pluginDir, `${plugin}.php`);
		const files = sourceFiles(src);
		if (statSync(mainFile, { throwIfNoEntry: false })?.isFile()) {
			const header = /^[ \t/*#@]*Text Domain:\s*(\S+)/m.exec(
				readFileSync(mainFile, 'utf8')
			);
			if (header?.[1] !== expected) {
				errors.push(
					`${plugin}/${plugin}.php: plugin header Text Domain is ${
						header ? `'${header[1]}'` : 'missing'
					}; expected '${expected}'`
				);
			}
			files.push(mainFile);
		}

		for (const file of files) {
			const relative = path
				.relative(root, file)
				.split(path.sep)
				.join('/');
			try {
				errors.push(
					...checkFile(readFileSync(file, 'utf8'), relative, expected)
				);
			} catch (error) {
				errors.push(`${relative}: parse error: ${error.message}`);
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
	const plugins = Object.keys(TEXT_DOMAIN_OWNERS).join(', ');
	const errors = validateTextDomains(root);
	if (errors.length > 0) {
		console.error(errors.join('\n'));
		console.error(
			`\n${errors.length} text domain problem(s) in ${plugins} (I18N_SETUP.md).`
		);
		process.exit(1);
	}
	console.log(`Text domains match their owning plugin in ${plugins}.`);
}
