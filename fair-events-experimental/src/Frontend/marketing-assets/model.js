/**
 * Public marketing assets - page model
 *
 * One model per page instance holds the load phases, the loaded list, the
 * filters on offer and those selected, and each card's copy result. The
 * view renders only from it.
 *
 * @package FairEventsExperimental
 */

export const PER_PAGE = 50;

const API_BASE = '/fair-events/v1/marketing-assets';

/**
 * Initial state.
 *
 * @param {Object}      bootstrap
 * @param {string}      bootstrap.view        'index' or 'occurrence'.
 * @param {number|null} bootstrap.eventDateId Occurrence, for 'occurrence'.
 * @return {Object} State.
 */
export function initialState( { view, eventDateId = null } ) {
	return {
		view,
		eventDateId,
		// 'loading' | 'ready' | 'error'.
		phase: 'loading',
		error: '',
		loadingMore: false,
		moreError: '',
		items: [],
		total: 0,
		page: 0,
		offered: { members: [], labels: [] },
		selected: { member: '', label: '' },
		// Asset ID → 'copied' | 'failed'.
		copied: {},
		// Bumped to load page 1 again.
		requestKey: 0,
	};
}

/**
 * Apply an action.
 *
 * @param {Object} state  State.
 * @param {Object} action Action.
 * @return {Object} New state.
 */
export function reducer( state, action ) {
	switch ( action.type ) {
		case 'load-start':
			return {
				...state,
				phase: 'loading',
				error: '',
				moreError: '',
				loadingMore: false,
			};
		case 'load-success':
			return {
				...state,
				phase: 'ready',
				items: action.list.items || [],
				total: action.list.total || 0,
				page: action.list.page || 1,
				offered: action.list.filters || state.offered,
				copied: {},
			};
		case 'load-error':
			return { ...state, phase: 'error', error: action.message };
		case 'more-start':
			return { ...state, loadingMore: true, moreError: '' };
		case 'more-success':
			return {
				...state,
				loadingMore: false,
				items: [ ...state.items, ...( action.list.items || [] ) ],
				total: action.list.total || 0,
				page: action.list.page || state.page + 1,
				offered: action.list.filters || state.offered,
			};
		case 'more-error':
			return { ...state, loadingMore: false, moreError: action.message };
		case 'select':
			return {
				...state,
				selected: { ...state.selected, [ action.name ]: action.value },
				requestKey: state.requestKey + 1,
			};
		case 'clear-filters':
			return {
				...state,
				selected: { member: '', label: '' },
				requestKey: state.requestKey + 1,
			};
		case 'retry':
			return { ...state, requestKey: state.requestKey + 1 };
		case 'copy-result':
			return {
				...state,
				copied: { ...state.copied, [ action.id ]: action.result },
			};
		default:
			return state;
	}
}

/**
 * Whether a filter is selected.
 *
 * @param {Object} state State.
 * @return {boolean} True when the list is filtered.
 */
export function isFiltered( state ) {
	return '' !== state.selected.member || '' !== state.selected.label;
}

/**
 * Whether more entries can be loaded.
 *
 * @param {Object} state State.
 * @return {boolean} True when the list has more pages.
 */
export function hasMore( state ) {
	return 'ready' === state.phase && state.items.length < state.total;
}

/**
 * REST path of one page of the list the state shows.
 *
 * @param {Object} state State.
 * @param {number} page  Page, from 1.
 * @return {string} Path for apiFetch.
 */
export function listPath( state, page ) {
	const query = new URLSearchParams( {
		per_page: String( PER_PAGE ),
		page: String( page ),
	} );
	if ( 'index' === state.view ) {
		return `${ API_BASE }?${ query.toString() }`;
	}
	if ( state.selected.label ) {
		query.set( 'label', state.selected.label );
	}
	if ( state.selected.member ) {
		query.set( 'member', state.selected.member );
	}
	return `${ API_BASE }/${ state.eventDateId }?${ query.toString() }`;
}

/**
 * Whether text has a character that is not whitespace, a separator, a
 * control or a formatting character, as the server checks.
 *
 * @param {string} text Text.
 * @return {boolean} True when there is text to copy.
 */
export function hasMeaningfulText( text ) {
	return /[^\s\p{Z}\p{Cc}\p{Cf}]/u.test( text || '' );
}

/**
 * Display name of a team member.
 *
 * @param {Object} member `{ name, surname }`.
 * @return {string} Name.
 */
export function memberName( member ) {
	return [ member.name, member.surname ]
		.map( ( part ) => ( part || '' ).trim() )
		.filter( Boolean )
		.join( ' ' );
}

/**
 * How an image can be saved: a native download for a same-origin URL;
 * otherwise the browser would navigate instead, so it is opened.
 *
 * @param {string} url    Image URL.
 * @param {string} origin Page origin.
 * @return {{ download: boolean, filename: string }} How to offer it.
 */
export function imageSaving( url, origin ) {
	let parsed;
	try {
		parsed = new URL( url, origin );
	} catch {
		return { download: false, filename: '' };
	}
	const segments = parsed.pathname.split( '/' ).filter( Boolean );
	let filename = segments.length ? segments[ segments.length - 1 ] : '';
	try {
		filename = decodeURIComponent( filename );
	} catch {
		// Keep the encoded name.
	}
	return { download: parsed.origin === origin, filename };
}
