/**
 * Translation Validators
 *
 * Validation functions for checking translation integrity.
 */

/**
 * Extract placeholders from a string
 *
 * Finds printf-style (%s, %d, %1$s) and React-style ({{variable}}) placeholders.
 *
 * @param {string} str - String to extract placeholders from
 * @returns {Array<string>} Array of placeholder strings
 */
export function extractPlaceholders( str ) {
	const placeholders = [];

	// Printf-style: %s, %d, %f, etc.
	const printfMatches = str.matchAll( /%[sdfxXouceEgG]/g );
	for ( const match of printfMatches ) {
		placeholders.push( match[ 0 ] );
	}

	// Positional printf: %1$s, %2$d, etc.
	const positionalMatches = str.matchAll( /%\d+\$[sdfxXouceEgG]/g );
	for ( const match of positionalMatches ) {
		placeholders.push( match[ 0 ] );
	}

	// React variables: {{variable}}
	const reactMatches = str.matchAll( /\{\{[^}]+\}\}/g );
	for ( const match of reactMatches ) {
		placeholders.push( match[ 0 ] );
	}

	return placeholders;
}

/**
 * Extract HTML tags from a string
 *
 * Finds all HTML tags (opening and closing).
 *
 * @param {string} str - String to extract tags from
 * @returns {Array<string>} Array of tag names (without brackets)
 */
export function extractHTMLTags( str ) {
	const tags = [];
	const tagMatches = str.matchAll( /<\/?([a-zA-Z][a-zA-Z0-9]*)[^>]*>/g );

	for ( const match of tagMatches ) {
		tags.push( match[ 1 ].toLowerCase() );
	}

	return tags;
}

/**
 * Check if quotes are balanced in a string
 *
 * @param {string} str - String to check
 * @param {string} quoteChar - Quote character to check (' or ")
 * @returns {boolean} True if balanced
 */
export function areQuotesBalanced( str, quoteChar ) {
	const count = ( str.match( new RegExp( `\\${ quoteChar }`, 'g' ) ) || [] )
		.length;
	return count % 2 === 0;
}

/**
 * Get expected plural forms count for a locale
 *
 * Different languages have different plural rules.
 *
 * @param {string} locale - Locale code (e.g., 'de_DE')
 * @returns {number} Expected number of plural forms
 */
export function getPluralFormsCount( locale ) {
	const pluralRules = {
		de_DE: 2, // n != 1
		es_ES: 2, // n != 1
		fr_FR: 2, // n > 1
		pl_PL: 3, // Complex Polish plural rules
	};
	return pluralRules[ locale ] || 2;
}

/**
 * Validate a single translation entry
 *
 * Checks for placeholder mismatches, HTML tag mismatches, quote balancing, etc.
 *
 * @param {Object} entry - Translation entry from PO parser
 * @param {string} locale - Locale code for plural forms validation
 * @returns {Object} Object with errors and warnings arrays
 */
export function validateEntry( entry, locale ) {
	const errors = [];
	const warnings = [];

	// Skip untranslated entries
	if (
		! entry.msgstr ||
		( Array.isArray( entry.msgstr ) && entry.msgstr.every( ( s ) => ! s ) )
	) {
		return { errors, warnings };
	}

	const msgid = entry.msgid;
	const msgstrs = Array.isArray( entry.msgstr )
		? entry.msgstr
		: [ entry.msgstr ];

	for ( let i = 0; i < msgstrs.length; i++ ) {
		const msgstr = msgstrs[ i ];
		if ( ! msgstr ) continue; // Skip empty plural forms

		const context = Array.isArray( entry.msgstr )
			? `plural form ${ i }`
			: 'singular';

		// Validate placeholders
		const srcPlaceholders = extractPlaceholders( msgid );
		const dstPlaceholders = extractPlaceholders( msgstr );

		if ( srcPlaceholders.length !== dstPlaceholders.length ) {
			errors.push( {
				type: 'placeholder_mismatch',
				severity: 'error',
				context,
				msgid,
				msgstr,
				expected: srcPlaceholders,
				actual: dstPlaceholders,
				message: `Placeholder count mismatch: expected ${ srcPlaceholders.length }, got ${ dstPlaceholders.length }`,
				references: entry.references || [],
			} );
		} else {
			// Check if placeholders match exactly (order matters for positional)
			const sortedSrc = [ ...srcPlaceholders ].sort();
			const sortedDst = [ ...dstPlaceholders ].sort();

			if ( sortedSrc.join( ',' ) !== sortedDst.join( ',' ) ) {
				warnings.push( {
					type: 'placeholder_difference',
					severity: 'warning',
					context,
					msgid,
					msgstr,
					expected: srcPlaceholders,
					actual: dstPlaceholders,
					message: 'Placeholder types differ',
					references: entry.references || [],
				} );
			}
		}

		// Validate HTML tags
		const srcTags = extractHTMLTags( msgid );
		const dstTags = extractHTMLTags( msgstr );

		if ( srcTags.length !== dstTags.length ) {
			errors.push( {
				type: 'html_tag_mismatch',
				severity: 'error',
				context,
				msgid,
				msgstr,
				expected: srcTags,
				actual: dstTags,
				message: `HTML tag count mismatch: expected ${ srcTags.length }, got ${ dstTags.length }`,
				references: entry.references || [],
			} );
		}

		// Check for unbalanced quotes (simple check)
		if ( ! areQuotesBalanced( msgstr, "'" ) ) {
			warnings.push( {
				type: 'unbalanced_quotes',
				severity: 'warning',
				context,
				msgstr,
				message: 'Possibly unbalanced single quotes',
				references: entry.references || [],
			} );
		}

		if ( ! areQuotesBalanced( msgstr, '"' ) ) {
			warnings.push( {
				type: 'unbalanced_quotes',
				severity: 'warning',
				context,
				msgstr,
				message: 'Possibly unbalanced double quotes',
				references: entry.references || [],
			} );
		}
	}

	// Validate plural forms count
	if ( entry.msgidPlural && Array.isArray( entry.msgstr ) ) {
		const expectedPlurals = getPluralFormsCount( locale );
		const actualPlurals = entry.msgstr.filter( ( s ) => s ).length; // Count non-empty

		if ( actualPlurals !== expectedPlurals ) {
			warnings.push( {
				type: 'plural_forms_count',
				severity: 'warning',
				msgid: entry.msgid,
				message: `Expected ${ expectedPlurals } plural forms for ${ locale }, got ${ actualPlurals }`,
				references: entry.references || [],
			} );
		}
	}

	return { errors, warnings };
}
