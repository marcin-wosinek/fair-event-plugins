/** Consent-gated Meta browser identifiers shared by the frontend entries. */

const IDENTIFIER_PATTERN = /^fb\.1\.\d{10,16}\.[A-Za-z0-9_-]{1,128}$/;

function readCookie( name ) {
	const prefix = `${ encodeURIComponent( name ) }=`;
	const match = document.cookie
		.split( ';' )
		.map( ( value ) => value.trim() )
		.find( ( value ) => value.startsWith( prefix ) );
	return match ? decodeURIComponent( match.slice( prefix.length ) ) : '';
}

/**
 * Valid Meta identifiers, or `{}` without marketing consent or identifiers.
 *
 * @return {Object} `marketing_consent`, `meta_fbp` and/or `meta_fbc`.
 */
export function identifiers() {
	if (
		typeof window.wp_has_consent !== 'function' ||
		window.wp_has_consent( 'marketing' ) !== true
	) {
		return {};
	}
	const fbp = readCookie( '_fbp' );
	const fbc = readCookie( '_fbc' );
	if (
		! IDENTIFIER_PATTERN.test( fbp ) &&
		! IDENTIFIER_PATTERN.test( fbc )
	) {
		return {};
	}
	return {
		marketing_consent: true,
		...( IDENTIFIER_PATTERN.test( fbp ) ? { meta_fbp: fbp } : {} ),
		...( IDENTIFIER_PATTERN.test( fbc ) ? { meta_fbc: fbc } : {} ),
	};
}
