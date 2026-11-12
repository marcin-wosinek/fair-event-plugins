/**
 * Complete name of a registration (#2215).
 *
 * A registration stores its name and optional surname apart. Registrations
 * made before the surname existed keep the whole name in `name`, with an
 * empty surname; they are never split.
 *
 * @package FairEvents
 */

/**
 * Join a name and an optional surname, without doubled or stray spaces.
 *
 * @param {*} name    Name.
 * @param {*} surname Surname; empty when none.
 * @return {string} Complete name.
 */
export function joinName( name, surname ) {
	return [ name, surname ]
		.map( ( part ) => String( part ?? '' ).trim() )
		.filter( Boolean )
		.join( ' ' );
}

/**
 * Complete name of a registration returned by the API: its `full_name`,
 * else the name joined with the surname.
 *
 * @param {Object} signup Registration.
 * @return {string} Complete name, empty when none is stored.
 */
export function signupFullName( signup ) {
	if ( typeof signup?.full_name === 'string' ) {
		return signup.full_name;
	}
	return joinName( signup?.name, signup?.surname );
}
