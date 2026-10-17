import apiFetch from '@wordpress/api-fetch';
import { __ } from '@wordpress/i18n';
import { useRef, useState } from '@wordpress/element';
import {
	Button,
	SelectControl,
	Spinner,
	TextControl,
} from '@wordpress/components';
import { formatSiteLocalDatetime } from 'fair-events-shared/src/dateTime.js';
import { identifiers } from '../../Frontend/attribution.js';

export const CALENDAR_EVENT = 'FairEventCalendarClick';

/**
 * Why this browser cannot send the calendar test, read the same way an
 * event page reads it at activation time.
 *
 * @return {string|null} Explanation, or null when consent and a Meta identifier exist.
 */
export function browserBlocker() {
	if ( typeof window.wp_has_consent !== 'function' ) {
		return __(
			'This page cannot read marketing consent because the WP Consent API is not active.',
			'fair-events-experimental'
		);
	}
	if ( window.wp_has_consent( 'marketing' ) !== true ) {
		return __(
			'This browser has not given marketing consent. Accept marketing cookies on the site, then reload this page.',
			'fair-events-experimental'
		);
	}
	if ( ! identifiers().marketing_consent ) {
		return __(
			'This browser has no Meta browser identifier (the _fbp or _fbc cookie). Open an event page with the Meta Pixel active, then reload this page.',
			'fair-events-experimental'
		);
	}
	return null;
}

function eventLabel( eventDate ) {
	const title =
		eventDate.title || __( '(untitled event)', 'fair-events-experimental' );
	return eventDate.start_datetime
		? `${ title } — ${ formatSiteLocalDatetime( eventDate.start_datetime ) }`
		: title;
}

/**
 * Dates a calendar activation can belong to: the event's own date and, for
 * a series, each date that is not cancelled.
 *
 * @param {Object} eventDate Event date from the event-dates API.
 * @return {Array} `{ id, start_datetime }` options.
 */
function occurrencesOf( eventDate ) {
	const generated = ( eventDate.generated_occurrences || [] ).filter(
		( occurrence ) => occurrence.status !== 'cancelled'
	);
	return [ eventDate, ...generated ];
}

/**
 * Event and date selection for the FairEventCalendarClick test. The send
 * reads consent and Meta identifiers at click time, like a real activation.
 *
 * @param {Object}   props
 * @param {boolean}  props.disabled Whether the shared test rules block sending.
 * @param {boolean}  props.sending  Whether this test is in flight.
 * @param {Function} props.onSend   Receives the request data.
 * @return {Element} Calendar test controls.
 */
export default function MetaCalendarTest( { disabled, sending, onSend } ) {
	const [ search, setSearch ] = useState( '' );
	const [ results, setResults ] = useState( [] );
	const [ searching, setSearching ] = useState( false );
	const [ eventDateId, setEventDateId ] = useState( '' );
	const [ occurrenceId, setOccurrenceId ] = useState( '' );
	const latestSearch = useRef( 0 );

	const handleSearch = async ( term ) => {
		setSearch( term );
		const request = ++latestSearch.current;
		if ( term.trim().length < 2 ) {
			setResults( [] );
			setSearching( false );
			return;
		}
		setSearching( true );
		let next = [];
		try {
			const found = await apiFetch( {
				path: `/fair-events/v1/event-dates?search=${ encodeURIComponent(
					term
				) }&per_page=20`,
			} );
			// Only dates linked to an event page can carry a calendar button.
			next = ( found || [] ).filter( ( item ) => item.event_id );
		} catch {
			next = [];
		}
		if ( request === latestSearch.current ) {
			setResults( next );
			setSearching( false );
		}
	};

	const selected = results.find(
		( item ) => String( item.id ) === eventDateId
	);
	const occurrences = selected ? occurrencesOf( selected ) : [];
	const occurrence =
		occurrences.find( ( item ) => String( item.id ) === occurrenceId ) ||
		( occurrences.length === 1 ? occurrences[ 0 ] : null );

	const blocker = selected
		? browserBlocker()
		: __(
				'Select the event and date the test click belongs to.',
				'fair-events-experimental'
			);
	const missingDate =
		selected && ! occurrence
			? __( 'Select a date of this series.', 'fair-events-experimental' )
			: null;

	const send = () => {
		// Read again at send time: consent may have changed since rendering.
		const values = identifiers();
		if ( ! selected || ! occurrence || ! values.marketing_consent ) {
			return;
		}
		onSend( {
			post_id: selected.event_id,
			event_date_id: occurrence.id,
			...values,
		} );
	};

	return (
		<div style={ { marginBottom: '16px' } }>
			<h3>{ __( 'Calendar click test', 'fair-events-experimental' ) }</h3>
			<p>
				{ __(
					'Sends one FairEventCalendarClick to Test Events, built like a real “Add to calendar” click from this browser. It does not appear in delivery outcomes or reports.',
					'fair-events-experimental'
				) }
			</p>
			<TextControl
				label={ __(
					'Search events by title',
					'fair-events-experimental'
				) }
				value={ search }
				onChange={ handleSearch }
			/>
			{ searching && <Spinner /> }
			{ ! searching && search.trim().length >= 2 && ! results.length && (
				<p className="description">
					{ __(
						'No events with an event page match this search.',
						'fair-events-experimental'
					) }
				</p>
			) }
			{ results.length > 0 && (
				<SelectControl
					label={ __( 'Event', 'fair-events-experimental' ) }
					value={ eventDateId }
					options={ [
						{
							label: __(
								'Select an event',
								'fair-events-experimental'
							),
							value: '',
						},
						...results.map( ( item ) => ( {
							label: eventLabel( item ),
							value: String( item.id ),
						} ) ),
					] }
					onChange={ ( value ) => {
						setEventDateId( value );
						setOccurrenceId( '' );
					} }
				/>
			) }
			{ occurrences.length > 1 && (
				<SelectControl
					label={ __( 'Date', 'fair-events-experimental' ) }
					value={ occurrenceId }
					options={ [
						{
							label: __(
								'Select a date',
								'fair-events-experimental'
							),
							value: '',
						},
						...occurrences.map( ( item ) => ( {
							label: item.start_datetime
								? formatSiteLocalDatetime( item.start_datetime )
								: __( '(no date)', 'fair-events-experimental' ),
							value: String( item.id ),
						} ) ),
					] }
					onChange={ setOccurrenceId }
				/>
			) }
			<p>
				<Button
					variant="secondary"
					onClick={ send }
					isBusy={ sending }
					disabled={ disabled || !! blocker || !! missingDate }
				>
					{ __(
						'Send FairEventCalendarClick test',
						'fair-events-experimental'
					) }
				</Button>
			</p>
			{ ( missingDate || blocker ) && (
				<p className="description">{ missingDate || blocker }</p>
			) }
		</div>
	);
}
