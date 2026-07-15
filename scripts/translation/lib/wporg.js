/**
 * Shared helpers for talking to translate.wordpress.org (GlotPress).
 */

import { parsePOContent } from './po-parser.js';

/**
 * Unique key for a translation entry (context + source string).
 */
export function entryKey(entry) {
	return `${entry.msgctxt || ''}${entry.msgid}`;
}

/**
 * Is a msgstr value a real translation (non-empty)?
 *
 * @param {string|string[]} msgstr
 * @returns {boolean}
 */
export function isTranslated(msgstr) {
	if (Array.isArray(msgstr)) {
		return msgstr.some((s) => s && s.trim() !== '');
	}
	return Boolean(msgstr && msgstr.trim() !== '');
}

/**
 * Are two msgstr values equal (handles singular strings and plural arrays)?
 */
export function msgstrEqual(a, b) {
	if (Array.isArray(a) || Array.isArray(b)) {
		const aa = Array.isArray(a) ? a : [a];
		const bb = Array.isArray(b) ? b : [b];
		if (aa.length !== bb.length) return false;
		return aa.every((v, i) => (v || '') === (bb[i] || ''));
	}
	return (a || '') === (b || '');
}

/**
 * Build a GlotPress export URL for a plugin/set/locale.
 */
function exportUrl(slug, set, wpLocale) {
	return `https://translate.wordpress.org/projects/wp-plugins/${slug}/${set}/${wpLocale}/default/export-translations?format=po`;
}

/**
 * Download and parse one GlotPress set into a Map keyed by entryKey.
 * Only non-empty translations are included.
 *
 * @returns {Promise<Map<string, string|string[]>|null>} null when the set
 *   has no GlotPress project (404).
 */
async function fetchSet(slug, set, wpLocale) {
	const url = exportUrl(slug, set, wpLocale);
	const res = await fetch(url, { redirect: 'follow' });

	// A 404 means this plugin/locale has no GlotPress project on
	// WordPress.org (e.g. not published there yet) — treat as "no data",
	// not a failure.
	if (res.status === 404) {
		return null;
	}
	if (!res.ok) {
		throw new Error(`HTTP ${res.status} for ${url}`);
	}

	const text = await res.text();
	const parsed = parsePOContent(text);

	const map = new Map();
	for (const entry of parsed.translations) {
		if (entry.isHeader || entry.msgid === undefined) continue;
		if (!isTranslated(entry.msgstr)) continue;
		map.set(entryKey(entry), entry.msgstr);
	}
	return map;
}

/**
 * Fetch the requested set(s) and merge them. When both sets are requested,
 * `dev` overrides `stable` (dev tracks trunk / newest community work).
 *
 * @returns {Promise<Map<string, string|string[]>|null>} null when neither
 *   set exists on WordPress.org (project not hosted there).
 */
export async function fetchCommunity(slug, setOption, wpLocale) {
	const sets = setOption === 'both' ? ['stable', 'dev'] : [setOption];
	const merged = new Map();
	let anyFound = false;
	for (const set of sets) {
		const map = await fetchSet(slug, set, wpLocale);
		if (map === null) continue; // set has no GlotPress project
		anyFound = true;
		for (const [key, value] of map) {
			merged.set(key, value);
		}
	}
	// No set existed on WordPress.org at all → signal "not hosted".
	return anyFound ? merged : null;
}
