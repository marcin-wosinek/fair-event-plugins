/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';

/**
 * Whether a row is the header of a bank export: it has a date column, named
 * in Spanish or Catalan.
 *
 * @param {*} row Raw row.
 * @return {boolean} True for the header row.
 */
function isHeaderRow( row ) {
	return (
		Array.isArray( row ) &&
		row.some(
			( cell ) =>
				typeof cell === 'string' &&
				( cell.toLowerCase().includes( 'fecha' ) ||
					cell.toLowerCase().includes( 'data de l' ) )
		)
	);
}

/**
 * Parse the raw rows of a bank export into the entries sent to the
 * financial-entries import endpoint.
 *
 * Pure function (no FileReader/DOM) so it can be unit-tested. Throws an Error
 * with a translated message for files that are not a recognizable bank
 * export.
 *
 * @param {Array<Array>} rows Array-of-arrays from XLSX.utils.sheet_to_json(sheet, { header: 1 }).
 * @return {Array<Object>} Entries: { entry_date, description, amount, entry_type, external_reference }.
 */
export function parseEntryRows( rows ) {
	const headerRowIndex = Array.isArray( rows )
		? rows.findIndex( isHeaderRow )
		: -1;

	if ( headerRowIndex === -1 ) {
		throw new Error(
			__(
				'Could not find header row in the file.',
				'fair-payments-connector'
			)
		);
	}

	const entries = [];
	for ( let i = headerRowIndex + 1; i < rows.length; i++ ) {
		const row = rows[ i ];
		if ( ! row || row.length < 4 || typeof row[ 0 ] !== 'number' ) {
			continue;
		}

		// Convert Excel date serial to JS date
		const excelDate = row[ 0 ];
		const date = new Date( ( excelDate - 25569 ) * 86400 * 1000 );
		const dateStr = date.toISOString().split( 'T' )[ 0 ];

		const description = row[ 2 ] || '';
		const amount = parseFloat( row[ 3 ] ) || 0;
		const nroApunte = row[ 5 ] || i; // Use row index as fallback

		// Determine entry type based on amount sign
		const entryType = amount < 0 ? 'cost' : 'income';
		const absAmount = Math.abs( amount );

		// Create unique external reference
		const externalReference = `import_${ dateStr }_${ nroApunte }_${ amount }`;

		entries.push( {
			entry_date: dateStr,
			description,
			amount: absAmount,
			entry_type: entryType,
			external_reference: externalReference,
		} );
	}

	if ( entries.length === 0 ) {
		throw new Error(
			__(
				'No valid entries found in the file.',
				'fair-payments-connector'
			)
		);
	}

	return entries;
}
