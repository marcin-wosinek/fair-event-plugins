/**
 * Event occurrence dropdown for the Compare events page.
 *
 * @package FairEventsExperimental
 */

import { useEffect, useMemo, useState } from '@wordpress/element';
import { ComboboxControl } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { flattenOccurrences, getEventLabel } from './comparison.js';
import useRequest from './useRequest.js';

const SEARCH_DELAY = 300;

/**
 * REST path of one page of the event list, newest first.
 *
 * @param {string} search Title to search for; empty lists the latest events.
 * @return {string} REST path.
 */
export function getEventListPath( search = '' ) {
	const params = new URLSearchParams( {
		per_page: '100',
		orderby: 'start_datetime',
		order: 'desc',
	} );
	if ( search ) {
		params.set( 'search', search );
	}
	return `/fair-events/v1/event-dates/all?${ params.toString() }`;
}

/**
 * A labelled dropdown of event occurrences.
 *
 * Lists the latest events and searches the rest by name as the user types.
 * The selected occurrence stays in the list even when it is outside those
 * results, which is how a selection restored from a link keeps its label.
 *
 * @param {Object}      props               Props.
 * @param {string}      props.label         Field label.
 * @param {number|null} props.value         Selected occurrence ID.
 * @param {Object|null} props.selectedEvent The selected occurrence, once known.
 * @param {Object}      props.latestEvents  Request state of the latest events.
 * @param {Function}    props.onChange      Called with the new ID, or null.
 * @return {JSX.Element} The dropdown.
 */
export default function EventSelector( {
	label,
	value,
	selectedEvent,
	latestEvents,
	onChange,
} ) {
	const [ filter, setFilter ] = useState( '' );
	const [ search, setSearch ] = useState( '' );

	// Wait for a pause in typing before searching.
	useEffect( () => {
		const timer = setTimeout(
			() => setSearch( filter.trim() ),
			SEARCH_DELAY
		);
		return () => clearTimeout( timer );
	}, [ filter ] );

	const searchResults = useRequest(
		search ? getEventListPath( search ) : null
	);
	const source = search ? searchResults : latestEvents;

	const options = useMemo( () => {
		const occurrences = flattenOccurrences( source.data );
		if (
			selectedEvent &&
			! occurrences.some(
				( occurrence ) => occurrence.id === selectedEvent.id
			)
		) {
			occurrences.unshift( selectedEvent );
		}
		return occurrences.map( ( occurrence ) => ( {
			value: String( occurrence.id ),
			label: getEventLabel( occurrence ),
		} ) );
	}, [ source.data, selectedEvent ] );

	return (
		<ComboboxControl
			__next40pxDefaultSize
			__nextHasNoMarginBottom
			className="fair-compare-events__selector"
			label={ label }
			value={ value ? String( value ) : null }
			options={ options }
			isLoading={ source.status === 'loading' }
			onFilterValueChange={ setFilter }
			onChange={ ( next ) => onChange( next ? Number( next ) : null ) }
			help={ __(
				'Type to search events by name.',
				'fair-events-experimental'
			) }
		/>
	);
}
