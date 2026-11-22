/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Notice,
	ToggleControl,
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import { loadStoredTicketing, saveTicketing } from './settings-api.js';

/**
 * PHP-resolved Ticketing state from the Settings page data.
 *
 * @return {{enabled: boolean, forced: boolean, description: string}} Ticketing state.
 */
function ticketingMeta() {
	const meta = window.fairEventsSettingsData?.features?.ticketing || {};
	return {
		enabled: meta.enabled ?? true,
		forced: !! meta.forced,
		description:
			meta.description ||
			__( 'Ticket types, sale periods, and pricing.', 'fair-events' ),
	};
}

/**
 * Ticketing Card Component
 *
 * Shows the Ticketing setting with its own save button, independent of the
 * General form. When site configuration forces the value, it shows the
 * effective state read-only.
 *
 * @return {JSX.Element} The Ticketing card
 */
export default function TicketingCard() {
	const meta = ticketingMeta();

	if ( meta.forced ) {
		return (
			<Card>
				<CardHeader>
					<h2>{ __( 'Ticketing', 'fair-events' ) }</h2>
				</CardHeader>
				<CardBody>
					<p className="description">{ meta.description }</p>
					<p>
						<strong>
							{ meta.enabled
								? __( 'Ticketing is on.', 'fair-events' )
								: __( 'Ticketing is off.', 'fair-events' ) }
						</strong>
					</p>
					<p className="description">
						{ __(
							'Your site configuration manages this setting, so it can’t be changed here.',
							'fair-events'
						) }
					</p>
				</CardBody>
			</Card>
		);
	}

	return <EditableTicketing meta={ meta } />;
}

/**
 * Editable Ticketing setting.
 *
 * @param {Object} props      Props
 * @param {Object} props.meta PHP-resolved Ticketing state.
 * @return {JSX.Element} The editable Ticketing card
 */
function EditableTicketing( { meta } ) {
	const [ saved, setSaved ] = useState( null );
	const [ draft, setDraft ] = useState( null );
	const [ loadFailed, setLoadFailed ] = useState( false );
	const [ isSaving, setIsSaving ] = useState( false );
	const [ notice, setNotice ] = useState( null );
	const savingRef = useRef( false );
	const fallback = meta.enabled;

	const load = useCallback( () => {
		setLoadFailed( false );
		return loadStoredTicketing()
			.then( ( stored ) => {
				const value = stored ?? fallback;
				setSaved( value );
				setDraft( value );
			} )
			.catch( () => setLoadFailed( true ) );
	}, [ fallback ] );

	useEffect( () => {
		load();
	}, [ load ] );

	const isLoaded = saved !== null;
	const isDirty = isLoaded && draft !== saved;

	useEffect( () => {
		if ( ! isDirty ) {
			return undefined;
		}
		const onBeforeUnload = ( event ) => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener( 'beforeunload', onBeforeUnload );
		return () =>
			window.removeEventListener( 'beforeunload', onBeforeUnload );
	}, [ isDirty ] );

	const handleSave = () => {
		if ( ! isLoaded || savingRef.current ) {
			return;
		}
		savingRef.current = true;
		setIsSaving( true );
		setNotice( null );
		const value = draft;
		saveTicketing( value )
			.then( ( stored ) => {
				const next = stored ?? value;
				setSaved( next );
				setDraft( next );
				setNotice( {
					status: 'success',
					message: __(
						'Ticketing saved. Reload the page to apply the change across the admin.',
						'fair-events'
					),
				} );
			} )
			.catch( () =>
				setNotice( {
					status: 'error',
					message: __(
						'Ticketing could not be saved. Your change is kept, so you can try again.',
						'fair-events'
					),
				} )
			)
			.finally( () => {
				savingRef.current = false;
				setIsSaving( false );
			} );
	};

	let body;
	if ( loadFailed ) {
		body = (
			<VStack spacing={ 2 }>
				<Notice status="error" isDismissible={ false }>
					{ __(
						'The Ticketing setting could not be loaded.',
						'fair-events'
					) }
				</Notice>
				<div>
					<Button variant="secondary" onClick={ load }>
						{ __( 'Try again', 'fair-events' ) }
					</Button>
				</div>
			</VStack>
		);
	} else if ( ! isLoaded ) {
		body = <p>{ __( 'Loading the Ticketing setting…', 'fair-events' ) }</p>;
	} else {
		body = (
			<VStack spacing={ 3 }>
				<ToggleControl
					label={ __( 'Enable ticketing', 'fair-events' ) }
					help={ meta.description }
					checked={ draft }
					onChange={ ( value ) => setDraft( value ) }
					disabled={ isSaving }
				/>
				{ notice && (
					<Notice
						status={ notice.status }
						isDismissible
						onRemove={ () => setNotice( null ) }
					>
						{ notice.message }
					</Notice>
				) }
				<HStack justify="flex-start" wrap>
					<Button
						variant="primary"
						onClick={ handleSave }
						isBusy={ isSaving }
						aria-disabled={ isSaving }
					>
						{ isSaving
							? __( 'Saving...', 'fair-events' )
							: __( 'Save Ticketing', 'fair-events' ) }
					</Button>
					{ isDirty && ! isSaving && (
						<span className="description">
							{ __( 'Unsaved changes', 'fair-events' ) }
						</span>
					) }
				</HStack>
			</VStack>
		);
	}

	return (
		<Card>
			<CardHeader>
				<h2>{ __( 'Ticketing', 'fair-events' ) }</h2>
			</CardHeader>
			<CardBody>{ body }</CardBody>
		</Card>
	);
}
