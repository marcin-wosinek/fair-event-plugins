/**
 * Organizer field of the calendar's Create Event popup (#2305).
 *
 * Starts on the sitewide default. The popup keeps the chosen value and sends
 * it with the create request, which stores it with the new event (or the
 * series it starts).
 *
 * @package FairEventsExperimental
 */

import { useEffect, useState } from '@wordpress/element';
import {
	BaseControl,
	Button,
	Notice,
	Spinner,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import OrganizerSelect, {
	DEFAULT_ORGANIZER_ID,
} from '../components/OrganizerSelect.js';

export const FIELD_NAME = 'organizer';

/**
 * Create-request fields for a chosen organizer: none for the sitewide
 * default, which a new event uses anyway.
 *
 * @param {string|undefined} value Chosen organizer ID.
 * @return {Object} Request fields.
 */
export function organizerRequestData( value ) {
	return value && value !== DEFAULT_ORGANIZER_ID
		? { organizer_id: value }
		: {};
}

/**
 * Organizer field.
 *
 * @param {Object}   props          Component props.
 * @param {string}   props.value    Chosen organizer ID; undefined until chosen.
 * @param {Function} props.onChange Called with the chosen ID.
 * @param {boolean}  props.disabled Whether the popup is saving.
 * @return {JSX.Element} The field.
 */
export default function CalendarOrganizerField( {
	value,
	onChange,
	disabled,
} ) {
	const [ organizers, setOrganizers ] = useState( null );
	const [ loadError, setLoadError ] = useState( null );
	const [ reloadKey, setReloadKey ] = useState( 0 );

	useEffect( () => {
		let cancelled = false;
		setLoadError( null );

		apiFetch( { path: '/fair-events/v1/event-organizers' } )
			.then( ( data ) => {
				if ( ! cancelled ) {
					setOrganizers( data.organizers || [] );
				}
			} )
			.catch( ( err ) => {
				if ( ! cancelled ) {
					setLoadError(
						err?.message ||
							__(
								'The organizers could not be loaded.',
								'fair-events-experimental'
							)
					);
				}
			} );

		return () => {
			cancelled = true;
		};
	}, [ reloadKey ] );

	if ( loadError ) {
		return (
			<VStack spacing={ 2 }>
				<Notice status="warning" isDismissible={ false }>
					{ loadError }{ ' ' }
					{ __(
						'Unless you try again, the event uses the sitewide organizer.',
						'fair-events-experimental'
					) }
				</Notice>
				<div>
					<Button
						variant="secondary"
						onClick={ () => setReloadKey( ( key ) => key + 1 ) }
						disabled={ disabled }
					>
						{ __( 'Try again', 'fair-events-experimental' ) }
					</Button>
				</div>
			</VStack>
		);
	}

	if ( ! organizers ) {
		return (
			<BaseControl
				label={ __( 'Organizer', 'fair-events-experimental' ) }
				__nextHasNoMarginBottom
			>
				<div>
					<Spinner />
				</div>
			</BaseControl>
		);
	}

	return (
		<OrganizerSelect
			organizers={ organizers }
			value={ value || DEFAULT_ORGANIZER_ID }
			onChange={ onChange }
			disabled={ disabled }
			help={ __(
				'The organizer named for this event in public event information. All dates of a series share it.',
				'fair-events-experimental'
			) }
		/>
	);
}
