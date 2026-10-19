/**
 * WordPress dependencies
 */
import { useState, useEffect, useRef } from '@wordpress/element';
import {
	Button,
	Spinner,
	Notice,
	TextControl,
	SelectControl,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { useDispatch } from '@wordpress/data';

/**
 * Fair Events Shared dependencies
 */
import { parseRRule, buildRRule, RecurrenceControl } from 'fair-events-shared';

/**
 * Internal dependencies
 */
import { STORE_NAME } from './store.js';
import RecurrenceImpactSummary from '../manage-event/RecurrenceImpactSummary.js';
import EventTimingFields from '../components/EventTimingFields.js';
import { getTimingError } from '../components/eventTiming.js';

/**
 * EventEditForm component
 *
 * Loads event data via REST API, provides inline editing, saves via REST API,
 * and dispatches to the custom store for block live preview.
 */
export default function EventEditForm( {
	eventDateId,
	manageEventUrl,
	postId,
	postType,
	onUnlink,
	unlinking,
} ) {
	const [ loading, setLoading ] = useState( true );
	const [ saving, setSaving ] = useState( false );
	const [ error, setError ] = useState( null );
	const [ success, setSuccess ] = useState( null );
	const [ venues, setVenues ] = useState( [] );
	const [ recurrenceImpact, setRecurrenceImpact ] = useState( null );
	const formRevision = useRef( 0 );

	// Form state.
	const [ allDay, setAllDay ] = useState( false );
	const [ startDate, setStartDate ] = useState( '' );
	const [ startTime, setStartTime ] = useState( '' );
	const [ endDate, setEndDate ] = useState( '' );
	const [ endTime, setEndTime ] = useState( '' );
	const [ venueId, setVenueId ] = useState( '' );
	const [ address, setAddress ] = useState( '' );

	// Recurrence state.
	const [ recurrence, setRecurrence ] = useState( {
		enabled: false,
		frequency: 'weekly',
		endType: 'count',
		count: 10,
		until: '',
	} );

	const { setEventData } = useDispatch( STORE_NAME );

	useEffect( () => {
		loadEventDate();
		loadVenues();
	}, [ eventDateId ] );

	const loadEventDate = async () => {
		if ( ! eventDateId ) {
			setLoading( false );
			return;
		}
		setLoading( true );
		try {
			const data = await apiFetch( {
				path: `/fair-events/v1/event-dates/${ eventDateId }`,
			} );
			populateForm( data );
			setEventData( data );
		} catch ( err ) {
			setError(
				err.message || __( 'Failed to load event data.', 'fair-events' )
			);
		} finally {
			setLoading( false );
		}
	};

	const loadVenues = async () => {
		try {
			const data = await apiFetch( { path: '/fair-events/v1/venues' } );
			setVenues( data );
		} catch {
			// Venues are optional.
		}
	};

	const populateForm = ( data ) => {
		setAllDay( data.all_day || false );
		setVenueId( data.venue_id ? String( data.venue_id ) : '' );
		setAddress( data.address || '' );

		setStartDate( data.start_date || '' );
		setStartTime(
			data.start_time ? data.start_time.substring( 0, 5 ) : ''
		);
		setEndDate( data.end_date || '' );
		setEndTime( data.end_time ? data.end_time.substring( 0, 5 ) : '' );

		if ( data.rrule ) {
			setRecurrence( { enabled: true, ...parseRRule( data.rrule ) } );
		} else {
			setRecurrence( ( prev ) => ( { ...prev, enabled: false } ) );
		}
	};

	const markFormChanged = () => {
		formRevision.current += 1;
		setError( null );
		setSuccess( null );
	};

	const updateField = ( setter ) => ( value ) => {
		markFormChanged();
		setter( value );
	};

	const timingSetters = {
		allDay: setAllDay,
		startDate: setStartDate,
		startTime: setStartTime,
		endDate: setEndDate,
		endTime: setEndTime,
	};

	const handleTimingChange = ( patch ) => {
		markFormChanged();
		Object.entries( patch ).forEach( ( [ field, next ] ) =>
			timingSetters[ field ]( next )
		);
	};

	const timingError = getTimingError( {
		startDate,
		endDate,
		startTime,
		endTime,
		allDay,
	} );

	// The form's dates with independently optional times: an empty time
	// field is null (not set), and an all-day event has no times.
	const buildTiming = () => {
		const timeValue = ( time ) =>
			! allDay && startDate && time ? `${ time }:00` : null;

		return {
			start_date: startDate || null,
			end_date: startDate ? endDate || startDate : null,
			start_time: timeValue( startTime ),
			end_time: timeValue( endTime ),
		};
	};

	const handleSave = async () => {
		setSaving( true );
		setError( null );
		setSuccess( null );
		const savedRevision = formRevision.current;

		try {
			const updated = await apiFetch( {
				path: `/fair-events/v1/event-dates/${ eventDateId }`,
				method: 'PUT',
				data: {
					...buildTiming(),
					all_day: allDay,
					venue_id: venueId ? parseInt( venueId, 10 ) : null,
					address,
					rrule: buildRRule( recurrence ),
				},
			} );
			setEventData( updated );
			setRecurrenceImpact(
				updated.recurrence_impact
					? { impact: updated.recurrence_impact, blocked: false }
					: null
			);
			if ( formRevision.current === savedRevision ) {
				setSuccess( __( 'Event saved.', 'fair-events' ) );
			}
		} catch ( err ) {
			if ( formRevision.current === savedRevision ) {
				setError(
					err.message || __( 'Failed to save event.', 'fair-events' )
				);
			}
			setRecurrenceImpact(
				err.data?.impact
					? { impact: err.data.impact, blocked: true }
					: null
			);
		} finally {
			setSaving( false );
		}
	};

	// Dispatch store updates on field changes for live preview.
	useEffect( () => {
		if ( loading ) return;

		setEventData( {
			id: eventDateId,
			...buildTiming(),
			all_day: allDay,
			venue_id: venueId ? parseInt( venueId, 10 ) : null,
			address,
			rrule: buildRRule( recurrence ),
			occurrence_type: recurrence.enabled ? 'master' : 'single',
		} );
	}, [
		startDate,
		startTime,
		endDate,
		endTime,
		allDay,
		venueId,
		address,
		recurrence,
	] );

	const venueOptions = [
		{ label: __( '— No venue —', 'fair-events' ), value: '' },
		...venues.map( ( v ) => ( { label: v.name, value: String( v.id ) } ) ),
	];

	if ( loading ) {
		return <Spinner />;
	}

	return (
		<VStack spacing={ 3 }>
			{ recurrenceImpact && (
				<RecurrenceImpactSummary
					impact={ recurrenceImpact.impact }
					blocked={ recurrenceImpact.blocked }
					onDismiss={ () => setRecurrenceImpact( null ) }
				/>
			) }

			<EventTimingFields
				value={ { allDay, startDate, startTime, endDate, endTime } }
				onChange={ handleTimingChange }
				error={ timingError }
				withDuration
			/>

			<SelectControl
				label={ __( 'Venue', 'fair-events' ) }
				value={ venueId }
				options={ venueOptions }
				onChange={ updateField( setVenueId ) }
			/>

			<TextControl
				label={ __( 'Address', 'fair-events' ) }
				value={ address }
				onChange={ updateField( setAddress ) }
				help={ __(
					'Used as the event location only when no venue is selected above.',
					'fair-events'
				) }
			/>

			<RecurrenceControl
				value={ recurrence }
				onChange={ updateField( setRecurrence ) }
			/>

			<VStack className="fair-events-event-save-actions" spacing={ 2 }>
				{ error && (
					<Notice
						status="error"
						isDismissible
						onRemove={ () => setError( null ) }
					>
						{ error }
					</Notice>
				) }

				{ success && (
					<Notice
						status="success"
						isDismissible
						onRemove={ () => setSuccess( null ) }
					>
						{ success }
					</Notice>
				) }

				<div
					style={ {
						display: 'flex',
						gap: '8px',
						flexWrap: 'wrap',
					} }
				>
					<Button
						variant="primary"
						onClick={ handleSave }
						isBusy={ saving }
						disabled={ saving || unlinking || !! timingError }
					>
						{ __( 'Save Event', 'fair-events' ) }
					</Button>
					{ manageEventUrl && (
						<Button variant="secondary" href={ manageEventUrl }>
							{ __( 'Edit Full Details', 'fair-events' ) }
						</Button>
					) }
					{ onUnlink && (
						<Button
							variant="tertiary"
							isDestructive
							onClick={ onUnlink }
							isBusy={ unlinking }
							disabled={ saving || unlinking }
						>
							{ __( 'Unlink from event', 'fair-events' ) }
						</Button>
					) }
				</div>
			</VStack>
		</VStack>
	);
}
