/**
 * Guards editor/frontend parity (#1269): the PHP and JS timezone → phone
 * placeholder maps are hand-maintained twins (same pattern as
 * PHONE_HTML_PATTERN) and must stay in sync.
 */
import fs from 'node:fs';
import path from 'node:path';
import {
	PHONE_PLACEHOLDER_BY_TIMEZONE,
	FALLBACK_PHONE_PLACEHOLDER,
} from 'fair-events-shared';

const servicePath = path.join(
	__dirname,
	'../../../Services/QuestionnaireService.php'
);
const serviceSource = fs.readFileSync( servicePath, 'utf8' );

function extractPhpMap( source ) {
	const match = source.match(
		/const PHONE_PLACEHOLDERS = array\(([\s\S]*?)\);/
	);
	if ( ! match ) {
		throw new Error(
			'PHONE_PLACEHOLDERS constant not found in PHP source'
		);
	}
	const map = {};
	const entryPattern = /'([^']+)'\s*=>\s*'([^']+)'/g;
	let entryMatch;
	while ( ( entryMatch = entryPattern.exec( match[ 1 ] ) ) !== null ) {
		map[ entryMatch[ 1 ] ] = entryMatch[ 2 ];
	}
	return map;
}

function extractPhpFallback( source ) {
	const match = source.match(
		/const PHONE_PLACEHOLDER_FALLBACK = '([^']+)';/
	);
	if ( ! match ) {
		throw new Error(
			'PHONE_PLACEHOLDER_FALLBACK constant not found in PHP source'
		);
	}
	return match[ 1 ];
}

describe( 'PHP/JS phone placeholder parity', () => {
	it( 'the PHP PHONE_PLACEHOLDERS map matches the JS PHONE_PLACEHOLDER_BY_TIMEZONE map', () => {
		expect( extractPhpMap( serviceSource ) ).toEqual(
			PHONE_PLACEHOLDER_BY_TIMEZONE
		);
	} );

	it( 'the PHP and JS fallback examples match', () => {
		expect( extractPhpFallback( serviceSource ) ).toBe(
			FALLBACK_PHONE_PLACEHOLDER
		);
	} );
} );
