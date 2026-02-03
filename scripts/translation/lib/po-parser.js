/**
 * PO File Parser
 *
 * Parses .po (Portable Object) translation files into structured JavaScript objects.
 */

import { readFile } from 'fs/promises';

/**
 * Parse a PO file into structured data
 *
 * @param {string} filePath - Path to .po file
 * @returns {Promise<Object>} Parsed translation data with metadata and translations array
 */
export async function parsePOFile( filePath ) {
	const content = await readFile( filePath, 'utf8' );
	const lines = content.split( '\n' );

	const result = {
		metadata: {},
		translations: [],
	};

	let currentEntry = null;
	let currentField = null;
	let inHeader = true;

	for ( let i = 0; i < lines.length; i++ ) {
		const line = lines[ i ].trim();

		// Skip empty lines
		if ( ! line ) {
			if ( currentEntry && currentEntry.msgid !== undefined ) {
				result.translations.push( currentEntry );
				currentEntry = null;
				currentField = null;
			}
			continue;
		}

		// Comment lines
		if ( line.startsWith( '#' ) ) {
			if ( ! currentEntry ) currentEntry = { references: [] };

			if ( line.startsWith( '#:' ) ) {
				// Source reference
				const ref = line.substring( 2 ).trim();
				if ( ! currentEntry.references ) currentEntry.references = [];
				currentEntry.references.push( ref );
			} else if ( line.startsWith( '#.' ) ) {
				// Extracted comment
				currentEntry.extractedComment = line.substring( 2 ).trim();
			} else if ( line.startsWith( '#,' ) ) {
				// Flags (e.g., #, fuzzy)
				if ( ! currentEntry.flags ) currentEntry.flags = [];
				const flags = line
					.substring( 2 )
					.trim()
					.split( ',' )
					.map( ( f ) => f.trim() );
				currentEntry.flags.push( ...flags );
			}
			continue;
		}

		// Context
		if ( line.startsWith( 'msgctxt ' ) ) {
			if ( ! currentEntry ) currentEntry = {};
			currentEntry.msgctxt = parseString( line );
			currentField = 'msgctxt';
			continue;
		}

		// Message ID (source string)
		if ( line.startsWith( 'msgid ' ) ) {
			if ( ! currentEntry ) currentEntry = {};
			currentEntry.msgid = parseString( line );
			currentField = 'msgid';

			// Header entry detection
			if ( currentEntry.msgid === '' && inHeader ) {
				currentEntry.isHeader = true;
			} else {
				inHeader = false;
			}
			continue;
		}

		// Plural form
		if ( line.startsWith( 'msgid_plural ' ) ) {
			currentEntry.msgidPlural = parseString( line );
			currentField = 'msgidPlural';
			continue;
		}

		// Translation
		if ( line.startsWith( 'msgstr' ) ) {
			// Handle plural forms: msgstr[0], msgstr[1]
			const pluralMatch = line.match( /msgstr\[(\d+)\]/ );
			if ( pluralMatch ) {
				const index = parseInt( pluralMatch[ 1 ], 10 );
				if ( ! currentEntry.msgstr ) currentEntry.msgstr = [];
				currentEntry.msgstr[ index ] = parseString( line );
				currentField = `msgstr[${ index }]`;
			} else {
				currentEntry.msgstr = parseString( line );
				currentField = 'msgstr';

				// Parse header metadata
				if ( currentEntry.isHeader && currentEntry.msgstr ) {
					parseHeaderMetadata( currentEntry.msgstr, result.metadata );
				}
			}
			continue;
		}

		// Continuation of multi-line string
		if ( line.startsWith( '"' ) ) {
			const value = parseString( line );

			if ( currentField ) {
				// Handle plural forms
				const pluralMatch = currentField.match( /msgstr\[(\d+)\]/ );
				if ( pluralMatch ) {
					const index = parseInt( pluralMatch[ 1 ], 10 );
					currentEntry.msgstr[ index ] += value;
				} else {
					// Append to current field
					if ( currentEntry[ currentField ] !== undefined ) {
						currentEntry[ currentField ] += value;

						// Update header metadata if in header
						if (
							currentEntry.isHeader &&
							currentField === 'msgstr'
						) {
							parseHeaderMetadata(
								currentEntry.msgstr,
								result.metadata
							);
						}
					}
				}
			}
		}
	}

	// Don't forget last entry
	if ( currentEntry && currentEntry.msgid !== undefined ) {
		result.translations.push( currentEntry );
	}

	return result;
}

/**
 * Extract string from PO line (remove quotes, handle escaping)
 *
 * @param {string} line - Line from PO file
 * @returns {string} Extracted string with escape sequences decoded
 */
function parseString( line ) {
	const match = line.match( /"(.*)"/ );
	if ( ! match ) return '';

	// Handle escape sequences
	return match[ 1 ]
		.replace( /\\n/g, '\n' )
		.replace( /\\t/g, '\t' )
		.replace( /\\"/g, '"' )
		.replace( /\\\\/g, '\\' );
}

/**
 * Parse header metadata from msgstr
 *
 * @param {string} headerStr - Header metadata string
 * @param {Object} metadata - Metadata object to populate
 */
function parseHeaderMetadata( headerStr, metadata ) {
	const lines = headerStr.split( '\n' );
	for ( const line of lines ) {
		const match = line.match( /^([^:]+):\s*(.*)$/ );
		if ( match ) {
			const key = match[ 1 ].trim();
			const value = match[ 2 ].trim();
			metadata[ key ] = value;
		}
	}
}

/**
 * Check if translation entry is untranslated
 *
 * @param {Object} entry - Translation entry
 * @returns {boolean} True if untranslated
 */
export function isUntranslated( entry ) {
	// Skip header entries
	if ( entry.isHeader ) return false;

	if ( Array.isArray( entry.msgstr ) ) {
		// Plural forms: check if all are empty
		return entry.msgstr.every( ( str ) => ! str || str.trim() === '' );
	}
	return ! entry.msgstr || entry.msgstr.trim() === '';
}
