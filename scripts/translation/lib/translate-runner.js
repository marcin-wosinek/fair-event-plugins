/**
 * AI translation orchestration
 *
 * Sends untranslated entries to a provider in batches and owns every retry:
 * each batch is sent once, valid entries are kept, and each failed entry is
 * retried on its own at most RETRIES_PER_ENTRY more times. An entry that
 * still fails is left untranslated and reported, and the run continues.
 */

/** Additional individual attempts for an entry that failed in its batch. */
export const RETRIES_PER_ENTRY = 2;

/**
 * Translate entries of one kind (singular or plural).
 *
 * @param {Array<Object>} entries - PO entries to translate
 * @param {Object} options
 * @param {Function} options.translate - (entries) => Promise<{results, usage}>
 * @param {number} options.batchSize - Entries per batch request
 * @param {string} options.kind - 'string' or 'plural' (for logging)
 * @param {Function} [options.log] - Progress logger
 * @returns {Promise<Object>} { translated: [{entry, translation}],
 *   failures: [{entry, reason}], cost }
 */
export async function translateEntries(
	entries,
	{ translate, batchSize, kind, log = () => {} }
) {
	const translated = [];
	const failures = [];
	let cost = 0;

	/**
	 * Run one request; never throws.
	 *
	 * @returns {Promise<Array<Object>>} One { ok, translation|reason } per entry
	 */
	const attempt = async (batch) => {
		try {
			const { results, usage } = await translate(batch);
			cost += usage?.cost || 0;
			return results;
		} catch (error) {
			cost += error.usage?.cost || 0;
			return batch.map(() => ({ ok: false, reason: error.message }));
		}
	};

	const totalBatches = Math.ceil(entries.length / batchSize);
	for (let i = 0; i < entries.length; i += batchSize) {
		const batch = entries.slice(i, i + batchSize);
		log(
			`🔄 Processing ${kind} batch ${
				Math.floor(i / batchSize) + 1
			}/${totalBatches} (${batch.length} strings)...`
		);

		const results = await attempt(batch);
		const pending = [];
		batch.forEach((entry, idx) => {
			if (results[idx]?.ok) {
				translated.push({
					entry,
					translation: results[idx].translation,
				});
			} else {
				pending.push({
					entry,
					reason: results[idx]?.reason || 'no result returned',
				});
			}
		});

		log(
			`   ${pending.length ? '⚠️ ' : '✅'} ${
				batch.length - pending.length
			}/${batch.length} translated`
		);

		for (const failed of pending) {
			let reason = failed.reason;
			let done = false;
			for (let retry = 1; retry <= RETRIES_PER_ENTRY && !done; retry++) {
				log(
					`   ↻ Retry ${retry}/${RETRIES_PER_ENTRY} (${reason}): ${failed.entry.msgid}`
				);
				const [result] = await attempt([failed.entry]);
				if (result?.ok) {
					translated.push({
						entry: failed.entry,
						translation: result.translation,
					});
					done = true;
				} else {
					reason = result?.reason || 'no result returned';
				}
			}
			if (!done) {
				log(
					`   ❌ Left untranslated (${reason}): ${failed.entry.msgid}`
				);
				failures.push({ entry: failed.entry, reason });
			}
		}
	}

	return { translated, failures, cost };
}

/**
 * Write translations into their PO entries. Plural forms that already hold
 * a translation are kept; only empty forms are filled.
 *
 * @param {Array<Object>} translated - [{entry, translation}]
 */
export function applyTranslations(translated) {
	for (const { entry, translation } of translated) {
		if (Array.isArray(translation)) {
			const existing = Array.isArray(entry.msgstr) ? entry.msgstr : [];
			entry.msgstr = translation.map((form, i) =>
				existing[i] && existing[i].trim() !== '' ? existing[i] : form
			);
		} else if (!entry.msgstr || entry.msgstr.trim() === '') {
			entry.msgstr = translation;
		}
	}
}

/**
 * Format the strings left untranslated, one block per string.
 *
 * @param {Array<Object>} failures - [{plugin, locale, entry, reason}]
 * @returns {string[]} Lines to print; empty when nothing failed
 */
export function formatFailures(failures) {
	if (failures.length === 0) return [];

	const lines = [
		`⚠️  ${failures.length} string(s) left untranslated — translate them by hand:`,
	];
	for (const { plugin, locale, entry, reason } of failures) {
		lines.push(`   • ${plugin} ${locale}`);
		if (entry.msgctxt) {
			lines.push(`     context: ${entry.msgctxt}`);
		}
		lines.push(`     msgid: ${entry.msgid}`);
		if (entry.msgidPlural) {
			lines.push(`     msgid_plural: ${entry.msgidPlural}`);
		}
		lines.push(`     reason: ${reason}`);
	}
	return lines;
}
