/** Consent-gated Meta browser attribution for the Fair Events checkout request. */

import { identifiers } from './attribution.js';

function attribution() {
	const values = identifiers();
	if ( ! values.marketing_consent ) {
		return {};
	}
	return {
		...values,
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
