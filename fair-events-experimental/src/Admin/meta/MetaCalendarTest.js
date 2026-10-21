import { __, sprintf } from '@wordpress/i18n';
import { useEffect, useMemo, useState } from '@wordpress/element';
import {
	Button,
	ComboboxControl,
	Flex,
	FlexItem,
	Notice,
	SelectControl,
} from '@wordpress/components';
import { formatTimingStart } from 'fair-events-shared/src/dateTime.js';
import { identifiers } from '../../Frontend/attribution.js';
import useRequest from '../compare-events/useRequest.js';

export const CALENDAR_EVENT = 'FairEventCalendarClick';

const SEARCH_DELAY = 300;

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
			'This browser has not given marketing consent. Accept marketing cookies on the site, then check again.',
			'fair-events-experimental'
		);
	}
	if ( ! identifiers().marketing_consent ) {
		return __(
			'This browser has no Meta browser identifier (the _fbp or _fbc cookie). Open an event page with the Meta Pixel active, then check again.',
			'fair-events-experimental'
		);
	}
	return null;
}

/**
 * browserBlocker() that also explains a consent API or cookie read that
 * throws, instead of breaking the settings page.
 *
 * @return {string|null} Explanation, or null when the test can be sent.
 */
function readBrowserBlocker() {
	try {
		return browserBlocker();
	} catch {
		return __(
			'This browser’s marketing consent or Meta cookies could not be read. Check the consent banner, then check again.',
			'fair-events-experimental'
		);
	}
}

/**
 * REST path of the latest events the calendar test can be sent for, or of a
 * title search among them. The server decides eligibility.
 *
 * @param {string} search Title to search for; empty lists the latest events.
 * @return {string} REST path.
 */
export function getCalendarEventsPath( search = '' ) {
	const params = new URLSearchParams( { per_page: '100' } );
	if ( search ) {
		params.set( 'search', search );
	}
	return `/fair-events-experimental/v1/meta-conversions/calendar-events?${ params.toString() }`;
}

function formatStart( eventDate ) {
	return formatTimingStart( eventDate );
}

function eventLabel( eventDate ) {
	const title =
		eventDate.title || __( '(untitled event)', 'fair-events-experimental' );
	const start = formatStart( eventDate );
	return start ? `${ title } — ${ start }` : title;
}

/**
 * Dates of an event the calendar test can be sent for. The server lists
 * only eligible, non-cancelled dates.
 *
 * @param {Object} event Event from the calendar-events endpoint.
 * @return {Array} Event dates.
 */
function occurrencesOf( event ) {
	return event.occurrences || [];
}

/**
 * Event and date selection for the FairEventCalendarClick test. The send
 * reads consent and Meta identifiers again at click time, like a real
 * activation.
 *
 * @param {Object}      props
 * @param {string|null} props.disabledReason Why the shared test rules block sending, if they do.
 * @param {boolean}     props.sending        Whether this test is in flight.
 * @param {Function}    props.onSend         Receives the request data.
 * @return {Element} Calendar test controls.
 */
export default function MetaCalendarTest( {
	disabledReason,
	sending,
	onSend,
} ) {
	const [ filter, setFilter ] = useState( '' );
	const [ search, setSearch ] = useState( '' );
	// Kept apart from the search results, so a later search never drops it.
	const [ selected, setSelected ] = useState( null );
	const [ occurrenceId, setOccurrenceId ] = useState( '' );
	const [ blocker, setBlocker ] = useState( readBrowserBlocker );
	// A search result message only describes the open picker.
	const [ picking, setPicking ] = useState( false );

	// Wait for a pause in typing before searching.
	useEffect( () => {
		const timer = setTimeout(
			() => setSearch( filter.trim() ),
			SEARCH_DELAY
		);
		return () => clearTimeout( timer );
	}, [ filter ] );

	const events = useRequest( getCalendarEventsPath( search ) );
	const candidates = useMemo(
		() => ( Array.isArray( events.data ) ? events.data : [] ),
		[ events.data ]
	);
	const options = useMemo( () => {
		const listed =
			selected && ! candidates.some( ( item ) => item.id === selected.id )
				? [ selected, ...candidates ]
				: candidates;
		return listed.map( ( item ) => ( {
			value: String( item.id ),
			label: eventLabel( item ),
		} ) );
	}, [ candidates, selected ] );

	const occurrences = selected ? occurrencesOf( selected ) : [];
	const occurrence =
		occurrences.find( ( item ) => String( item.id ) === occurrenceId ) ||
		( occurrences.length === 1 ? occurrences[ 0 ] : null );

	const reasons = [
		disabledReason,
		! selected &&
			__(
				'Select the event the test click belongs to.',
				'fair-events-experimental'
			),
		selected &&
			! occurrence &&
			__( 'Select a date of this series.', 'fair-events-experimental' ),
	].filter( Boolean );

	const select = ( value ) => {
		setOccurrenceId( '' );
		setSelected(
			[ selected, ...candidates ].find(
				( item ) => item && String( item.id ) === value
			) || null
		);
	};

	const send = () => {
		// Read again at send time: consent may have changed since rendering.
		const nextBlocker = readBrowserBlocker();
		setBlocker( nextBlocker );
		if ( nextBlocker || reasons.length ) {
			return;
		}
		onSend( {
			post_id: selected.event_id,
			event_date_id: occurrence.id,
			...identifiers(),
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
			<div
				onFocus={ () => setPicking( true ) }
				onBlur={ ( event ) =>
					setPicking(
						event.currentTarget.contains( event.relatedTarget )
					)
				}
			>
				<ComboboxControl
					__next40pxDefaultSize
					__nextHasNoMarginBottom
					label={ __( 'Event', 'fair-events-experimental' ) }
					value={ selected ? String( selected.id ) : null }
					options={ options }
					isLoading={ events.status === 'loading' }
					onFilterValueChange={ setFilter }
					onChange={ select }
					help={ __(
						'Lists the latest events whose page is published and publicly accessible. Type to search by title.',
						'fair-events-experimental'
					) }
				/>
			</div>
			{ events.status === 'error' && (
				<Notice
					status="error"
					isDismissible={ false }
					actions={ [
						{
							label: __(
								'Try again',
								'fair-events-experimental'
							),
							onClick: events.retry,
						},
					] }
				>
					{ __(
						'Events could not be loaded.',
						'fair-events-experimental'
					) }
				</Notice>
			) }
			{ events.status === 'ready' &&
				! candidates.length &&
				( picking || ! search ) && (
					<p className="description">
						{ search
							? sprintf(
									/* translators: %s: text typed into the event search */
									__(
										'No events with a publicly accessible page match “%s”.',
										'fair-events-experimental'
									),
									search
								)
							: __(
									'There are no events with a publicly accessible page yet.',
									'fair-events-experimental'
								) }
					</p>
				) }
			{ occurrences.length > 1 && (
				<SelectControl
					__next40pxDefaultSize
					__nextHasNoMarginBottom
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
							label:
								formatStart( item ) ||
								__( '(no date)', 'fair-events-experimental' ),
							value: String( item.id ),
						} ) ),
					] }
					onChange={ setOccurrenceId }
				/>
			) }
			<Flex
				wrap
				justify="flex-start"
				gap={ 2 }
				style={ { margin: '16px 0 8px' } }
			>
				<FlexItem>
					<Button
						variant="secondary"
						onClick={ send }
						isBusy={ sending }
						disabled={ !! reasons.length || !! blocker }
					>
						{ __(
							'Send FairEventCalendarClick test',
							'fair-events-experimental'
						) }
					</Button>
				</FlexItem>
				{ blocker && (
					<FlexItem>
						<Button
							variant="tertiary"
							onClick={ () => setBlocker( readBrowserBlocker() ) }
						>
							{ __(
								'Check this browser again',
								'fair-events-experimental'
							) }
						</Button>
					</FlexItem>
				) }
			</Flex>
			{ [ ...reasons, blocker ].filter( Boolean ).map( ( reason ) => (
				<p key={ reason } className="description">
					{ reason }
				</p>
			) ) }
		</div>
	);
}
