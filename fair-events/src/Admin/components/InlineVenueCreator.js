/**
 * Inline venue creator
 *
 * Lets an organizer create a venue directly inside a calendar-driven event
 * form's venue selector, without leaving the event workflow.
 *
 * @package FairEvents
 */

import { useState } from '@wordpress/element';
import {
	TextControl,
	TextareaControl,
	Button,
	Notice,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

/**
 * Sentinel value for the trailing "Add new venue" option in a venue
 * SelectControl. It is an action, not a persistable venue ID, so a host form
 * must intercept it before it reaches `venue_id` on save.
 */
export const ADD_NEW_VENUE_VALUE = '__add_new_venue__';

/**
 * @param {Object}   props          Component props.
 * @param {Function} props.onCreate Called with the newly created venue on success.
 * @param {Function} props.onCancel Called when the organizer cancels venue creation.
 */
export default function InlineVenueCreator( { onCreate, onCancel } ) {
	const [ name, setName ] = useState( '' );
	const [ address, setAddress ] = useState( '' );
	const [ isSaving, setIsSaving ] = useState( false );
	const [ error, setError ] = useState( null );

	const handleCreate = async () => {
		setIsSaving( true );
		setError( null );

		try {
			const venue = await apiFetch( {
				path: '/fair-events/v1/venues',
				method: 'POST',
				data: { name, address },
			} );
			setName( '' );
			setAddress( '' );
			onCreate( venue );
		} catch ( err ) {
			setError(
				err.message || __( 'Failed to create venue.', 'fair-events' )
			);
		} finally {
			setIsSaving( false );
		}
	};

	return (
		<VStack spacing={ 3 } className="fair-events-inline-venue-creator">
			{ error && (
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			) }
			<TextControl
				label={ __( 'Venue name', 'fair-events' ) }
				value={ name }
				onChange={ setName }
				required
				autoFocus
				disabled={ isSaving }
				help={
					name.trim()
						? undefined
						: __( 'Venue name is required.', 'fair-events' )
				}
			/>
			<TextareaControl
				label={ __( 'Address', 'fair-events' ) }
				value={ address }
				onChange={ setAddress }
				help={ __( 'Optional.', 'fair-events' ) }
				disabled={ isSaving }
			/>
			<HStack justify="flex-end" spacing={ 2 }>
				<Button
					variant="tertiary"
					onClick={ onCancel }
					disabled={ isSaving }
				>
					{ __( 'Cancel', 'fair-events' ) }
				</Button>
				<Button
					variant="primary"
					onClick={ handleCreate }
					isBusy={ isSaving }
					disabled={ isSaving || ! name.trim() }
				>
					{ __( 'Create venue', 'fair-events' ) }
				</Button>
			</HStack>
		</VStack>
	);
}
