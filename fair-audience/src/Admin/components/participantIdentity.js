/**
 * How a participant is named in a confirmation or a result.
 *
 * People are named by their name alone. Only where that does not tell them
 * apart — two people of the same name in one list, or no name at all — is
 * the email address added, or the ID when there is no email either.
 *
 * @package FairAudience
 */

import { __, sprintf } from '@wordpress/i18n';

const clean = ( value ) => ( value || '' ).trim();

/**
 * A participant profile, as the participants endpoint returns it.
 *
 * @param {Object} participant Profile with id, name, surname and email.
 * @return {{id: number, name: string, email: string}} Person to identify.
 */
export const personFromProfile = ( participant ) => ( {
	id: participant.id,
	name: clean( `${ participant.name || '' } ${ participant.surname || '' }` ),
	email: clean( participant.email ),
} );

/**
 * A row of an event date's audience, as the event participants endpoint
 * returns it.
 *
 * @param {Object} row Row with participant_id, participant_name and participant_email.
 * @return {{id: number, name: string, email: string}} Person to identify.
 */
export const personFromEventRow = ( row ) => ( {
	id: row.participant_id,
	name: clean( row.participant_name ),
	email: clean( row.participant_email ),
} );

/**
 * What to call one person on their own.
 *
 * @param {{id: number, name: string, email: string}} person Person to identify.
 * @return {string} Their name, else their email, else their ID.
 */
export const participantLabel = ( person ) =>
	person.name ||
	person.email ||
	sprintf(
		/* translators: %d: participant ID */
		__( 'Participant #%d', 'fair-audience' ),
		person.id
	);

/**
 * What to call each person of a list, so that no two read the same.
 *
 * @param {Array<{id: number, name: string, email: string}>} people People to identify.
 * @return {Array<{id: number, label: string, detail: string}>} A label per person, with a detail only where the label alone is shared.
 */
export function identifyParticipants( people ) {
	const count = ( values ) =>
		values.reduce(
			( counts, value ) =>
				counts.set( value, ( counts.get( value ) || 0 ) + 1 ),
			new Map()
		);
	const labels = people.map( ( person ) =>
		participantLabel( person ).toLowerCase()
	);
	const labelCounts = count( labels );
	const pairCounts = count(
		people.map(
			( person, index ) =>
				`${ labels[ index ] }\n${ person.email.toLowerCase() }`
		)
	);

	return people.map( ( person, index ) => {
		const label = participantLabel( person );
		let detail = '';
		if ( labelCounts.get( labels[ index ] ) > 1 ) {
			const pair = `${
				labels[ index ]
			}\n${ person.email.toLowerCase() }`;
			detail =
				person.email &&
				person.email !== label &&
				pairCounts.get( pair ) === 1
					? person.email
					: sprintf(
							/* translators: %d: participant ID */
							__( 'ID %d', 'fair-audience' ),
							person.id
						);
		}
		return { id: person.id, label, detail };
	} );
}
