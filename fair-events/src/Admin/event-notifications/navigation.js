/**
 * WordPress dependencies
 */
import { useCallback, useEffect, useState } from '@wordpress/element';

/**
 * History filters, by URL parameter. `configuration` is offered by the
 * global history only; a configuration's own history is scoped by its ID.
 */
export const FILTERS = [
	'configuration',
	'channel',
	'origin',
	'outcome',
	'from',
	'to',
];

function positive( value ) {
	const number = parseInt( value, 10 );
	return number > 0 ? number : 1;
}

/**
 * The page's view as kept in the URL, so refresh, direct links and the
 * browser's Back and Forward buttons show the same view.
 *
 * - `list`: every notification, with `search` and `listPage`.
 * - `configuration`: one notification by `configuration`, on its `tab`
 *   (`editor` or `history`).
 * - `history`: the history of every notification.
 *
 * Both history views keep their `filters` and `historyPage`, and open
 * an execution's details with `execution` and `deliveriesPage`.
 *
 * @param {string} search URL query string.
 * @return {Object} View state.
 */
export function parseLocation( search ) {
	const params = new URLSearchParams( search );
	const configuration = params.get( 'configuration' ) || '';
	let view = params.get( 'view' );
	if ( 'history' !== view ) {
		view = configuration ? 'configuration' : 'list';
	}
	const filters = {};
	FILTERS.forEach( ( filter ) => {
		const value = params.get( `filter_${ filter }` );
		if ( value ) {
			filters[ filter ] = value;
		}
	} );

	return {
		view,
		configuration: 'configuration' === view ? configuration : '',
		tab: 'history' === params.get( 'tab' ) ? 'history' : 'editor',
		execution: parseInt( params.get( 'execution' ), 10 ) || 0,
		search: params.get( 's' ) || '',
		listPage: positive( params.get( 'list_page' ) ),
		historyPage: positive( params.get( 'history_page' ) ),
		deliveriesPage: positive( params.get( 'deliveries_page' ) ),
		filters,
	};
}

/**
 * The URL of a view, on the current admin page.
 *
 * @param {Object} state View state; missing fields take their defaults.
 * @return {string} Relative URL.
 */
export function locationUrl( state ) {
	const current = new URLSearchParams( window.location.search );
	const params = new URLSearchParams();
	if ( current.get( 'page' ) ) {
		params.set( 'page', current.get( 'page' ) );
	}
	const set = ( name, value, fallback ) => {
		if ( value && value !== fallback ) {
			params.set( name, String( value ) );
		}
	};

	if ( 'history' === state.view ) {
		params.set( 'view', 'history' );
	} else if ( 'configuration' === state.view ) {
		params.set( 'configuration', state.configuration );
		set( 'tab', state.tab, 'editor' );
	} else {
		set( 's', state.search );
		set( 'list_page', state.listPage, 1 );
	}
	if (
		'history' === state.view ||
		( 'configuration' === state.view && 'history' === state.tab )
	) {
		FILTERS.forEach( ( filter ) =>
			set( `filter_${ filter }`, state.filters?.[ filter ] )
		);
		set( 'history_page', state.historyPage, 1 );
		set( 'execution', state.execution, 0 );
		if ( state.execution ) {
			set( 'deliveries_page', state.deliveriesPage, 1 );
		}
	}

	return `${ window.location.pathname }?${ params.toString() }`;
}

/**
 * The view in the URL and a way to change it.
 *
 * `navigate` adds a browser history entry, or replaces the current one
 * with `{ replace: true }`, e.g. while typing a search. It returns the
 * view state it opened.
 *
 * @return {Array} The view state and `navigate( state, options )`.
 */
export function useLocationState() {
	const [ location, setLocation ] = useState( () =>
		parseLocation( window.location.search )
	);

	useEffect( () => {
		const onPop = () =>
			setLocation( parseLocation( window.location.search ) );
		window.addEventListener( 'popstate', onPop );
		return () => window.removeEventListener( 'popstate', onPop );
	}, [] );

	const navigate = useCallback( ( state, { replace = false } = {} ) => {
		const url = locationUrl( state );
		if ( replace ) {
			window.history.replaceState( null, '', url );
		} else {
			window.history.pushState( null, '', url );
			window.scrollTo?.( 0, 0 );
		}
		const next = parseLocation( window.location.search );
		setLocation( next );
		return next;
	}, [] );

	return [ location, navigate ];
}

/**
 * Props of a link to a view: a real URL, so it can be opened in a new tab,
 * that changes the view in place on a plain click.
 *
 * @param {Function} navigate From useLocationState().
 * @param {Object}   state    View state to open.
 * @return {Object} `href` and `onClick`.
 */
export function linkTo( navigate, state ) {
	return {
		href: locationUrl( state ),
		onClick: ( event ) => {
			if (
				event.defaultPrevented ||
				event.button ||
				event.metaKey ||
				event.ctrlKey ||
				event.shiftKey ||
				event.altKey
			) {
				return;
			}
			event.preventDefault();
			navigate( state );
		},
	};
}
