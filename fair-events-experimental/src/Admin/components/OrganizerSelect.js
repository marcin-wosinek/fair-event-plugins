/**
 * Organizer picker shared by Manage Event and the calendar's Create Event
 * popup (#2305).
 *
 * @package FairEventsExperimental
 */

import { SelectControl } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';

export const DEFAULT_ORGANIZER_ID = 'default';

/**
 * Display name of an organizer option.
 *
 * @param {Object} organizer Picker option `{ id, name, is_default }`.
 * @return {string} Label for the organizer.
 */
export function organizerLabel( organizer ) {
	if ( organizer.is_default ) {
		return organizer.name
			? sprintf(
					/* translators: %s: sitewide organizer name. */
					__( 'Sitewide default (%s)', 'fair-events-experimental' ),
					organizer.name
				)
			: __( 'Sitewide default', 'fair-events-experimental' );
	}

	return (
		organizer.name ||
		__( '(unnamed organizer)', 'fair-events-experimental' )
	);
}

/**
 * Organizer select.
 *
 * @param {Object}   props                Component props.
 * @param {Object[]} props.organizers     Picker options `{ id, name, is_default }`.
 * @param {string}   props.value          Selected organizer ID.
 * @param {Function} props.onChange       Called with the chosen ID.
 * @param {boolean}  props.disabled       Whether the select is disabled.
 * @param {string}   props.help           Help text.
 * @param {string}   props.unavailableId  A saved ID no longer in `organizers`, listed disabled.
 * @return {JSX.Element} The select.
 */
export default function OrganizerSelect( {
	organizers,
	value,
	onChange,
	disabled,
	help,
	unavailableId,
} ) {
	const options = organizers.map( ( organizer ) => ( {
		value: organizer.id,
		label: organizerLabel( organizer ),
	} ) );
	if ( unavailableId ) {
		options.push( {
			value: unavailableId,
			label: __( 'Unavailable organizer', 'fair-events-experimental' ),
			disabled: true,
		} );
	}

	return (
		<SelectControl
			label={ __( 'Organizer', 'fair-events-experimental' ) }
			help={ help }
			value={ value }
			options={ options }
			onChange={ onChange }
			disabled={ disabled }
			__next40pxDefaultSize
			__nextHasNoMarginBottom
		/>
	);
}
