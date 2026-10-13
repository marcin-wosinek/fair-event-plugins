/**
 * Read-only translation status reader for translate.wordpress.org (GlotPress).
 *
 * Reads the per-branch project API, which lists every translation set with
 * its status counts. Unlike `wporg.js` (PO exports merged across branches)
 * this keeps `stable` and `dev` apart and never touches local catalogs.
 */

import { access, readFile } from 'fs/promises';
import { join } from 'path';

export const SCHEMA_VERSION = 1;
export const BRANCHES = ['stable', 'dev'];
/** GlotPress locales reported unless a locale filter or all-locales is set. */
export const DEFAULT_LOCALES = ['pl', 'es', 'de', 'fr', 'en'];
export const LOCALE_SCOPE = {
	default: 'default',
	all: 'all',
	explicit: 'explicit',
};
export const CONCURRENCY = 3;
export const TIMEOUT_MS = 20000;
export const MAX_RETRIES = 2;
export const MAX_BACKOFF_MS = 8000;

const API_BASE = 'https://translate.wordpress.org/api/projects/wp-plugins';
const PAGE_BASE = 'https://translate.wordpress.org/projects/wp-plugins';
const USER_AGENT =
	'fair-event-plugins translation status report (https://github.com/marcin-wosinek/fair-event-plugins)';

/** Workspaces that are never WordPress.org plugins. */
const NON_PLUGIN_WORKSPACES = ['fair-events-shared'];

/**
 * Failure categories. The `missing-*` ones mean WordPress.org answered and
 * the thing is not there; the others mean we could not find out.
 */
export const CATEGORY = {
	network: 'network',
	http: 'http',
	parse: 'parse',
	missingProject: 'missing-project',
	missingBranch: 'missing-branch',
	missingLocale: 'missing-locale',
};

/** Invalid invocation or registry: reported before any request is made. */
export class UsageError extends Error {}

class RequestError extends Error {
	constructor(category, message, details = {}) {
		super(message);
		this.category = category;
		Object.assign(this, details);
	}
}

export function projectApiUrl(slug) {
	return `${API_BASE}/${slug}/`;
}

export function branchApiUrl(slug, branch) {
	return `${API_BASE}/${slug}/${branch}/`;
}

export function branchPageUrl(slug, branch) {
	return `${PAGE_BASE}/${slug}/${branch}/`;
}

export function setPageUrl(slug, branch, locale, variant) {
	return `${PAGE_BASE}/${slug}/${branch}/${locale}/${variant}/`;
}

/**
 * Check registry entries against the root workspace list and plugin main
 * files.
 *
 * @param {object}   registry             Parsed published-plugins.json.
 * @param {object}   context
 * @param {string[]} context.workspaces   Root package.json workspaces.
 * @param {Function} context.hasMainFile  (workspace) => boolean.
 * @returns {string[]} Problems; empty when the registry is valid.
 */
export function validateRegistry(registry, { workspaces, hasMainFile }) {
	const plugins = registry?.plugins;
	if (!plugins || typeof plugins !== 'object' || Array.isArray(plugins)) {
		return ['registry must be an object with a "plugins" map'];
	}

	const problems = [];
	const seenSlugs = new Map();
	for (const [workspace, slug] of Object.entries(plugins)) {
		if (NON_PLUGIN_WORKSPACES.includes(workspace)) {
			problems.push(`${workspace} is not a plugin workspace`);
			continue;
		}
		if (!workspaces.includes(workspace)) {
			problems.push(
				`${workspace} is not a workspace in the root package.json`
			);
			continue;
		}
		if (!hasMainFile(workspace)) {
			problems.push(
				`${workspace} has no plugin main file ${workspace}/${workspace}.php`
			);
		}
		if (typeof slug !== 'string' || !/^[a-z0-9-]+$/.test(slug)) {
			problems.push(`${workspace} has an invalid WordPress.org slug`);
			continue;
		}
		if (seenSlugs.has(slug)) {
			problems.push(
				`${workspace} and ${seenSlugs.get(
					slug
				)} share the WordPress.org slug ${slug}`
			);
		}
		seenSlugs.set(slug, workspace);
	}
	return problems;
}

/**
 * Load and validate the published-plugin registry from the repository.
 *
 * @returns {Promise<{plugins: {name: string, slug: string}[], workspaces: string[]}>}
 */
export async function loadPublishedPlugins(rootDir) {
	const registry = JSON.parse(
		await readFile(
			join(rootDir, 'scripts/translation/published-plugins.json'),
			'utf8'
		)
	);
	const { workspaces } = JSON.parse(
		await readFile(join(rootDir, 'package.json'), 'utf8')
	);

	const mainFiles = new Set();
	for (const workspace of workspaces) {
		try {
			await access(join(rootDir, workspace, `${workspace}.php`));
			mainFiles.add(workspace);
		} catch {
			// No main file: validateRegistry reports it if registered.
		}
	}

	const problems = validateRegistry(registry, {
		workspaces,
		hasMainFile: (workspace) => mainFiles.has(workspace),
	});
	if (problems.length > 0) {
		throw new UsageError(
			`Invalid scripts/translation/published-plugins.json:\n  - ${problems.join(
				'\n  - '
			)}`
		);
	}

	return {
		plugins: Object.entries(registry.plugins).map(([name, slug]) => ({
			name,
			slug,
		})),
		workspaces,
	};
}

/**
 * Narrow the published plugins to an optional `--plugin` filter. A filter
 * that matches nothing is an error, never a silent "all plugins".
 */
export function selectPlugins(plugins, workspaces, pluginFilter) {
	if (!pluginFilter) {
		return plugins;
	}
	const selected = plugins.filter((plugin) => plugin.name === pluginFilter);
	if (selected.length > 0) {
		return selected;
	}
	if (workspaces.includes(pluginFilter)) {
		throw new UsageError(
			`${pluginFilter} is a workspace but is not in the published-plugin registry (scripts/translation/published-plugins.json). Add it there once it is published on WordPress.org.`
		);
	}
	throw new UsageError(
		`Unknown plugin: ${pluginFilter}\nPublished plugins: ${plugins
			.map((plugin) => plugin.name)
			.join(', ')}`
	);
}

/**
 * Run at most `limit` tasks at once; the rest wait in FIFO order.
 */
export function createLimiter(limit) {
	let active = 0;
	const queue = [];
	const next = () => {
		if (active >= limit || queue.length === 0) {
			return;
		}
		active++;
		const { task, resolve, reject } = queue.shift();
		task()
			.then(resolve, reject)
			.finally(() => {
				active--;
				next();
			});
	};
	return (task) =>
		new Promise((resolve, reject) => {
			queue.push({ task, resolve, reject });
			next();
		});
}

function backoffMs(attempt, retryAfterHeader) {
	const retryAfter = Number(retryAfterHeader);
	const wanted =
		Number.isFinite(retryAfter) && retryAfter > 0
			? retryAfter * 1000
			: 500 * 2 ** attempt;
	return Math.min(wanted, MAX_BACKOFF_MS);
}

/**
 * GET a JSON document with a timeout and limited retries.
 *
 * Retries network failures, HTTP 429 and HTTP 5xx. A 404 is returned as
 * `{ notFound: true }` because the caller decides what is missing.
 *
 * @returns {Promise<{notFound: boolean, data?: any, retrievedAt: string, attempts: number}>}
 * @throws {RequestError} category network, http or parse.
 */
export async function fetchJson(url, io) {
	const { fetchImpl, sleep, now } = io;
	let failure;

	for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
		const attempts = attempt + 1;
		let retryAfter = null;
		let body;
		try {
			const response = await fetchImpl(url, {
				headers: {
					Accept: 'application/json',
					'User-Agent': USER_AGENT,
				},
				redirect: 'follow',
				signal: AbortSignal.timeout(TIMEOUT_MS),
			});
			if (response.status === 404) {
				return {
					notFound: true,
					retrievedAt: now().toISOString(),
					attempts,
				};
			}
			if (response.status === 429 || response.status >= 500) {
				retryAfter = response.headers?.get?.('retry-after') ?? null;
				throw new RequestError(
					CATEGORY.http,
					`HTTP ${response.status}`,
					{ httpStatus: response.status, retryable: true }
				);
			}
			if (response.status !== 200) {
				throw new RequestError(
					CATEGORY.http,
					`HTTP ${response.status}`,
					{ httpStatus: response.status }
				);
			}
			body = await response.text();
		} catch (error) {
			failure =
				error instanceof RequestError
					? error
					: new RequestError(
							CATEGORY.network,
							error?.name === 'TimeoutError'
								? `Timed out after ${TIMEOUT_MS / 1000}s`
								: `Network error: ${error?.message ?? error}`,
							{ retryable: true }
					  );
			failure.attempts = attempts;
			if (!failure.retryable || attempt === MAX_RETRIES) {
				throw failure;
			}
			await sleep(backoffMs(attempt, retryAfter));
			continue;
		}

		try {
			return {
				notFound: false,
				data: JSON.parse(body),
				retrievedAt: now().toISOString(),
				attempts,
			};
		} catch {
			throw new RequestError(
				CATEGORY.parse,
				'Response is not valid JSON',
				{ attempts }
			);
		}
	}
	throw failure;
}

function parseError(message) {
	return new RequestError(CATEGORY.parse, message);
}

function isAbsent(value) {
	return value === undefined || value === null;
}

/** A count is a non-negative integer, or null when GlotPress omits it. */
function readCount(set, field, label) {
	const value = set[field];
	if (isAbsent(value)) {
		return null;
	}
	if (!Number.isInteger(value) || value < 0) {
		throw parseError(`${label}: ${field} is not a non-negative integer`);
	}
	return value;
}

function readPercent(set, label) {
	const value = set.percent_translated;
	if (isAbsent(value)) {
		return null;
	}
	if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
		throw parseError(`${label}: percent_translated is not a number`);
	}
	return value;
}

/**
 * Validate a branch API response and turn its translation sets into rows.
 * Absent metrics become null; genuine zeros stay zero.
 *
 * @throws {RequestError} category parse on an unexpected structure.
 */
export function parseTranslationSets(data) {
	if (!data || typeof data !== 'object' || Array.isArray(data)) {
		throw parseError('Response is not a JSON object');
	}
	if (!Array.isArray(data.translation_sets)) {
		throw parseError('Response has no translation_sets array');
	}

	return data.translation_sets.map((set, index) => {
		const label = `translation_sets[${index}]`;
		if (!set || typeof set !== 'object') {
			throw parseError(`${label} is not an object`);
		}
		if (typeof set.locale !== 'string' || set.locale === '') {
			throw parseError(`${label}: locale is missing`);
		}
		if (typeof set.slug !== 'string' || set.slug === '') {
			throw parseError(`${label}: slug is missing`);
		}
		if (!isAbsent(set.wp_locale) && typeof set.wp_locale !== 'string') {
			throw parseError(`${label}: wp_locale is not a string`);
		}

		return {
			locale: set.locale,
			wpLocale: set.wp_locale || null,
			variant: set.slug,
			name: typeof set.name === 'string' ? set.name : null,
			approved: readCount(set, 'current_count', label),
			waiting: readCount(set, 'waiting_count', label),
			fuzzy: readCount(set, 'fuzzy_count', label),
			untranslated: readCount(set, 'untranslated_count', label),
			total: readCount(set, 'all_count', label),
			percentApproved: readPercent(set, label),
		};
	});
}

/**
 * Does a set match a `--locale` filter? Accepts the GlotPress locale
 * (`de`, matching every variant) or the WordPress locale (`de_DE_formal`).
 */
export function matchesLocale(set, localeFilter) {
	if (!localeFilter) {
		return true;
	}
	const wanted = localeFilter.toLowerCase();
	return (
		set.locale.toLowerCase() === wanted ||
		(set.wpLocale !== null && set.wpLocale.toLowerCase() === wanted)
	);
}

/**
 * Work out which locales a report covers. An explicit filter replaces the
 * default list; `locales: null` means every remote locale.
 *
 * @returns {{localeScope: string, locales: string[]|null}}
 * @throws {UsageError} when both a locale filter and all-locales are given.
 */
export function resolveLocaleScope({ locale = null, allLocales = false }) {
	if (locale && allLocales) {
		throw new UsageError('--all-locales cannot be combined with --locale');
	}
	if (locale) {
		return { localeScope: LOCALE_SCOPE.explicit, locales: [locale] };
	}
	if (allLocales) {
		return { localeScope: LOCALE_SCOPE.all, locales: null };
	}
	return { localeScope: LOCALE_SCOPE.default, locales: DEFAULT_LOCALES };
}

/**
 * Fetch translation status for the given plugins and branches.
 *
 * Never throws for remote problems: successful rows and structured errors
 * are returned side by side.
 *
 * @param {object}   options
 * @param {{name: string, slug: string}[]} options.plugins
 * @param {string[]} options.branches       Subset of BRANCHES.
 * @param {string}   [options.locale]       Locale filter; replaces the
 *                                          default locales.
 * @param {boolean}  [options.allLocales]   Report every remote locale.
 * @param {Function} [options.fetchImpl]    fetch replacement (tests).
 * @param {Function} [options.sleep]        (ms) => Promise (tests).
 * @param {Function} [options.now]          () => Date (tests).
 */
export async function collectStatus({
	plugins,
	branches,
	locale = null,
	allLocales = false,
	fetchImpl = fetch,
	sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
	now = () => new Date(),
}) {
	const { localeScope, locales } = resolveLocaleScope({ locale, allLocales });
	const limit = createLimiter(CONCURRENCY);
	const io = { fetchImpl, sleep, now };
	const get = (url) => limit(() => fetchJson(url, io));

	// One parent lookup per plugin, shared by both branches.
	const parentLookups = new Map();
	const getParent = (slug) => {
		if (!parentLookups.has(slug)) {
			parentLookups.set(slug, get(projectApiUrl(slug)));
		}
		return parentLookups.get(slug);
	};

	/** Why did the branch 404: no project at all, or just no such branch? */
	const diagnoseMissing = async (plugin, branch) => {
		const url = projectApiUrl(plugin.slug);
		let parent;
		try {
			parent = await getParent(plugin.slug);
		} catch (error) {
			// The lookup is shared between branches: wrap, don't mutate.
			throw new RequestError(
				error.category,
				`Could not tell whether the project or the branch is missing: ${error.message}`,
				{ url, httpStatus: error.httpStatus, attempts: error.attempts }
			);
		}
		if (parent.notFound) {
			return new RequestError(
				CATEGORY.missingProject,
				`No translation project for ${plugin.slug} on WordPress.org`,
				{ url, httpStatus: 404, attempts: parent.attempts }
			);
		}
		if (!Array.isArray(parent.data?.sub_projects)) {
			throw new RequestError(
				CATEGORY.parse,
				'Could not tell whether the project or the branch is missing: project response has no sub_projects array',
				{ url }
			);
		}
		return new RequestError(
			CATEGORY.missingBranch,
			`Project ${plugin.slug} exists but has no ${branch} branch`,
			{ httpStatus: 404 }
		);
	};

	const readBranch = async (plugin, branch) => {
		const sourceUrl = branchApiUrl(plugin.slug, branch);
		const identity = { plugin: plugin.name, slug: plugin.slug, branch };
		try {
			const response = await get(sourceUrl);
			if (response.notFound) {
				throw await diagnoseMissing(plugin, branch);
			}

			const sets = parseTranslationSets(response.data);
			const matched = locales
				? sets.filter((set) =>
						locales.some((wanted) => matchesLocale(set, wanted))
				  )
				: sets;
			if (locale && matched.length === 0) {
				throw new RequestError(
					CATEGORY.missingLocale,
					`No translation set for locale ${locale} in ${plugin.slug}/${branch}`
				);
			}

			return {
				response: {
					...identity,
					sourceUrl,
					url: branchPageUrl(plugin.slug, branch),
					retrievedAt: response.retrievedAt,
					setCount: sets.length,
					matchedCount: matched.length,
				},
				rows: matched.map((set) => ({
					...identity,
					...set,
					url: setPageUrl(
						plugin.slug,
						branch,
						set.locale,
						set.variant
					),
					sourceUrl,
					retrievedAt: response.retrievedAt,
				})),
			};
		} catch (error) {
			if (!(error instanceof RequestError)) {
				throw error;
			}
			return {
				error: {
					category: error.category,
					...identity,
					locale,
					url: error.url ?? sourceUrl,
					httpStatus: error.httpStatus ?? null,
					attempts: error.attempts ?? null,
					message: error.message,
				},
			};
		}
	};

	const generatedAt = now().toISOString();
	const outcomes = await Promise.all(
		plugins.flatMap((plugin) =>
			branches.map((branch) => readBranch(plugin, branch))
		)
	);

	return {
		schemaVersion: SCHEMA_VERSION,
		generatedAt,
		source: 'https://translate.wordpress.org/',
		filters: {
			plugins: plugins.map((plugin) => plugin.name),
			branches,
			locale,
			localeScope,
			locales,
		},
		responses: outcomes.flatMap((o) => (o.response ? [o.response] : [])),
		results: outcomes.flatMap((o) => o.rows ?? []),
		errors: outcomes.flatMap((o) => (o.error ? [o.error] : [])),
	};
}

/** Nonzero when anything requested could not be reported. */
export function exitCodeFor(report) {
	return report.errors.length > 0 ? 1 : 0;
}

function cell(value, suffix = '') {
	return value === null ? 'unavailable' : `${value}${suffix}`;
}

function table(rows) {
	const widths = rows[0].map((_, column) =>
		Math.max(...rows.map((row) => row[column].length))
	);
	return rows
		.map((row) =>
			row
				.map((text, column) => text.padEnd(widths[column]))
				.join('  ')
				.trimEnd()
		)
		.join('\n');
}

function localeScopeLabel({ localeScope, locales }) {
	if (localeScope === LOCALE_SCOPE.all) {
		return 'every remote locale (--all-locales)';
	}
	if (localeScope === LOCALE_SCOPE.explicit) {
		return `${locales.join(', ')} (--locale)`;
	}
	return `${locales.join(
		', '
	)} (default; --all-locales reports every remote locale)`;
}

/**
 * Render the report for a terminal.
 */
export function formatText(report) {
	const lines = [
		'WordPress.org translation status',
		`Retrieved: ${report.generatedAt}`,
		`Locales: ${localeScopeLabel(report.filters)}`,
	];

	for (const response of report.responses) {
		const rows = report.results.filter(
			(row) =>
				row.plugin === response.plugin && row.branch === response.branch
		);
		lines.push(
			'',
			`${response.plugin} — ${response.branch}`,
			`${response.url}  (set pages: <locale>/<variant>/)`
		);
		if (rows.length === 0) {
			lines.push(
				response.setCount === 0
					? 'No translation sets returned.'
					: `No translation sets for the selected locales (${response.setCount} sets in other locales).`
			);
			continue;
		}
		lines.push(
			table([
				[
					'Locale',
					'WP locale',
					'Variant',
					'Approved %',
					'Approved',
					'Waiting',
					'Fuzzy',
					'Untranslated',
				],
				...rows.map((row) => [
					row.locale,
					row.wpLocale ?? '-',
					row.variant,
					cell(row.percentApproved, '%'),
					cell(row.approved),
					cell(row.waiting),
					cell(row.fuzzy),
					cell(row.untranslated),
				]),
			]),
			`${rows.length} translation sets; ${
				rows.filter((row) => row.approved > 0).length
			} with approved strings, ${
				rows.filter((row) => row.waiting > 0).length
			} with strings waiting for review.`
		);
	}

	if (report.errors.length > 0) {
		lines.push('', `Failed requests (${report.errors.length}):`);
		for (const error of report.errors) {
			lines.push(
				`- [${error.category}] ${error.plugin} ${error.branch}: ${error.message} (${error.url})`
			);
		}
	}

	return lines.join('\n');
}
