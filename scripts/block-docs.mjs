#!/usr/bin/env node

/**
 * Block documentation: generation and validation.
 *
 * Every block a plugin supplies carries authored documentation next to its
 * source, in `src/blocks/<block>/docs/`:
 *
 *   doc.json            status, availability, and example descriptors
 *   guide.md            usage guidance (purpose, attributes, prerequisites,
 *                       composition, rendering)
 *   examples/<name>.html serialized block markup; `minimal.html` is required
 *
 * A docs directory without a block.json documents something registered
 * outside block.json: a PHP-only block (`"kind": "php-block"`) or a variation
 * of another block (`"kind": "variation"`).
 *
 * `generate` combines those sources with block.json into the distributed
 * `<plugin>/block-docs/` directory (index.json entry point, per-block
 * README.md with a generated technical reference, and the examples), which
 * ships in the plugin ZIP. `check` validates the sources of every plugin.
 * `refresh-version` rewrites the recorded plugin version after
 * stamp-build-version.js has stamped the PHP header.
 *
 * Usage:
 *   node scripts/block-docs.mjs generate <plugin>
 *   node scripts/block-docs.mjs check [<plugin>...]
 *   node scripts/block-docs.mjs refresh-version [<plugin>...]
 */

import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from 'node:fs';
import { dirname, join, relative, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '@wordpress/block-serialization-default-parser';

export const SCHEMA_VERSION = 1;
export const OUTPUT_DIR = 'block-docs';

const DEFAULT_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

const STATUSES = ['authoring', 'legacy', 'unregistered'];
const KINDS = ['block', 'php-block', 'variation'];
const EXAMPLE_CONTEXTS = ['page', 'event', 'recurring-event'];
const EXAMPLE_CONTEXT_LABELS = {
	page: 'any post or page',
	event: 'an event post (a post with a Fair Events event date)',
	'recurring-event':
		'a recurring event post (a post linked to a Fair Events series)',
};

/**
 * Attributes every block accepts through WordPress core supports or the
 * editor itself, so examples may use them without a block.json declaration.
 */
const GENERIC_ATTRIBUTES = new Set([
	'align',
	'anchor',
	'backgroundColor',
	'className',
	'fontSize',
	'gradient',
	'layout',
	'lock',
	'metadata',
	'style',
	'textColor',
]);

/**
 * Discover the workspaces that supply block documentation: every workspace
 * in the root package.json with a block.json or a docs/doc.json under
 * src/blocks/.
 *
 * @param {string} rootDir Repository root.
 * @return {string[]} Plugin (workspace) names.
 */
export function findDocumentedPlugins(rootDir = DEFAULT_ROOT) {
	const pkg = JSON.parse(readFileSync(join(rootDir, 'package.json'), 'utf8'));
	return (pkg.workspaces || []).filter((name) => {
		const blocksDir = join(rootDir, name, 'src', 'blocks');
		if (!existsSync(blocksDir)) {
			return false;
		}
		return readdirSync(blocksDir, { withFileTypes: true }).some(
			(entry) =>
				entry.isDirectory() &&
				(existsSync(join(blocksDir, entry.name, 'block.json')) ||
					existsSync(join(blocksDir, entry.name, 'docs', 'doc.json')))
		);
	});
}

/**
 * Read the Version header of a plugin's main PHP file.
 *
 * @param {string} phpSource Contents of the main plugin file.
 * @return {string|null} The version, or null when absent.
 */
export function parsePluginVersion(phpSource) {
	const match = phpSource.match(/^[ \t/*#@]*Version:\s*(\S+)/im);
	return match ? match[1] : null;
}

function readJson(path, errors, label) {
	try {
		return JSON.parse(readFileSync(path, 'utf8'));
	} catch (error) {
		errors.push(`${label}: cannot read JSON (${error.message})`);
		return null;
	}
}

function toPosix(path) {
	return path.split(sep).join('/');
}

/**
 * Collect the documented entries (blocks, PHP-only blocks, variations) of a
 * plugin, with any structural errors found while reading them.
 *
 * @param {string} rootDir    Repository root.
 * @param {string} pluginName Workspace name.
 * @return {{entries: object[], errors: string[], metadataOnly: object[]}} Entries, errors, and undocumented block metadata.
 */
export function collectEntries(rootDir, pluginName) {
	const pluginDir = join(rootDir, pluginName);
	const blocksDir = join(pluginDir, 'src', 'blocks');
	const entries = [];
	const errors = [];
	// Undocumented blocks still belong in the inventory, so other plugins'
	// examples that nest them validate independently of this plugin's docs.
	const metadataOnly = [];

	const dirs = existsSync(blocksDir)
		? readdirSync(blocksDir, { withFileTypes: true })
				.filter((entry) => entry.isDirectory())
				.map((entry) => entry.name)
				.sort()
		: [];

	for (const dirName of dirs) {
		const blockDir = join(blocksDir, dirName);
		const blockJsonPath = join(blockDir, 'block.json');
		const docsDir = join(blockDir, 'docs');
		const docJsonPath = join(docsDir, 'doc.json');
		const hasBlockJson = existsSync(blockJsonPath);
		const hasDoc = existsSync(docJsonPath);
		const sourceLabel = `${pluginName}/src/blocks/${dirName}`;

		if (!hasBlockJson && !hasDoc) {
			continue;
		}
		if (!hasDoc) {
			errors.push(
				`${sourceLabel}: block.json has no documentation (missing docs/doc.json)`
			);
			const undocumented = readJson(
				blockJsonPath,
				errors,
				`${sourceLabel}/block.json`
			);
			if (undocumented?.name) {
				metadataOnly.push(undocumented);
			}
			continue;
		}

		const doc = readJson(docJsonPath, errors, `${sourceLabel}/docs/doc.json`);
		if (!doc) {
			continue;
		}
		const kind = doc.kind || 'block';
		const blockJson = hasBlockJson
			? readJson(blockJsonPath, errors, `${sourceLabel}/block.json`)
			: null;

		if (!KINDS.includes(kind)) {
			errors.push(`${sourceLabel}: unknown kind "${kind}"`);
			continue;
		}
		if (kind === 'block' && !hasBlockJson) {
			errors.push(
				`${sourceLabel}: docs/doc.json has no block.json (set "kind" to "php-block" or "variation" for metadata defined elsewhere)`
			);
			continue;
		}
		if (kind !== 'block' && hasBlockJson) {
			errors.push(
				`${sourceLabel}: kind "${kind}" must not have a block.json`
			);
			continue;
		}

		let name;
		let metadata;
		if (kind === 'block') {
			if (!blockJson) {
				continue;
			}
			name = blockJson.name;
			metadata = blockJson;
		} else if (kind === 'php-block') {
			name = doc.name;
			metadata = {
				name: doc.name,
				title: doc.title,
				description: doc.description,
				attributes: doc.attributes || {},
				supports: doc.supports || {},
			};
		} else {
			name = `${doc.block}/${doc.variation}`;
			metadata = {
				name: doc.block,
				title: doc.title,
				description: doc.description,
				attributes: doc.attributes || {},
			};
		}

		if (!name || typeof name !== 'string') {
			errors.push(`${sourceLabel}: cannot determine the block name`);
			continue;
		}

		const examplesDir = join(docsDir, 'examples');
		const exampleFiles = existsSync(examplesDir)
			? readdirSync(examplesDir)
					.filter((file) => file.endsWith('.html'))
					// The minimal example first, then the rest alphabetically.
					.sort((a, b) =>
						a === 'minimal.html'
							? -1
							: b === 'minimal.html'
							? 1
							: a.localeCompare(b)
					)
			: [];

		entries.push({
			kind,
			name,
			dirName,
			sourceDir: toPosix(relative(pluginDir, blockDir)),
			doc,
			metadata,
			guidePath: join(docsDir, 'guide.md'),
			examplesDir,
			exampleFiles,
		});
	}

	return { entries, errors, metadataOnly };
}

function typeMatches(value, type) {
	const types = Array.isArray(type) ? type : [type];
	return types.some((candidate) => {
		switch (candidate) {
			case 'string':
				return typeof value === 'string';
			case 'boolean':
				return typeof value === 'boolean';
			case 'number':
				return typeof value === 'number';
			case 'integer':
				return Number.isInteger(value);
			case 'array':
				return Array.isArray(value);
			case 'object':
				return (
					value !== null &&
					typeof value === 'object' &&
					!Array.isArray(value)
				);
			case 'null':
				return value === null;
			default:
				return true;
		}
	});
}

/**
 * Validate one serialized example against the documented block inventory.
 *
 * @param {string} markup    Example file contents.
 * @param {object} entry     The documented entry the example belongs to.
 * @param {Map}    inventory Block name → metadata for every Fair block.
 * @param {string} label     Prefix for error messages.
 * @return {string[]} Errors.
 */
export function validateExample(markup, entry, inventory, label) {
	const errors = [];
	const blocks = parse(markup);
	let containsTarget = false;

	const variationMatches = (block) =>
		entry.kind === 'variation' &&
		block.blockName === entry.doc.block &&
		Object.entries(entry.doc.isActive || {}).every(
			([key, value]) => block.attrs?.[key] === value
		);

	const visit = (block, ancestors) => {
		if (block.blockName === null) {
			if (ancestors.length === 0 && block.innerHTML.trim() !== '') {
				errors.push(
					`${label}: content outside a block comment: ${block.innerHTML
						.trim()
						.slice(0, 60)}`
				);
			}
			return;
		}

		const name = block.blockName;
		if (name === entry.name || variationMatches(block)) {
			containsTarget = true;
		}

		const metadata = inventory.get(name);
		if (!metadata && !name.startsWith('core/')) {
			errors.push(`${label}: unknown block "${name}"`);
		}

		if (metadata) {
			const parent = ancestors[ancestors.length - 1];
			if (Array.isArray(metadata.parent) && metadata.parent.length > 0) {
				if (!parent || !metadata.parent.includes(parent)) {
					errors.push(
						`${label}: "${name}" must be a direct child of ${metadata.parent.join(
							' or '
						)}`
					);
				}
			}
			if (
				Array.isArray(metadata.ancestor) &&
				metadata.ancestor.length > 0 &&
				!ancestors.some((ancestor) =>
					metadata.ancestor.includes(ancestor)
				)
			) {
				errors.push(
					`${label}: "${name}" must be nested inside ${metadata.ancestor.join(
						' or '
					)}`
				);
			}

			const declared = metadata.attributes || {};
			for (const [key, value] of Object.entries(block.attrs || {})) {
				if (GENERIC_ATTRIBUTES.has(key)) {
					continue;
				}
				const schema = declared[key];
				if (!schema) {
					errors.push(
						`${label}: "${name}" has no attribute "${key}"`
					);
					continue;
				}
				if (schema.type && !typeMatches(value, schema.type)) {
					errors.push(
						`${label}: "${name}" attribute "${key}" must be of type ${schema.type}`
					);
				}
				if (Array.isArray(schema.enum) && !schema.enum.includes(value)) {
					errors.push(
						`${label}: "${name}" attribute "${key}" must be one of ${schema.enum.join(
							', '
						)}`
					);
				}
			}
		}

		for (const inner of block.innerBlocks || []) {
			visit(inner, [...ancestors, name]);
		}
	};

	const topLevel = blocks.filter((block) => block.blockName !== null);
	if (topLevel.length === 0) {
		errors.push(`${label}: contains no blocks`);
	}
	for (const block of blocks) {
		visit(block, []);
	}
	if (!containsTarget) {
		errors.push(`${label}: does not contain "${entry.name}"`);
	}

	return errors;
}

/**
 * Validate a documented entry's doc.json, guide, and examples.
 *
 * @param {object} entry      Entry from collectEntries().
 * @param {Map}    inventory  Block name → metadata for every Fair block.
 * @param {string} pluginName Owning workspace.
 * @return {string[]} Errors.
 */
export function validateEntry(entry, inventory, pluginName) {
	const errors = [];
	const label = `${pluginName}/${entry.sourceDir}`;
	const { doc } = entry;

	if (!STATUSES.includes(doc.status)) {
		errors.push(
			`${label}: doc.json "status" must be one of ${STATUSES.join(', ')}`
		);
	}
	if (doc.status === 'legacy' && entry.kind !== 'variation') {
		if (!doc.replacement) {
			errors.push(`${label}: a legacy block needs a "replacement"`);
		} else if (!inventory.has(doc.replacement)) {
			errors.push(
				`${label}: replacement "${doc.replacement}" is not a documented block`
			);
		}
	}
	if (!doc.registration || typeof doc.registration !== 'object') {
		errors.push(
			`${label}: doc.json needs a "registration" object ({ "condition": "always" | "feature" | ... , "detail": "..." })`
		);
	} else if (!doc.registration.condition) {
		errors.push(`${label}: "registration.condition" is required`);
	}
	if (doc.requires !== undefined && !Array.isArray(doc.requires)) {
		errors.push(`${label}: "requires" must be an array of plugin slugs`);
	}
	if (entry.kind === 'php-block' && !doc.registeredIn) {
		errors.push(
			`${label}: a php-block needs "registeredIn" (the PHP file registering it)`
		);
	}
	if (
		entry.kind === 'variation' &&
		(!doc.block || !doc.variation || !doc.isActive)
	) {
		errors.push(
			`${label}: a variation needs "block", "variation", and "isActive"`
		);
	}

	if (!existsSync(entry.guidePath)) {
		errors.push(`${label}: missing docs/guide.md`);
	} else {
		const guide = readFileSync(entry.guidePath, 'utf8');
		if (guide.trim().length < 200) {
			errors.push(`${label}: docs/guide.md is too short to be guidance`);
		}
		if (/^#\s/m.test(guide)) {
			errors.push(
				`${label}: docs/guide.md must not contain a level-1 heading (the generated README adds the title)`
			);
		}
	}

	const declared = doc.examples || {};
	const files = new Set(entry.exampleFiles.map((file) => file.slice(0, -5)));

	if (!files.has('minimal')) {
		errors.push(`${label}: missing docs/examples/minimal.html`);
	}
	for (const exampleName of files) {
		if (!declared[exampleName]) {
			errors.push(
				`${label}: examples/${exampleName}.html is not described in doc.json "examples"`
			);
		}
	}
	for (const [exampleName, descriptor] of Object.entries(declared)) {
		if (!files.has(exampleName)) {
			errors.push(
				`${label}: doc.json describes example "${exampleName}" but examples/${exampleName}.html is missing`
			);
			continue;
		}
		if (!descriptor.title) {
			errors.push(`${label}: example "${exampleName}" needs a "title"`);
		}
		if (!EXAMPLE_CONTEXTS.includes(descriptor.context)) {
			errors.push(
				`${label}: example "${exampleName}" "context" must be one of ${EXAMPLE_CONTEXTS.join(
					', '
				)}`
			);
		}
		if (
			descriptor.syntheticIds !== undefined &&
			(typeof descriptor.syntheticIds !== 'object' ||
				Array.isArray(descriptor.syntheticIds))
		) {
			errors.push(
				`${label}: example "${exampleName}" "syntheticIds" must map attribute names to the records they reference`
			);
		}
		if (!descriptor.frontend) {
			errors.push(
				`${label}: example "${exampleName}" needs a "frontend" selector the rendered page must contain`
			);
		}
		const markup = readFileSync(
			join(entry.examplesDir, `${exampleName}.html`),
			'utf8'
		);
		errors.push(
			...validateExample(
				markup,
				entry,
				inventory,
				`${label}/docs/examples/${exampleName}.html`
			)
		);
	}

	return errors;
}

/**
 * Collect every documented plugin's entries and build the block inventory
 * (block name → metadata) used to validate cross-plugin examples.
 * Errors are keyed by plugin, so checking one plugin is not blocked by
 * another plugin's incomplete documentation.
 *
 * @param {string} rootDir Repository root.
 * @return {{plugins: Map<string, object[]>, inventory: Map, owners: Map, errors: Map<string, string[]>}} Collected data.
 */
export function collectAll(rootDir = DEFAULT_ROOT) {
	const plugins = new Map();
	const inventory = new Map();
	const owners = new Map();
	const errors = new Map();

	for (const pluginName of findDocumentedPlugins(rootDir)) {
		const collected = collectEntries(rootDir, pluginName);
		errors.set(pluginName, [...collected.errors]);
		plugins.set(pluginName, collected.entries);
		for (const metadata of collected.metadataOnly) {
			if (!inventory.has(metadata.name)) {
				inventory.set(metadata.name, metadata);
			}
		}
		for (const entry of collected.entries) {
			if (entry.kind === 'variation') {
				continue;
			}
			if (owners.has(entry.name)) {
				errors.get(pluginName).push(
					`${entry.name} is documented by both ${owners.get(
						entry.name
					)} and ${pluginName}`
				);
				continue;
			}
			owners.set(entry.name, pluginName);
			inventory.set(entry.name, entry.metadata);
		}
	}

	return { plugins, inventory, owners, errors };
}

/**
 * Validate the documentation sources of the given plugins (all by default).
 *
 * @param {string}   rootDir     Repository root.
 * @param {string[]} pluginNames Plugins to check; empty for all.
 * @return {string[]} Errors.
 */
export function checkSources(rootDir = DEFAULT_ROOT, pluginNames = []) {
	const { plugins, inventory, errors: collectErrors } = collectAll(rootDir);
	const selected = pluginNames.length ? pluginNames : [...plugins.keys()];
	const errors = [];

	for (const pluginName of selected) {
		errors.push(...(collectErrors.get(pluginName) || []));
		if (!plugins.has(pluginName)) {
			errors.push(`${pluginName}: no documented blocks found`);
			continue;
		}
		for (const entry of plugins.get(pluginName)) {
			errors.push(...validateEntry(entry, inventory, pluginName));
		}
	}

	return errors;
}

function formatDefault(schema) {
	if (!Object.prototype.hasOwnProperty.call(schema, 'default')) {
		return '—';
	}
	return `\`${JSON.stringify(schema.default)}\``;
}

function formatType(schema) {
	const type = Array.isArray(schema.type)
		? schema.type.join(' \\| ')
		: schema.type || 'any';
	if (schema.type === 'array' && schema.items?.type) {
		return `array of ${schema.items.type}`;
	}
	return type;
}

function escapeCell(text) {
	return String(text).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

/**
 * Render the technical reference section from block metadata.
 *
 * @param {object} entry Entry from collectEntries().
 * @return {string} Markdown.
 */
export function renderReference(entry) {
	const { metadata, kind, doc } = entry;
	const lines = ['## Technical reference', ''];

	if (kind === 'block') {
		lines.push(
			`Generated from \`${entry.sourceDir}/block.json\`; the registered copy ships at \`build/blocks/${entry.dirName}/block.json\`.`
		);
	} else if (kind === 'php-block') {
		lines.push(
			`This block has no block.json. It is registered in PHP by \`${doc.registeredIn}\`; the attributes below mirror that registration.`
		);
	} else {
		lines.push(
			`A variation of \`${doc.block}\` named \`${doc.variation}\`, registered in the editor by \`${entry.sourceDir}\`. It is active when the block's attributes match \`${JSON.stringify(
				doc.isActive
			)}\`.`
		);
	}
	lines.push('');

	const facts = [];
	if (metadata.category) {
		facts.push(`- **Category:** \`${metadata.category}\``);
	}
	if (metadata.parent?.length) {
		facts.push(
			`- **Parent (direct):** ${metadata.parent
				.map((name) => `\`${name}\``)
				.join(', ')}`
		);
	}
	if (metadata.ancestor?.length) {
		facts.push(
			`- **Ancestor (anywhere above):** ${metadata.ancestor
				.map((name) => `\`${name}\``)
				.join(', ')}`
		);
	}
	if (metadata.allowedBlocks?.length) {
		facts.push(
			`- **Allowed inner blocks:** ${metadata.allowedBlocks
				.map((name) => `\`${name}\``)
				.join(', ')}`
		);
	}
	if (metadata.usesContext?.length) {
		facts.push(
			`- **Uses context:** ${metadata.usesContext
				.map((name) => `\`${name}\``)
				.join(', ')}`
		);
	}
	if (metadata.providesContext) {
		facts.push(
			`- **Provides context:** ${Object.entries(metadata.providesContext)
				.map(([key, attr]) => `\`${key}\` (from \`${attr}\`)`)
				.join(', ')}`
		);
	}
	if (metadata.supports && Object.keys(metadata.supports).length) {
		facts.push(
			`- **Supports:** \`${JSON.stringify(metadata.supports)}\``
		);
	}
	if (facts.length) {
		lines.push(...facts, '');
	}

	const attributes = Object.entries(metadata.attributes || {});
	if (attributes.length) {
		lines.push(
			'| Attribute | Type | Default | Allowed values |',
			'| --- | --- | --- | --- |'
		);
		for (const [name, schema] of attributes) {
			lines.push(
				`| \`${name}\` | ${escapeCell(formatType(schema))} | ${escapeCell(
					formatDefault(schema)
				)} | ${
					Array.isArray(schema.enum)
						? escapeCell(
								schema.enum
									.map((value) => `\`${value}\``)
									.join(', ')
						  )
						: '—'
				} |`
			);
		}
	} else {
		lines.push('This block declares no attributes of its own.');
	}
	lines.push('');

	return lines.join('\n');
}

function registrationText(doc) {
	const { condition, detail } = doc.registration;
	return detail ? `${condition} — ${detail}` : condition;
}

/**
 * Render a block's distributed README: authored guidance, availability,
 * generated reference, and the examples inline.
 *
 * @param {object} entry      Entry from collectEntries().
 * @param {string} pluginName Owning workspace.
 * @return {string} Markdown.
 */
export function renderBlockReadme(entry, pluginName) {
	const { doc, metadata } = entry;
	const title =
		entry.kind === 'variation'
			? `${metadata.title} (\`${doc.block}\` variation \`${doc.variation}\`)`
			: `${metadata.title} (\`${entry.name}\`)`;
	const lines = [`# ${title}`, ''];

	if (metadata.description) {
		lines.push(`> ${metadata.description}`, '');
	}

	lines.push(
		`- **Supplied by:** ${pluginName} (see \`${OUTPUT_DIR}/index.json\` for the release version)`,
		`- **Status:** ${doc.status}${
			doc.replacement ? ` — use \`${doc.replacement}\` instead` : ''
		}`,
		`- **Registration:** ${registrationText(doc)}`
	);
	if (doc.requires?.length) {
		lines.push(
			`- **Requires active plugins:** ${doc.requires.join(', ')}`
		);
	}
	lines.push('');

	lines.push(readFileSync(entry.guidePath, 'utf8').trim(), '');
	lines.push(renderReference(entry));

	lines.push('## Examples', '');
	for (const file of entry.exampleFiles) {
		const exampleName = file.slice(0, -5);
		const descriptor = doc.examples[exampleName];
		lines.push(
			`### ${descriptor.title} (\`examples/${file}\`)`,
			'',
			...(descriptor.description ? [descriptor.description, ''] : []),
			`Insert into: ${
				EXAMPLE_CONTEXT_LABELS[descriptor.context]
			}. Renders \`${descriptor.frontend}\` when its prerequisites are met.`,
			'',
			...Object.entries(descriptor.syntheticIds || {}).flatMap(
				([attribute, meaning], position) => [
					...(position === 0
						? [
								'Synthetic IDs — replace them with records from your site:',
								'',
						  ]
						: []),
					`- \`${attribute}\`: ${meaning}`,
				]
			),
			...(descriptor.syntheticIds ? [''] : []),
			'```html',
			readFileSync(join(entry.examplesDir, file), 'utf8').trim(),
			'```',
			''
		);
	}

	return `${lines.join('\n').trim()}\n`;
}

function entryOutputDir(entry) {
	return entry.kind === 'variation'
		? `${OUTPUT_DIR}/variations/${entry.doc.block}/${entry.doc.variation}`
		: `${OUTPUT_DIR}/${entry.name}`;
}

/**
 * Build the machine-readable index for a plugin.
 *
 * @param {string}   pluginName Workspace name.
 * @param {string}   version    Plugin version from the PHP header.
 * @param {object[]} entries    Entries from collectEntries().
 * @return {object} Index document.
 */
export function buildIndex(pluginName, version, entries) {
	const describe = (entry) => {
		const outDir = entryOutputDir(entry);
		const { doc } = entry;
		return {
			status: doc.status,
			registration: doc.registration,
			requires: doc.requires || [],
			guide: `${outDir}/README.md`,
			examples: entry.exampleFiles.map((file) => {
				const exampleName = file.slice(0, -5);
				const descriptor = doc.examples[exampleName];
				return {
					name: exampleName,
					title: descriptor.title,
					context: descriptor.context,
					path: `${outDir}/examples/${file}`,
					frontendSelector: descriptor.frontend,
					...(descriptor.syntheticIds
						? { syntheticIds: descriptor.syntheticIds }
						: {}),
				};
			}),
		};
	};

	const blocks = entries
		.filter((entry) => entry.kind !== 'variation')
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((entry) => ({
			name: entry.name,
			title: entry.metadata.title,
			ownerPlugin: pluginName,
			metadata:
				entry.kind === 'block'
					? `build/blocks/${entry.dirName}/block.json`
					: null,
			metadataSource:
				entry.kind === 'block'
					? 'block.json'
					: `php:${entry.doc.registeredIn}`,
			...describe(entry),
			...(entry.doc.replacement
				? { replacement: entry.doc.replacement }
				: {}),
		}));

	const variations = entries
		.filter((entry) => entry.kind === 'variation')
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((entry) => ({
			block: entry.doc.block,
			variation: entry.doc.variation,
			title: entry.metadata.title,
			ownerPlugin: pluginName,
			isActive: entry.doc.isActive,
			...describe(entry),
		}));

	return {
		schemaVersion: SCHEMA_VERSION,
		plugin: pluginName,
		pluginVersion: version,
		discovery: {
			shipped: 'Every entry in "blocks" and "variations" ships with this plugin release.',
			registered:
				'GET /wp/v2/block-types/<namespace>/<name> (authenticated, requires the edit_posts capability) reports whether a shipped block is registered on a site. Match its "name" against "blocks[].name"; the namespace alone does not identify the owning plugin.',
			available:
				'A registered block is only insertable where its parent/ancestor constraints, the parent block\'s allowed inner blocks, and the registration condition all permit it. See each guide.',
		},
		blocks,
		variations,
	};
}

/**
 * Render the overview README of a plugin's block-docs directory.
 *
 * @param {object} index Index from buildIndex().
 * @return {string} Markdown.
 */
export function renderOverview(index) {
	const lines = [
		`# ${index.plugin} block documentation`,
		'',
		`Machine-readable entry point: \`index.json\` (schema version ${index.schemaVersion}).`,
		'It records the plugin version these files ship with, every block the',
		'plugin supplies, the path to its block.json, its usage guide, and',
		'serialized examples. All paths are relative to the plugin directory.',
		'',
		'## Shipped, registered, and available',
		'',
		'- **Shipped:** listed in `index.json`. Shipping a block does not mean a site can use it.',
		'- **Registered:** WordPress knows the block on a given site. Check with the',
		'  authenticated core endpoint `GET /wp-json/wp/v2/block-types/<namespace>/<name>`',
		'  (or `GET /wp-json/wp/v2/block-types?namespace=<namespace>`), which requires',
		'  the `edit_posts` capability. Registration can depend on other active plugins',
		'  or feature flags; each entry\'s `registration` and `requires` say when.',
		'- **Available:** the editor offers the block in a particular place. A block',
		'  with `parent` or `ancestor` metadata, or a parent with a restricted list of',
		'  allowed inner blocks, is only insertable inside those parents, and a block',
		'  hidden from the inserter (`supports.inserter: false`) only renders existing',
		'  content. REST registration alone does not establish availability.',
		'',
		'Block names are not a reliable ownership signal: some blocks use another',
		"plugin's namespace. Use `ownerPlugin` in `index.json`.",
		'',
		'## Blocks',
		'',
		'| Block | Title | Status | Guide |',
		'| --- | --- | --- | --- |',
	];
	for (const block of index.blocks) {
		lines.push(
			`| \`${block.name}\` | ${escapeCell(block.title)} | ${
				block.status
			} | [README](${block.guide.slice(OUTPUT_DIR.length + 1)}) |`
		);
	}
	if (index.variations.length) {
		lines.push(
			'',
			'## Block variations',
			'',
			'| Block | Variation | Title | Guide |',
			'| --- | --- | --- | --- |'
		);
		for (const variation of index.variations) {
			lines.push(
				`| \`${variation.block}\` | \`${variation.variation}\` | ${escapeCell(
					variation.title
				)} | [README](${variation.guide.slice(
					OUTPUT_DIR.length + 1
				)}) |`
			);
		}
	}
	return `${lines.join('\n')}\n`;
}

function readVersion(rootDir, pluginName) {
	const phpFile = join(rootDir, pluginName, `${pluginName}.php`);
	const version = existsSync(phpFile)
		? parsePluginVersion(readFileSync(phpFile, 'utf8'))
		: null;
	if (!version) {
		throw new Error(`${pluginName}: no Version header in ${phpFile}`);
	}
	return version;
}

/**
 * Generate `<plugin>/block-docs/` from the documentation sources.
 *
 * @param {string} rootDir    Repository root.
 * @param {string} pluginName Workspace name.
 * @return {object} The written index.
 */
export function generate(rootDir, pluginName) {
	const errors = checkSources(rootDir, [pluginName]);
	if (errors.length) {
		const error = new Error(
			`Block documentation for ${pluginName} is invalid:\n  - ${errors.join(
				'\n  - '
			)}`
		);
		error.errors = errors;
		throw error;
	}

	const { plugins } = collectAll(rootDir);
	const entries = plugins.get(pluginName);
	const index = buildIndex(
		pluginName,
		readVersion(rootDir, pluginName),
		entries
	);

	const outRoot = join(rootDir, pluginName, OUTPUT_DIR);
	rmSync(outRoot, { recursive: true, force: true });

	for (const entry of entries) {
		const outDir = join(rootDir, pluginName, entryOutputDir(entry));
		mkdirSync(join(outDir, 'examples'), { recursive: true });
		writeFileSync(
			join(outDir, 'README.md'),
			renderBlockReadme(entry, pluginName)
		);
		for (const file of entry.exampleFiles) {
			writeFileSync(
				join(outDir, 'examples', file),
				readFileSync(join(entry.examplesDir, file), 'utf8')
			);
		}
	}

	writeFileSync(join(outRoot, 'README.md'), renderOverview(index));
	writeFileSync(
		join(outRoot, 'index.json'),
		`${JSON.stringify(index, null, '\t')}\n`
	);

	return index;
}

/**
 * Rewrite `pluginVersion` in a generated index from the plugin's PHP header.
 * A plugin without a generated index is skipped.
 *
 * @param {string} rootDir    Repository root.
 * @param {string} pluginName Workspace name.
 * @return {string|null} The recorded version, or null when skipped.
 */
export function refreshVersion(rootDir, pluginName) {
	const indexPath = join(rootDir, pluginName, OUTPUT_DIR, 'index.json');
	if (!existsSync(indexPath)) {
		return null;
	}
	const index = JSON.parse(readFileSync(indexPath, 'utf8'));
	index.pluginVersion = readVersion(rootDir, pluginName);
	writeFileSync(indexPath, `${JSON.stringify(index, null, '\t')}\n`);
	return index.pluginVersion;
}

/**
 * Verify a plugin archive ships complete, release-matched block docs.
 *
 * @param {object}   options
 * @param {string}   options.pluginName Workspace name.
 * @param {string[]} options.entries    Every file path in the archive.
 * @param {Function} options.readEntry  Reads one archive path as text.
 * @return {string[]} Errors.
 */
export function verifyArchiveDocs({ pluginName, entries, readEntry }) {
	const errors = [];
	const files = new Set(entries);
	const prefix = `${pluginName}/`;
	const indexPath = `${prefix}${OUTPUT_DIR}/index.json`;

	if (!files.has(indexPath)) {
		return [`${pluginName}: archive is missing ${indexPath}`];
	}

	let index;
	try {
		index = JSON.parse(readEntry(indexPath));
	} catch (error) {
		return [`${pluginName}: ${indexPath} is not valid JSON (${error.message})`];
	}

	if (index.schemaVersion !== SCHEMA_VERSION) {
		errors.push(
			`${pluginName}: ${indexPath} has schemaVersion ${index.schemaVersion}, expected ${SCHEMA_VERSION}`
		);
	}
	if (index.plugin !== pluginName) {
		errors.push(
			`${pluginName}: ${indexPath} names plugin "${index.plugin}"`
		);
	}

	const phpPath = `${prefix}${pluginName}.php`;
	const shippedVersion = files.has(phpPath)
		? parsePluginVersion(readEntry(phpPath))
		: null;
	if (!shippedVersion) {
		errors.push(`${pluginName}: cannot read the Version header of ${phpPath}`);
	} else if (index.pluginVersion !== shippedVersion) {
		errors.push(
			`${pluginName}: ${indexPath} records version ${index.pluginVersion}, but the plugin ships ${shippedVersion}`
		);
	}

	const requirePath = (path, what) => {
		if (!path || !files.has(`${prefix}${path}`)) {
			errors.push(
				`${pluginName}: ${what} "${path}" referenced by ${indexPath} is not in the archive`
			);
		}
	};

	const documentedMetadata = new Set();
	const items = [...(index.blocks || []), ...(index.variations || [])];
	if (!Array.isArray(index.blocks) || index.blocks.length === 0) {
		errors.push(`${pluginName}: ${indexPath} lists no blocks`);
	}

	for (const item of items) {
		const label = item.name || `${item.block} variation ${item.variation}`;
		if (!item.status || !item.registration) {
			errors.push(
				`${pluginName}: ${label} has no status or registration in ${indexPath}`
			);
		}
		if (item.name !== undefined) {
			if (item.ownerPlugin !== pluginName) {
				errors.push(
					`${pluginName}: ${label} is owned by "${item.ownerPlugin}" in ${indexPath}`
				);
			}
			if (item.metadata !== null) {
				requirePath(item.metadata, `${label} metadata`);
				documentedMetadata.add(`${prefix}${item.metadata}`);
				if (files.has(`${prefix}${item.metadata}`)) {
					const shipped = JSON.parse(
						readEntry(`${prefix}${item.metadata}`)
					);
					if (shipped.name !== item.name) {
						errors.push(
							`${pluginName}: ${item.metadata} declares "${shipped.name}", but ${indexPath} maps it to "${item.name}"`
						);
					}
				}
			}
		}
		requirePath(item.guide, `${label} guide`);
		if (!Array.isArray(item.examples) || item.examples.length === 0) {
			errors.push(`${pluginName}: ${label} has no examples in ${indexPath}`);
		} else {
			if (!item.examples.some((example) => example.name === 'minimal')) {
				errors.push(
					`${pluginName}: ${label} has no minimal example in ${indexPath}`
				);
			}
			for (const example of item.examples) {
				requirePath(example.path, `${label} example`);
			}
		}
	}

	const blockJsonPattern = new RegExp(
		`^${prefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}build/blocks/[^/]+/block\\.json$`
	);
	for (const path of entries) {
		if (blockJsonPattern.test(path) && !documentedMetadata.has(path)) {
			errors.push(
				`${pluginName}: ${path} ships without block documentation in ${indexPath}`
			);
		}
	}

	return errors;
}

function main(argv) {
	const [command, ...plugins] = argv;

	if (command === 'generate') {
		if (plugins.length !== 1) {
			console.error('Usage: node scripts/block-docs.mjs generate <plugin>');
			return 1;
		}
		try {
			const index = generate(DEFAULT_ROOT, plugins[0]);
			console.log(
				`${plugins[0]}: wrote ${OUTPUT_DIR}/ (${index.blocks.length} blocks, ${index.variations.length} variations, version ${index.pluginVersion})`
			);
			return 0;
		} catch (error) {
			console.error(error.message);
			return 1;
		}
	}

	if (command === 'check') {
		const errors = checkSources(DEFAULT_ROOT, plugins);
		if (errors.length) {
			console.error('Block documentation check failed:');
			for (const error of errors) {
				console.error(`  - ${error}`);
			}
			return 1;
		}
		const checked = plugins.length
			? plugins
			: findDocumentedPlugins(DEFAULT_ROOT);
		console.log(`✓ Block documentation is complete for ${checked.join(', ')}.`);
		return 0;
	}

	if (command === 'refresh-version') {
		const selected = plugins.length
			? plugins
			: findDocumentedPlugins(DEFAULT_ROOT);
		for (const pluginName of selected) {
			const version = refreshVersion(DEFAULT_ROOT, pluginName);
			console.log(
				version
					? `${pluginName}: ${OUTPUT_DIR}/index.json records ${version}`
					: `${pluginName}: no ${OUTPUT_DIR}/index.json, skipped`
			);
		}
		return 0;
	}

	console.error(
		'Usage: node scripts/block-docs.mjs <generate <plugin> | check [<plugin>...] | refresh-version [<plugin>...]>'
	);
	return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
	process.exitCode = main(process.argv.slice(2));
}
