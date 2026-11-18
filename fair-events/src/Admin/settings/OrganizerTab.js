/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import { Card, CardBody } from '@wordpress/components';

/**
 * Internal dependencies
 */
import OrganizerForm, { toSavePayload } from './OrganizerForm.js';
import SalesSummaryCard from './SalesSummaryCard.js';
import { loadOrganizerSettings, saveSettings } from './settings-api.js';

/**
 * Turn a failed settings save into a notice message, preferring the server's
 * per-field validation detail over its generic "Invalid parameter(s)" text.
 *
 * @param {Object} error apiFetch rejection.
 * @return {string} Message to show.
 */
function saveErrorMessage( error ) {
	const params = error?.data?.params;
	const detail = params ? Object.values( params ).filter( Boolean ) : [];
	const serverMessage = detail.length ? detail.join( ' ' ) : error?.message;

	return serverMessage
		? sprintf(
				/* translators: %s: error message returned by the server */
				__( 'Failed to save organizer settings: %s', 'fair-events' ),
				serverMessage
			)
		: __( 'Failed to save organizer settings.', 'fair-events' );
}

/**
 * Organizer Tab Component
 *
 * Sitewide organizer identity (name, address, type, social/profile links)
 * plus private notification recipients. The identity is used to build the
 * sitewide Organization JSON-LD block and the single-event `organizer`
 * reference; the recipients are never part of public output.
 *
 * @param {Object}   props          Props
 * @param {Function} props.onNotice Handler for displaying notices
 * @return {JSX.Element} The Organizer settings tab
 */
export default function OrganizerTab( { onNotice } ) {
	const [ organizer, setOrganizer ] = useState( null );
	const [ defaults, setDefaults ] = useState( {
		name: '',
		website: '',
		logoId: 0,
	} );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ isSaving, setIsSaving ] = useState( false );

	const applySettings = ( settings ) => {
		const { defaults: siteDefaults, ...organizerData } = settings;
		setOrganizer( organizerData );
		setDefaults( siteDefaults );
	};

	useEffect( () => {
		loadOrganizerSettings()
			.then( ( settings ) => {
				applySettings( settings );
				setIsLoading( false );
			} )
			.catch( () => {
				onNotice( {
					status: 'error',
					message: __(
						'Failed to load organizer settings.',
						'fair-events'
					),
				} );
				setIsLoading( false );
			} );
	}, [ onNotice ] );

	const handleSave = () => {
		setIsSaving( true );

		saveSettings( { fair_events_organizer: toSavePayload( organizer ) } )
			.then( () => loadOrganizerSettings() )
			.then( ( settings ) => {
				applySettings( settings );
				onNotice( {
					status: 'success',
					message: __(
						'Organizer settings saved successfully.',
						'fair-events'
					),
				} );
				setIsSaving( false );
			} )
			.catch( ( error ) => {
				// Keep the form state as entered so the user can fix and retry.
				onNotice( {
					status: 'error',
					message: saveErrorMessage( error ),
				} );
				setIsSaving( false );
			} );
	};

	if ( isLoading || ! organizer ) {
		return (
			<Card style={ { marginTop: '16px' } }>
				<CardBody>
					<p>
						{ __( 'Loading organizer settings...', 'fair-events' ) }
					</p>
				</CardBody>
			</Card>
		);
	}

	return (
		<>
			<OrganizerForm
				organizer={ organizer }
				onChange={ setOrganizer }
				onSubmit={ handleSave }
				isSaving={ isSaving }
				defaults={ defaults }
			/>
			<div style={ { marginTop: '16px' } }>
				<SalesSummaryCard
					report="default"
					title={ __( 'Sales summary', 'fair-events' ) }
					description={ __(
						'An email with the tickets sold and paid revenue per event in the previous day or week, with totals to date. It is off until you choose how often to send it.',
						'fair-events'
					) }
				/>
			</div>
		</>
	);
}
