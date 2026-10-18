/**
 * Load a shipped Fair Events catalog as `@wordpress/i18n` locale data, so a
 * test renders with the same translations a site in that locale receives.
 */

import { readFileSync } from 'fs';
import { join } from 'path';
import { parsePOContent } from '../../../../../../scripts/translation/lib/po-parser.js';

/**
 * @param {string} locale Locale code, e.g. 'es_ES'.
 * @return {Object} Locale data for `setLocaleData( data, 'fair-events' )`.
 */
export const loadFairEventsLocaleData = ( locale ) => {
	const content = readFileSync(
		join(
			__dirname,
			'../../../../../languages',
			`fair-events-${ locale }.po`
		),
		'utf8'
	);
	const pluralForms = content.match( /"Plural-Forms: ([^"\\]+)/ )[ 1 ];
	const data = { '': { domain: 'fair-events', plural_forms: pluralForms } };

	parsePOContent( content ).translations.forEach( ( entry ) => {
		if ( entry.isHeader || ! entry.msgid ) {
			return;
		}
		const key = entry.msgctxt
			? `${ entry.msgctxt }\u0004${ entry.msgid }`
			: entry.msgid;
		data[ key ] = Array.isArray( entry.msgstr )
			? entry.msgstr
			: [ entry.msgstr ];
	} );

	return data;
};
