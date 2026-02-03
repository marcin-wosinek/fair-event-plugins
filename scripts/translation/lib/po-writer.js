/**
 * PO File Writer
 *
 * Writes structured translation data back to .po file format.
 */

import { writeFile } from 'fs/promises';

/**
 * Escape string for PO file format
 *
 * @param {string} str - String to escape
 * @returns {string} Escaped string
 */
function escapeString( str ) {
	// Ensure str is a string (defensive programming)
	if ( typeof str !== 'string' ) {
		str = String( str || '' );
	}
	return str
		.replace( /\\/g, '\\\\' )
		.replace( /"/g, '\\"' )
		.replace( /\n/g, '\\n' )
		.replace( /\t/g, '\\t' );
}

/**
 * Format a translation entry for PO file
 *
 * @param {Object} entry - Translation entry
 * @returns {string} Formatted PO entry
 */
function formatEntry( entry ) {
	let output = '';

	// Extracted comments
	if ( entry.extractedComment ) {
		output += `#. ${ entry.extractedComment }\n`;
	}

	// Source references
	if ( entry.references && entry.references.length > 0 ) {
		for ( const ref of entry.references ) {
			output += `#: ${ ref }\n`;
		}
	}

	// Flags
	if ( entry.flags && entry.flags.length > 0 ) {
		output += `#, ${ entry.flags.join( ', ' ) }\n`;
	}

	// Context
	if ( entry.msgctxt ) {
		output += `msgctxt "${ escapeString( entry.msgctxt ) }"\n`;
	}

	// Message ID
	output += `msgid "${ escapeString( entry.msgid ) }"\n`;

	// Plural form
	if ( entry.msgidPlural ) {
		output += `msgid_plural "${ escapeString( entry.msgidPlural ) }"\n`;

		// Plural translations
		if ( Array.isArray( entry.msgstr ) ) {
			for ( let i = 0; i < entry.msgstr.length; i++ ) {
				const msgstr = entry.msgstr[ i ] || '';
				output += `msgstr[${ i }] "${ escapeString( msgstr ) }"\n`;
			}
		} else {
			// Fallback if msgstr is not an array but should be
			output += `msgstr[0] "${ escapeString( entry.msgstr || '' ) }"\n`;
			output += `msgstr[1] "${ escapeString( entry.msgstr || '' ) }"\n`;
		}
	} else {
		// Singular translation
		let msgstr = entry.msgstr || '';
		// Handle case where msgstr is unexpectedly an array
		if ( Array.isArray( msgstr ) ) {
			msgstr = msgstr[ 0 ] || '';
		}
		output += `msgstr "${ escapeString( msgstr ) }"\n`;
	}

	return output;
}

/**
 * Format header entry
 *
 * @param {Object} metadata - Metadata object
 * @returns {string} Formatted header
 */
function formatHeader( metadata ) {
	let output = 'msgid ""\n';
	output += 'msgstr ""\n';

	for ( const [ key, value ] of Object.entries( metadata ) ) {
		output += `"${ key }: ${ value }\\n"\n`;
	}

	return output;
}

/**
 * Write parsed PO data back to file
 *
 * @param {string} filePath - Path to .po file
 * @param {Object} parsed - Parsed PO data from po-parser
 * @returns {Promise<void>}
 */
export async function writePOFile( filePath, parsed ) {
	let output = '';

	// Write header
	output += formatHeader( parsed.metadata );
	output += '\n';

	// Write translations
	for ( const entry of parsed.translations ) {
		if ( entry.isHeader ) continue; // Skip header entry (already written)

		output += formatEntry( entry );
		output += '\n';
	}

	await writeFile( filePath, output, 'utf8' );
}
