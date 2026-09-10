/** Consent-gated Meta browser attribution for the Fair Events checkout request. */

const IDENTIFIER_PATTERN = /^fb\.1\.\d{10,16}\.[A-Za-z0-9_-]{1,128}$/;

function readCookie( name ) {
	const prefix = `${ encodeURIComponent( name ) }=`;
	const match = document.cookie
		.split( ';' )
		.map( ( value ) => value.trim() )
		.find( ( value ) => value.startsWith( prefix ) );
	return match ? decodeURIComponent( match.slice( prefix.length ) ) : '';
}

function attribution() {
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
		meta_source_url:
			document.querySelector( 'link[rel="canonical"]' )?.href ||
			window.location.href,
	};
}

export { attribution };

function initialize() {
	window.fairEventsMetaAttribution = attribution;
}
if ( document.readyState === 'loading' ) {
	document.addEventListener( 'DOMContentLoaded', initialize );
} else {
	initialize();
}
