import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';

import { getProvider } from '../translation/lib/ai-providers.js';
import { parsePOContent, parsePOFile } from '../translation/lib/po-parser.js';
import { writePOFile } from '../translation/lib/po-writer.js';
import {
	MARKER_STYLES,
	findQuoteSpans,
	markQuotes,
	prepareEntries,
} from '../translation/lib/quote-markers.js';
import {
	RETRIES_PER_ENTRY,
	applyTranslations,
	formatFailures,
	translateEntries,
} from '../translation/lib/translate-runner.js';

process.env.OPENAI_API_KEY = 'test-openai-key';
process.env.ANTHROPIC_API_KEY = 'test-anthropic-key';

const CURLY = MARKER_STYLES[0];
const USAGE = { cost: 0.001 };

/** Pull the input array a provider embedded in its user prompt. */
function promptInputs(body) {
	const prompt = body.messages.find((m) => m.role === 'user').content;
	const match = prompt.match(/\n(\[\n[\s\S]*?\n\])\n/);
	return { prompt, inputs: JSON.parse(match[1]) };
}

/**
 * Replace fetch with a fake provider. `respond` gets the parsed request body
 * and returns the provider's translations payload; `wrap` turns that into
 * the provider's response shape.
 */
function mockProvider(name, respond) {
	const requests = [];
	globalThis.fetch = async (url, init) => {
		const body = JSON.parse(init.body);
		requests.push(body);
		const translations = respond(body, requests.length);
		const data =
			name === 'openai'
				? {
						choices: [
							{
								message: {
									content: JSON.stringify({ translations }),
								},
							},
						],
						usage: {
							prompt_tokens: 100,
							completion_tokens: 50,
							total_tokens: 150,
						},
					}
				: {
						content: [
							{ type: 'tool_use', input: { translations } },
						],
						usage: { input_tokens: 100, output_tokens: 50 },
					};
		return { ok: true, json: async () => data };
	};
	return { provider: getProvider(name), requests };
}

/** A fake translator: keeps the text (and its markers) and tags it. */
const tag = (text) => `Ü ${text}`;

function singularResponse(name, inputs, translate = tag) {
	const values = inputs.map((input) => translate(input.msgid, input));
	return name === 'openai'
		? values
		: Object.fromEntries(values.map((v, i) => [`t${i}`, v]));
}

const entry = (msgid, extra = {}) => ({ msgid, msgstr: '', ...extra });

test('findQuoteSpans pairs prose quotes and skips technical ones', () => {
	assert.deepEqual(findQuoteSpans('"%s" is full.'), [{ start: 0, end: 3 }]);
	assert.equal(findQuoteSpans('A “Load new” import.').length, 1);
	assert.equal(findQuoteSpans('Use „Neu“ here.').length, 1);
	assert.equal(findQuoteSpans('(e.g. "appointment_slot")').length, 0);
	assert.equal(findQuoteSpans('(e.g. "image/*", ".pdf")').length, 0);
	assert.equal(
		findQuoteSpans('<a href="%s">Connect</a> "now".').length,
		1,
		'HTML attribute quotes are not prose'
	);
	assert.equal(findQuoteSpans('The users’ list, it’s fine').length, 0);
	assert.equal(findQuoteSpans('A lone " quote').length, 0);
});

test('markQuotes numbers spans and leaves placeholders and HTML intact', () => {
	const marked = markQuotes(
		'%1$s submitted "%2$s" on "%3$s" — <a href="%4$s">open</a>',
		CURLY
	);
	assert.equal(
		marked.text,
		'%1$s submitted {{Q1}}%2$s{{/Q1}} on {{Q2}}%3$s{{/Q2}} — <a href="%4$s">open</a>'
	);
	assert.equal(marked.count, 2);
	assert.equal(marked.literalQuotes, 2);
});

test('prepareEntries switches marker style when the source collides', () => {
	const prepared = prepareEntries([entry('Type {{Q1}} or "this".')], 'de_DE');
	assert.equal(prepared.style, MARKER_STYLES[1]);
	assert.equal(
		prepared.items[0].msgid.text,
		'Type {{Q1}} or [[Q1]]this[[/Q1]].'
	);

	assert.throws(
		() => prepareEntries([entry('{{Q1}} [[Q1]] ⟦Q1⟧ "x"')], 'pl_PL'),
		/marker collision/
	);
});

for (const name of ['openai', 'claude']) {
	test(`${name}: German and Polish quotes are restored from markers`, async () => {
		const strings = [
			entry('"%s" is full.'),
			entry('A “Load new” import or a “Reload all” import.'),
			entry('No quotes here.'),
		];

		for (const [locale, close] of [
			['de_DE', '“'],
			['pl_PL', '”'],
		]) {
			const { provider, requests } = mockProvider(name, (body) =>
				singularResponse(name, promptInputs(body).inputs)
			);
			const { results } = await provider.translateBatch(strings, locale);

			assert.deepEqual(
				results.map((r) => r.translation),
				[
					`Ü „%s${close} is full.`,
					`Ü A „Load new${close} import or a „Reload all${close} import.`,
					'Ü No quotes here.',
				]
			);
			const { prompt, inputs } = promptInputs(requests[0]);
			assert.equal(inputs[0].msgid, '{{Q1}}%s{{/Q1}} is full.');
			assert.match(prompt, /quotation markers such as \{\{Q1\}\}/);
		}
	});

	test(`${name}: an ASCII-closed or malformed translation fails alone`, async () => {
		const outputs = [
			'Ü „Voll', // closed with ASCII ", JSON cut it off
			'Ü {{Q1}}%s" ist voll.', // closing marker replaced by "
			'Ü {{Q1}}%s{{/Q1}} {{Q1}}ist{{/Q1}} voll.', // duplicated
			'Ü {{/Q1}}%s{{Q1}} ist voll.', // closes before it opens
			'Ü {{Q1}}%s{{/Q1}} ist voll.', // fine
			'Ü {{Q1}%s{{/Q1}} ist voll.', // mangled marker
			'   ', // empty
		];
		const strings = outputs.map(() => entry('"%s" is full.'));
		const { provider } = mockProvider(name, (body) =>
			singularResponse(name, promptInputs(body).inputs, (_, input) =>
				input ? outputs[input.index] : ''
			)
		);
		const { results } = await provider.translateBatch(strings, 'de_DE');

		assert.deepEqual(
			results.map((r) => r.ok),
			[false, false, false, false, true, false, false]
		);
		assert.match(results[0].reason, /truncated at an opening quote/);
		assert.match(results[1].reason, /missing marker/);
		assert.match(results[2].reason, /duplicated marker/);
		assert.match(results[3].reason, /closes before it opens/);
		assert.equal(results[4].translation, 'Ü „%s“ ist voll.');
		assert.match(results[6].reason, /empty translation/);
	});

	test(`${name}: literal and HTML attribute quotes stay intact`, async () => {
		const strings = [
			entry('A unique identifier (e.g. "appointment_slot").'),
			entry(
				'Mollie is <strong>not connected</strong>. <a href="%s">Connect</a>.'
			),
		];
		const { provider } = mockProvider(name, (body) =>
			singularResponse(name, promptInputs(body).inputs)
		);
		const { results } = await provider.translateBatch(strings, 'pl_PL');

		assert.deepEqual(
			results.map((r) => r.translation),
			strings.map((s) => tag(s.msgid))
		);
	});

	test(`${name}: plural entries need every form to pass`, async () => {
		const strings = [
			entry('%d ticket for "%s"', {
				msgidPlural: '%d tickets for "%s"',
				msgstr: ['', '', ''],
			}),
			entry('%d file', { msgidPlural: '%d files', msgstr: ['', '', ''] }),
		];
		const { provider } = mockProvider(name, (body) => {
			const { inputs } = promptInputs(body);
			return inputs.map((input) =>
				input.index === 0
					? [
							tag(input.singular),
							tag(input.plural),
							tag(input.plural),
						]
					: [tag(input.singular), tag(input.plural), 'Ü „pliki']
			);
		});
		const { results } = await provider.translatePluralBatch(
			strings,
			'pl_PL'
		);

		assert.deepEqual(results[0].translation, [
			'Ü %d ticket for „%s”',
			'Ü %d tickets for „%s”',
			'Ü %d tickets for „%s”',
		]);
		assert.equal(results[1].ok, false);
		assert.match(results[1].reason, /plural form 2: truncated/);
	});

	test(`${name}: a wrong number of plural forms fails only that entry`, async () => {
		const strings = [
			entry('%d item', { msgidPlural: '%d items' }),
			entry('%d file', { msgidPlural: '%d files' }),
		];
		const { provider } = mockProvider(name, () => [
			['Ü %d Element', 'Ü %d Elemente'],
			['Ü %d Datei'],
		]);
		const { results } = await provider.translatePluralBatch(
			strings,
			'de_DE'
		);

		assert.equal(results[0].ok, true);
		assert.match(results[1].reason, /expected 2 plural forms, got 1/);
	});

	test(`${name}: Spanish and French strings pass through unchanged`, async () => {
		const strings = [entry('Save event'), entry('"%s" is full.')];
		for (const locale of ['es_ES', 'fr_FR']) {
			const { provider, requests } = mockProvider(name, (body) =>
				singularResponse(name, promptInputs(body).inputs)
			);
			const { results } = await provider.translateBatch(strings, locale);

			const { prompt, inputs } = promptInputs(requests[0]);
			assert.equal(inputs[1].msgid, '"%s" is full.');
			assert.doesNotMatch(prompt, /quotation markers/);
			assert.deepEqual(
				results.map((r) => r.translation),
				['Ü Save event', 'Ü "%s" is full.']
			);
		}
	});
}

test('openai: a non-string translation is not coerced', async () => {
	const { provider } = mockProvider('openai', () => [
		{ translation: 'Ü Objekt' },
		'Ü Text',
	]);
	const { results } = await provider.translateBatch(
		[entry('Object'), entry('Text')],
		'de_DE'
	);
	assert.match(results[0].reason, /expected a string, got object/);
	assert.equal(results[1].translation, 'Ü Text');
});

test('claude: a wrong-shaped response throws with its usage', async () => {
	const { provider } = mockProvider('claude', () => 'Ü one Ü two');
	await assert.rejects(
		provider.translateBatch([entry('One'), entry('Two')], 'de_DE'),
		(error) => {
			assert.match(error.message, /expected a "translations" object/);
			assert.ok(error.usage.cost > 0);
			return true;
		}
	);
});

test('translateEntries keeps siblings and retries a failure a bounded number of times', async () => {
	const strings = Array.from({ length: 5 }, (_, i) =>
		entry(`String ${i}`, i === 2 ? { msgctxt: 'button' } : {})
	);
	const calls = [];
	const translate = async (batch) => {
		calls.push(batch.map((e) => e.msgid));
		return {
			results: batch.map((e) =>
				e.msgid === 'String 2'
					? { ok: false, reason: 'truncated at an opening quote' }
					: { ok: true, translation: tag(e.msgid) }
			),
			usage: USAGE,
		};
	};

	const run = await translateEntries(strings, {
		translate,
		batchSize: 20,
		kind: 'string',
	});

	assert.equal(run.translated.length, 4);
	assert.deepEqual(
		run.failures.map((f) => [f.entry.msgid, f.reason]),
		[['String 2', 'truncated at an opening quote']]
	);
	assert.equal(calls.length, 1 + RETRIES_PER_ENTRY);
	assert.deepEqual(calls.slice(1), [['String 2'], ['String 2']]);
	assert.equal(run.cost.toFixed(4), (USAGE.cost * 3).toFixed(4));

	const summary = formatFailures(
		run.failures.map((f) => ({
			...f,
			plugin: 'fair-events',
			locale: 'pl_PL',
		}))
	).join('\n');
	assert.match(summary, /1 string\(s\) left untranslated/);
	assert.match(summary, /fair-events pl_PL/);
	assert.match(summary, /context: button/);
	assert.match(summary, /msgid: String 2/);
	assert.match(summary, /reason: truncated at an opening quote/);
});

test('translateEntries retries a whole failed response entry by entry', async () => {
	let call = 0;
	const translate = async (batch) => {
		call++;
		if (call === 1) {
			throw Object.assign(new Error('invalid JSON'), { usage: USAGE });
		}
		return {
			results: batch.map((e) => ({
				ok: true,
				translation: tag(e.msgid),
			})),
			usage: USAGE,
		};
	};

	const run = await translateEntries([entry('A'), entry('B')], {
		translate,
		batchSize: 20,
		kind: 'string',
	});

	assert.equal(call, 3);
	assert.deepEqual(
		run.translated.map((t) => t.translation),
		['Ü A', 'Ü B']
	);
	assert.equal(run.failures.length, 0);
	assert.equal(run.cost.toFixed(4), (USAGE.cost * 3).toFixed(4));
});

test('translateEntries recovers a quote failure through the provider', async () => {
	let call = 0;
	const { provider } = mockProvider('claude', (body) => {
		call++;
		return singularResponse('claude', promptInputs(body).inputs, (msgid) =>
			call === 1 && msgid.includes('{{Q1}}') ? 'Ü „Voll' : tag(msgid)
		);
	});

	const run = await translateEntries(
		[entry('Ready'), entry('"%s" is full.'), entry('Done')],
		{
			translate: (batch) => provider.translateBatch(batch, 'de_DE'),
			batchSize: 20,
			kind: 'string',
		}
	);

	assert.deepEqual(
		run.translated.map((t) => t.translation),
		['Ü Ready', 'Ü Done', 'Ü „%s“ is full.']
	);
	assert.equal(run.failures.length, 0);
	assert.equal(call, 2);
});

test('applyTranslations keeps existing plural forms and translations', () => {
	const plural = entry('%d item', {
		msgidPlural: '%d items',
		msgstr: ['', 'kept', ''],
	});
	const singular = entry('Saved', { msgstr: 'Gespeichert' });
	const empty = entry('Open');

	applyTranslations([
		{ entry: plural, translation: ['a', 'b', 'c'] },
		{ entry: singular, translation: 'Ü Saved' },
		{ entry: empty, translation: 'Öffnen' },
	]);

	assert.deepEqual(plural.msgstr, ['a', 'kept', 'c']);
	assert.equal(singular.msgstr, 'Gespeichert');
	assert.equal(empty.msgstr, 'Öffnen');
});

test('quoted translations survive a PO write/read round trip and compile', async (t) => {
	const dir = await mkdtemp(join(tmpdir(), 'ai-translation-'));
	t.after(() => rm(dir, { recursive: true, force: true }));
	const poPath = join(dir, 'fixture-pl_PL.po');

	const parsed = parsePOContent(`msgid ""
msgstr ""
"Project-Id-Version: fixture\\n"
"PO-Revision-Date: 2026-10-25 00:00+0000\\n"
"Last-Translator: fixture\\n"
"Language-Team: Polish\\n"
"Language: pl_PL\\n"
"MIME-Version: 1.0\\n"
"Content-Type: text/plain; charset=UTF-8\\n"
"Content-Transfer-Encoding: 8bit\\n"
"Plural-Forms: nplurals=3; plural=(n==1 ? 0 : n%10>=2 && n%10<=4 && (n%100<10 || n%100>=20) ? 1 : 2);\\n"

msgid "\\"%s\\" is full."
msgstr ""

msgid "Connect <a href=\\"%s\\">Mollie</a> (e.g. \\"slot_id\\")."
msgstr ""

msgid "%d ticket for \\"%s\\""
msgid_plural "%d tickets for \\"%s\\""
msgstr[0] ""
msgstr[1] ""
msgstr[2] ""
`);
	const [quoted, literal, plural] = parsed.translations.filter(
		(e) => !e.isHeader
	);
	applyTranslations([
		{ entry: quoted, translation: '„%s” jest pełne.' },
		{
			entry: literal,
			translation: 'Połącz <a href="%s">Mollie</a> (np. "slot_id").',
		},
		{
			entry: plural,
			translation: [
				'%d bilet na „%s”',
				'%d bilety na „%s”',
				'%d biletów na „%s”',
			],
		},
	]);
	await writePOFile(poPath, parsed);

	const written = await readFile(poPath, 'utf8');
	assert.match(written, /msgstr "„%s” jest pełne\."/);
	assert.match(written, /href=\\"%s\\"/);

	const reread = (await parsePOFile(poPath)).translations.filter(
		(e) => !e.isHeader
	);
	assert.equal(reread[0].msgstr, '„%s” jest pełne.');
	assert.equal(
		reread[1].msgstr,
		'Połącz <a href="%s">Mollie</a> (np. "slot_id").'
	);
	assert.deepEqual(reread[2].msgstr, plural.msgstr);

	let msgfmt = true;
	try {
		execFileSync('msgfmt', ['--version'], { stdio: 'ignore' });
	} catch {
		msgfmt = false;
	}
	if (!msgfmt) {
		t.diagnostic('msgfmt not installed; skipping .mo compilation');
		return;
	}
	execFileSync('msgfmt', [
		'--check',
		'-o',
		join(dir, 'fixture-pl_PL.mo'),
		poPath,
	]);
});
