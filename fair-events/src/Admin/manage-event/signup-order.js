/**
 * Alphabetical order of the List tab's registrations (#2217).
 *
 * Registrations are ordered by their complete stored name, the way the
 * registrant typed it: the name is never split into a first name and a
 * surname, nor completed from the Audience profile. A fixed English
 * collation, ignoring case and accents, keeps the order the same in every
 * organizer's browser; equal names keep a stable order by registration ID.
 *
 * @package FairEvents
 */

const nameCollator = new Intl.Collator( 'en', { sensitivity: 'base' } );

/**
 * Compare two registrations by name, then by registration ID.
 *
 * @param {Object} a Registration returned by the API.
 * @param {Object} b Registration returned by the API.
 * @return {number} Negative, zero or positive, as Array#sort expects.
 */
export function compareSignupsByName( a, b ) {
	const byName = nameCollator.compare(
		String( a?.name ?? '' ),
		String( b?.name ?? '' )
	);
	if ( byName !== 0 ) {
		return byName;
	}
	return Number( a?.id ?? 0 ) - Number( b?.id ?? 0 );
}

/**
 * Registrations in alphabetical order, leaving the given array untouched.
 *
 * @param {Array} signups Registrations returned by the API.
 * @return {Array} A new array of the same registrations, sorted by name.
 */
export function sortSignupsByName( signups ) {
	if ( ! Array.isArray( signups ) ) {
		return [];
	}
	return [ ...signups ].sort( compareSignupsByName );
}
