/**
 * Quote markers for AI translation
 *
 * German and Polish use „…“ / „…” quotation marks. Asked to write them, the
 * model tends to close the quote with an ASCII `"`, which ends the JSON
 * string early and cuts the translation off after the opening „. For those
 * locales the prose quotes in the source are swapped for numbered marker
 * tokens before the request, and the script — not the model — turns the
 * markers back into the locale's quotation marks afterwards.
 *
 * Only paired prose quotes are replaced. HTML attribute delimiters,
 * apostrophes, unpaired quotes and technical values such as
 * `"appointment_slot"` or `"image/*"` are sent unchanged.
 */

/** Typographic quotes per locale that uses markers. */
export const QUOTE_LOCALES = {
	de_DE: { open: '„', close: '“' },
	pl_PL: { open: '„', close: '”' },
};

/**
 * Marker styles in order of preference. A style is only used when none of
 * the batch's source texts already contains something that looks like one
 * of its markers.
 */
export const MARKER_STYLES = [
	{ left: '{{', right: '}}' },
	{ left: '[[', right: ']]' },
	{ left: '⟦', right: '⟧' },
];

// Characters that make a quoted value look like code rather than prose.
const TECHNICAL_CONTENT = /[_*/\\=<>{}]|^\./;

// What may sit right before an opening / right after a closing ASCII quote.
const BEFORE_OPEN = /[\s([{—–\-/]/;
const AFTER_CLOSE = /[\s.,;:!?)\]}…—–\-'’<]/;

const ASCII_QUOTE = '"';

/**
 * Error raised when a batch cannot be prepared (no marker style is free).
 */
export class MarkerCollisionError extends Error {}

function escapeRegExp(str) {
	return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function openMarker(style, n) {
	return `${style.left}Q${n}${style.right}`;
}

function closeMarker(style, n) {
	return `${style.left}/Q${n}${style.right}`;
}

/**
 * Regex matching any well-formed marker of a style; group 1 is `/` for a
 * closing marker, group 2 the span number.
 */
function markerPattern(style) {
	return new RegExp(
		`${escapeRegExp(style.left)}(/?)Q(\\d+)${escapeRegExp(style.right)}`,
		'g'
	);
}

/**
 * Regex matching a fragment that starts like a marker of a style, to catch
 * markers the model mangled (missing bracket, lowercase q, …).
 */
function markerFragmentPattern(style) {
	return new RegExp(`${escapeRegExp(style.left)}\\s*/?\\s*[Qq]`);
}

function collides(style, text) {
	return markerFragmentPattern(style).test(text);
}

/**
 * Mark which character offsets sit inside an HTML tag (`<…>`), whose
 * attribute quotes must never be treated as prose.
 */
function tagMask(text) {
	const mask = new Array(text.length).fill(false);
	for (const match of text.matchAll(/<[^<>]*>/g)) {
		for (let i = match.index; i < match.index + match[0].length; i++) {
			mask[i] = true;
		}
	}
	return mask;
}

/**
 * Find the paired prose quotes in a source string.
 *
 * @param {string} text - Source text
 * @returns {Array<{start: number, end: number}>} Offsets of opening and
 *   closing quote characters, in order
 */
export function findQuoteSpans(text) {
	const inTag = tagMask(text);
	const spans = [];
	let open = null;

	for (let i = 0; i < text.length; i++) {
		if (inTag[i]) continue;
		const ch = text[i];
		const prev = i > 0 ? text[i - 1] : '';
		const next = i + 1 < text.length ? text[i + 1] : '';

		// “ opens an English quote but closes a German „…“ one.
		const closesGerman = ch === '“' && open?.char === '„';
		if ((ch === '“' && !closesGerman) || ch === '„') {
			open = { start: i, kind: 'typographic', char: ch };
			continue;
		}
		if (ch === '”' || closesGerman) {
			if (open?.kind === 'typographic') {
				spans.push({ start: open.start, end: i });
			}
			open = null;
			continue;
		}
		if (ch !== ASCII_QUOTE) continue;

		const canClose =
			open?.kind === 'ascii' &&
			prev !== '' &&
			!/\s/.test(prev) &&
			(next === '' || AFTER_CLOSE.test(next));
		if (canClose) {
			const content = text.slice(open.start + 1, i);
			if (!TECHNICAL_CONTENT.test(content)) {
				spans.push({ start: open.start, end: i });
			}
			open = null;
			continue;
		}

		const canOpen =
			(prev === '' || BEFORE_OPEN.test(prev)) &&
			next !== '' &&
			!/\s/.test(next);
		open = canOpen ? { start: i, kind: 'ascii' } : null;
	}

	return spans;
}

/**
 * Replace a source string's prose quotes with numbered markers.
 *
 * @param {string} text - Source text
 * @param {Object} style - Marker style
 * @returns {{text: string, count: number, literalQuotes: number}} Marked
 *   text, number of quote spans, and ASCII `"` characters left as they are
 */
export function markQuotes(text, style) {
	const spans = findQuoteSpans(text);
	const replacements = new Map();
	spans.forEach((span, idx) => {
		replacements.set(span.start, openMarker(style, idx + 1));
		replacements.set(span.end, closeMarker(style, idx + 1));
	});

	let marked = '';
	for (let i = 0; i < text.length; i++) {
		marked += replacements.has(i) ? replacements.get(i) : text[i];
	}

	return {
		text: marked,
		count: spans.length,
		literalQuotes: countAscii(marked),
	};
}

function countAscii(text) {
	return text.split(ASCII_QUOTE).length - 1;
}

/**
 * Pick the first marker style none of the texts collides with.
 *
 * @param {Array<string>} texts - All source texts of one request
 * @returns {Object} Marker style
 * @throws {MarkerCollisionError} When every style collides
 */
export function chooseMarkerStyle(texts) {
	const style = MARKER_STYLES.find((candidate) =>
		texts.every((text) => !collides(candidate, text || ''))
	);
	if (!style) {
		throw new MarkerCollisionError(
			'marker collision: the source already contains text shaped like every quote marker style'
		);
	}
	return style;
}

/**
 * Whether a locale's translations go through quote markers.
 *
 * @param {string} locale - Target locale code
 * @returns {boolean}
 */
export function usesQuoteMarkers(locale) {
	return Boolean(QUOTE_LOCALES[locale]);
}

/**
 * Prepare one request's entries for the provider.
 *
 * For marker locales, each source text is marked; for other locales the
 * texts pass through unchanged (count 0), so the same validation applies.
 *
 * @param {Array<Object>} entries - PO entries (msgid, msgidPlural, …)
 * @param {string} locale - Target locale code
 * @returns {{style: Object|null, items: Array<Object>}} items[i] has
 *   `msgid` and `msgidPlural` as marked source objects
 * @throws {MarkerCollisionError} When no marker style is free
 */
export function prepareEntries(entries, locale) {
	const style = usesQuoteMarkers(locale)
		? chooseMarkerStyle(
				entries.flatMap((e) => [e.msgid, e.msgidPlural || ''])
			)
		: null;

	const prepare = (text) =>
		style
			? markQuotes(text, style)
			: { text, count: 0, literalQuotes: countAscii(text) };

	return {
		style,
		items: entries.map((entry) => ({
			msgid: prepare(entry.msgid),
			msgidPlural: entry.msgidPlural ? prepare(entry.msgidPlural) : null,
		})),
	};
}

/**
 * Prompt lines describing the markers, or '' when the locale has none.
 *
 * @param {string} locale - Target locale code
 * @param {Object|null} style - Marker style of the request
 * @returns {string}
 */
export function markerInstructions(locale, style) {
	if (!style) return '';
	const open = openMarker(style, 1);
	const close = closeMarker(style, 1);
	return `Some strings contain quotation markers such as ${open} and ${close}.
Each pair stands for quotation marks around the text between them. Keep every
marker exactly once and unchanged, around the translation of the text it
encloses, with the opening marker before the closing one. Never write
quotation mark characters (", „, “, ”) for these quotes yourself: the markers
are turned into the correct ${QUOTE_LOCALES[locale].open}…${
		QUOTE_LOCALES[locale].close
	} quotes afterwards. Any other ASCII " already present in the input must be
kept as it is.`;
}

/**
 * Validate a model translation of one marked source text and restore the
 * locale's quotation marks.
 *
 * @param {*} translation - Value returned by the model
 * @param {Object} source - Marked source from prepareEntries
 * @param {string} locale - Target locale code
 * @param {Object|null} style - Marker style of the request
 * @returns {{ok: true, text: string}|{ok: false, reason: string}}
 */
export function restoreQuotes(translation, source, locale, style) {
	if (typeof translation !== 'string') {
		return {
			ok: false,
			reason: `expected a string, got ${
				translation === null ? 'null' : typeof translation
			}`,
		};
	}
	if (translation.trim() === '') {
		return { ok: false, reason: 'empty translation' };
	}

	// An ASCII `"` used to close a „…” quote ends the JSON string early,
	// leaving a translation cut off after the opening „.
	const openings = (translation.match(/„/g) || []).length;
	const closings = (translation.match(/[”“]/g) || []).length;
	if (openings > closings) {
		return {
			ok: false,
			reason: `truncated at an opening quote: ${translation}`,
		};
	}

	let text = translation;
	if (style) {
		const pairs = new Map();
		for (const match of translation.matchAll(markerPattern(style))) {
			const n = Number(match[2]);
			const kind = match[1] === '/' ? 'close' : 'open';
			if (n < 1 || n > source.count) {
				return {
					ok: false,
					reason: `unexpected marker ${match[0]}`,
				};
			}
			const pair = pairs.get(n) || {};
			if (pair[kind] !== undefined) {
				return {
					ok: false,
					reason: `duplicated marker ${match[0]}`,
				};
			}
			pair[kind] = match.index;
			pairs.set(n, pair);
		}

		const spans = [];
		for (let n = 1; n <= source.count; n++) {
			const pair = pairs.get(n);
			if (!pair || pair.open === undefined || pair.close === undefined) {
				return {
					ok: false,
					reason: `missing marker for quote ${n}`,
				};
			}
			if (pair.open > pair.close) {
				return {
					ok: false,
					reason: `quote ${n} closes before it opens`,
				};
			}
			spans.push(pair);
		}
		const overlapping = spans.some((a) =>
			spans.some((b) => a !== b && a.open < b.open && b.open < a.close)
		);
		if (overlapping) {
			return { ok: false, reason: 'quotes overlap' };
		}

		const { open, close } = QUOTE_LOCALES[locale];
		text = translation.replace(markerPattern(style), (_, slash) =>
			slash ? close : open
		);
		if (collides(style, text)) {
			return { ok: false, reason: 'malformed marker' };
		}
	}

	// Other locales keep today's behaviour for ASCII quotes.
	if (style && countAscii(text) > source.literalQuotes) {
		return {
			ok: false,
			reason: `unexpected ASCII quote: ${translation}`,
		};
	}

	return { ok: true, text };
}

/**
 * Validate one plural entry's forms and restore their quotation marks.
 * The entry is one unit: every form must pass.
 *
 * @param {*} forms - Value returned by the model for this entry
 * @param {Object} item - Prepared item from prepareEntries
 * @param {number} nplurals - Number of plural forms the locale needs
 * @param {string} locale - Target locale code
 * @param {Object|null} style - Marker style of the request
 * @returns {{ok: true, forms: string[]}|{ok: false, reason: string}}
 */
export function restorePluralQuotes(forms, item, nplurals, locale, style) {
	if (!Array.isArray(forms) || forms.length !== nplurals) {
		return {
			ok: false,
			reason: `expected ${nplurals} plural forms, got ${
				Array.isArray(forms) ? forms.length : typeof forms
			}`,
		};
	}

	const restored = [];
	for (let i = 0; i < forms.length; i++) {
		// Form 0 translates the singular, the rest the plural; accept either
		// source in case the two quote a different number of spans.
		const sources =
			i === 0
				? [item.msgid, item.msgidPlural]
				: [item.msgidPlural, item.msgid];
		const attempts = sources.map((source) =>
			restoreQuotes(forms[i], source, locale, style)
		);
		const passed = attempts.find((attempt) => attempt.ok);
		if (!passed) {
			return {
				ok: false,
				reason: `plural form ${i}: ${attempts[0].reason}`,
			};
		}
		restored.push(passed.text);
	}

	return { ok: true, forms: restored };
}
