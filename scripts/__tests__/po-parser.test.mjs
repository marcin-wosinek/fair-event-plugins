import assert from 'node:assert/strict';
import test from 'node:test';

import { parsePOContent } from '../translation/lib/po-parser.js';

const entries = (content) =>
	parsePOContent(content).translations.filter((e) => !e.isHeader);

test('plural msgstr indexes keep their numeric position', () => {
	const [entry] = entries(`msgid "%d day"
msgid_plural "%d days"
msgstr[0] "uno"
msgstr[1] "dos"
msgstr[10] "diez"
`);

	assert.equal(entry.msgstr.length, 11);
	assert.equal(entry.msgstr[0], 'uno');
	assert.equal(entry.msgstr[1], 'dos');
	assert.equal(entry.msgstr[10], 'diez');
	assert.equal(entry.msgstr[2], undefined);
});

test('plural msgstr indexes with leading zeros stay decimal', () => {
	const [entry] = entries(`msgid "%d day"
msgid_plural "%d days"
msgstr[08] "ocho"
`);

	assert.equal(entry.msgstr[8], 'ocho');
});

test('multi-line plural continuation appends to the same index', () => {
	const [entry] = entries(`msgid "%d day"
msgid_plural "%d days"
msgstr[0] ""
"un "
"día"
msgstr[1] "varios "
"días"
`);

	assert.deepEqual(entry.msgstr, ['un día', 'varios días']);
});
