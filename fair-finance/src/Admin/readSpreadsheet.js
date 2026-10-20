/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';

/**
 * External dependencies
 */
import * as XLSX from 'xlsx';

/**
 * Read the first sheet of a spreadsheet into an array of row arrays.
 *
 * Accepts whatever SheetJS can read (.xlsx, .xls, .csv). A file it cannot
 * read throws a translated message instead of the library's own error, so
 * callers can show it as is.
 *
 * @param {Uint8Array} data File contents.
 * @return {Array<Array>} Rows of the first sheet; empty when there is no sheet.
 */
export function readWorkbookRows( data ) {
	try {
		const workbook = XLSX.read( data, { type: 'array' } );
		const sheet = workbook.Sheets[ workbook.SheetNames[ 0 ] ];
		if ( ! sheet ) {
			return [];
		}
		const rows = XLSX.utils.sheet_to_json( sheet, { header: 1 } );
		// An empty file reads as one blank row.
		return rows.some( ( row ) => row.length > 0 ) ? rows : [];
	} catch ( err ) {
		throw new Error( __( 'Failed to parse file.', 'fair-finance' ) );
	}
}

/**
 * Read the first sheet of a selected file into an array of row arrays.
 *
 * @param {File} file File chosen in a file input.
 * @return {Promise<Array<Array>>} Rows of the first sheet.
 */
export function readSpreadsheetFile( file ) {
	return new Promise( ( resolve, reject ) => {
		const reader = new FileReader();

		reader.onload = ( e ) => {
			try {
				resolve(
					readWorkbookRows( new Uint8Array( e.target.result ) )
				);
			} catch ( err ) {
				reject( err );
			}
		};

		reader.onerror = () => {
			reject( new Error( __( 'Failed to read file.', 'fair-finance' ) ) );
		};

		reader.readAsArrayBuffer( file );
	} );
}
