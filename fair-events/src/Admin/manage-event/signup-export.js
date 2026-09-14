/**
 * Signup export text builder.
 *
 * Builds the Markdown / CSV / one-line export text for the Signups tab's
 * Export popup, mirroring the format choices of the Fair Form Questionnaire
 * Responses export (`fair-form/src/Admin/utils/export-format.js`) without
 * reusing that module — its markdown branch is knotted into submission
 * specifics (participant_id headings, file answers) that don't apply to a
 * signup row.
 *
 * @package FairEvents
 */

/**
 * Escape a single CSV field per RFC 4180: quote fields containing a comma,
 * double quote, or line break, doubling interior quotes.
 *
 * @param {*} value
 * @return {string} Escaped field
 */
function escapeCsvField( value ) {
	const stringValue =
		value === null || value === undefined ? '' : String( value );
	if ( /[",\r\n]/.test( stringValue ) ) {
		return `"${ stringValue.replace( /"/g, '""' ) }"`;
	}
	return stringValue;
}

/**
 * Build the export text for the given signup rows and columns.
 *
 * @param {Object}   args
 * @param {Array}    args.rows    Signup rows (already filtered to what's visible).
 * @param {Array}    args.columns Column descriptors: `{ id, label, getValue( { item } ) }`.
 * @param {string}   args.format  One of 'csv', 'oneline', 'markdown'.
 * @return {string} Export text
 */
export function buildSignupExportText( { rows, columns, format } ) {
	if ( format === 'csv' ) {
		const headers = columns.map( ( c ) => c.label );
		const lines = rows.map( ( item ) =>
			columns
				.map( ( c ) => c.getValue( { item } ) )
				.map( escapeCsvField )
				.join( ',' )
		);
		return [ headers.map( escapeCsvField ).join( ',' ), ...lines ].join(
			'\r\n'
		);
	}

	if ( format === 'oneline' ) {
		return rows
			.map( ( item ) =>
				columns
					.map( ( c ) => c.getValue( { item } ) )
					.filter(
						( v ) => v !== '' && v !== null && v !== undefined
					)
					.join( ' ' )
			)
			.join( '\r\n' );
	}

	// Markdown.
	return rows
		.map( ( item ) => {
			const heading = item.name || item.email || `#${ item.id }`;
			const lines = [ `## ${ heading }`, '' ];

			columns.forEach( ( c ) => {
				lines.push(
					`**${ c.label }:** ${ c.getValue( { item } ) || '' }`,
					''
				);
			} );

			// Drop the trailing blank line before joining rows.
			lines.pop();
			return lines.join( '\n' );
		} )
		.join( '\n\n---\n\n' );
}

/**
 * Trigger a client-side download of the given text as a UTF-8 CSV file,
 * prepending a BOM so Excel detects the encoding correctly.
 *
 * @param {string} text
 * @param {string} filename
 */
export function downloadCsvFile( text, filename ) {
	const bom = '﻿';
	const blob = new Blob( [ bom + text ], {
		type: 'text/csv;charset=utf-8;',
	} );
	const url = URL.createObjectURL( blob );
	const link = document.createElement( 'a' );
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL( url );
}
