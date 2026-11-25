/**
 * Public marketing assets - page views
 *
 * The index lists every event with an asset page; an occurrence page lists
 * its assets with filters, text copying and image downloads. Plain
 * elements only: public pages don't load the admin component stack.
 *
 * @package FairEventsExperimental
 */

import { useReducer, useEffect, useRef } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	initialState,
	reducer,
	isFiltered,
	hasMore,
	listPath,
	memberName,
	imageSaving,
	hasMeaningfulText,
} from './model.js';

/**
 * Write text to the clipboard exactly as given.
 *
 * @param {string} text Text.
 * @return {Promise<void>} Resolves once copied.
 */
function writeClipboard( text ) {
	if ( ! window.navigator.clipboard?.writeText ) {
		return Promise.reject( new Error( 'Clipboard unavailable' ) );
	}
	return window.navigator.clipboard.writeText( text );
}

/**
 * Select an element's text so it can be copied by hand.
 *
 * @param {HTMLElement|null} element Element.
 */
function selectText( element ) {
	const selection = element?.ownerDocument?.getSelection?.();
	if ( ! selection ) {
		return;
	}
	const range = element.ownerDocument.createRange();
	range.selectNodeContents( element );
	selection.removeAllRanges();
	selection.addRange( range );
}

const errorMessage = ( err, fallback ) => err?.message || fallback;

const occurrenceName = ( entry ) =>
	entry.title ||
	sprintf(
		/* translators: %d: event date ID */
		__( 'Event #%d', 'fair-events-experimental' ),
		entry.event_date_id
	);

export default function App( { view, eventDateId } ) {
	const [ state, dispatch ] = useReducer(
		reducer,
		{ view, eventDateId },
		initialState
	);
	// Only the latest request may change the list.
	const latest = useRef( 0 );

	useEffect( () => {
		const token = ++latest.current;
		dispatch( { type: 'load-start' } );
		apiFetch( { path: listPath( state, 1 ) } )
			.then( ( list ) => {
				if ( token === latest.current ) {
					dispatch( { type: 'load-success', list } );
				}
			} )
			.catch( ( err ) => {
				if ( token === latest.current ) {
					dispatch( {
						type: 'load-error',
						message: errorMessage(
							err,
							__(
								'The marketing assets could not be loaded. Check your connection and try again.',
								'fair-events-experimental'
							)
						),
					} );
				}
			} );
		// The request key changes whenever the filters or a retry ask for page 1.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [ state.requestKey ] );

	const loadMore = () => {
		if ( state.loadingMore ) {
			return;
		}
		const token = latest.current;
		dispatch( { type: 'more-start' } );
		apiFetch( { path: listPath( state, state.page + 1 ) } )
			.then( ( list ) => {
				if ( token === latest.current ) {
					dispatch( { type: 'more-success', list } );
				}
			} )
			.catch( ( err ) => {
				if ( token === latest.current ) {
					dispatch( {
						type: 'more-error',
						message: errorMessage(
							err,
							__(
								'More entries could not be loaded. Try again.',
								'fair-events-experimental'
							)
						),
					} );
				}
			} );
	};

	return (
		<div className="fair-marketing-assets__body">
			{ 'occurrence' === view && (
				<Filters state={ state } dispatch={ dispatch } />
			) }
			<Results state={ state } dispatch={ dispatch } />
			{ 'ready' === state.phase &&
				( 'index' === view ? (
					<IndexList items={ state.items } />
				) : (
					<AssetList state={ state } dispatch={ dispatch } />
				) ) }
			{ hasMore( state ) && (
				<div className="fair-marketing-assets__more">
					<button
						type="button"
						className="fair-marketing-assets__button wp-element-button"
						onClick={ loadMore }
						disabled={ state.loadingMore }
						aria-busy={ state.loadingMore }
					>
						{ state.loadingMore
							? __( 'Loading…', 'fair-events-experimental' )
							: __( 'Show more', 'fair-events-experimental' ) }
					</button>
					{ state.moreError && (
						<p
							className="fair-marketing-assets__notice fair-marketing-assets__notice--error"
							role="alert"
						>
							{ state.moreError }
						</p>
					) }
				</div>
			) }
		</div>
	);
}

function Results( { state, dispatch } ) {
	if ( 'loading' === state.phase ) {
		return (
			<p className="fair-marketing-assets__notice" role="status">
				{ 'index' === state.view
					? __( 'Loading events…', 'fair-events-experimental' )
					: __(
							'Loading marketing assets…',
							'fair-events-experimental'
						) }
			</p>
		);
	}

	if ( 'error' === state.phase ) {
		return (
			<div
				className="fair-marketing-assets__notice fair-marketing-assets__notice--error"
				role="alert"
			>
				<p>{ state.error }</p>
				<button
					type="button"
					className="fair-marketing-assets__button wp-element-button"
					onClick={ () => dispatch( { type: 'retry' } ) }
				>
					{ __( 'Try again', 'fair-events-experimental' ) }
				</button>
			</div>
		);
	}

	if ( 0 === state.total ) {
		if ( 'index' === state.view ) {
			return (
				<p className="fair-marketing-assets__notice" role="status">
					{ __(
						'There are no events yet.',
						'fair-events-experimental'
					) }
				</p>
			);
		}
		if ( isFiltered( state ) ) {
			return (
				<div className="fair-marketing-assets__notice" role="status">
					<p>
						{ __(
							'No assets match these filters.',
							'fair-events-experimental'
						) }
					</p>
					<button
						type="button"
						className="fair-marketing-assets__button wp-element-button"
						onClick={ () => dispatch( { type: 'clear-filters' } ) }
					>
						{ __( 'Clear filters', 'fair-events-experimental' ) }
					</button>
				</div>
			);
		}
		return (
			<p className="fair-marketing-assets__notice" role="status">
				{ __(
					'There are no marketing assets for this event yet. Check again later.',
					'fair-events-experimental'
				) }
			</p>
		);
	}

	let summary;
	if ( 'index' === state.view ) {
		summary = sprintf(
			/* translators: %d: number of events */
			_n(
				'%d event',
				'%d events',
				state.total,
				'fair-events-experimental'
			),
			state.total
		);
	} else if ( isFiltered( state ) ) {
		summary = sprintf(
			/* translators: %d: number of assets */
			_n(
				'%d asset matches the filters.',
				'%d assets match the filters.',
				state.total,
				'fair-events-experimental'
			),
			state.total
		);
	} else {
		summary = sprintf(
			/* translators: %d: number of assets */
			_n(
				'%d asset',
				'%d assets',
				state.total,
				'fair-events-experimental'
			),
			state.total
		);
	}

	return (
		<p className="fair-marketing-assets__summary" role="status">
			{ summary }
		</p>
	);
}

function Filters( { state, dispatch } ) {
	const { members, labels } = state.offered;
	if ( ! members.length && labels.length < 2 && ! isFiltered( state ) ) {
		return null;
	}

	const select = ( name ) => ( event ) =>
		dispatch( { type: 'select', name, value: event.target.value } );
	const memberId = `fair-marketing-assets-member-${ state.eventDateId }`;
	const labelId = `fair-marketing-assets-label-${ state.eventDateId }`;

	return (
		<form
			className="fair-marketing-assets__filters"
			aria-label={ __( 'Filter assets', 'fair-events-experimental' ) }
			onSubmit={ ( event ) => event.preventDefault() }
		>
			{ members.length > 0 && (
				<div className="fair-marketing-assets__filter">
					<label htmlFor={ memberId }>
						{ __( 'Team member', 'fair-events-experimental' ) }
					</label>
					<select
						id={ memberId }
						value={ state.selected.member }
						onChange={ select( 'member' ) }
					>
						<option value="">
							{ __( 'Everyone', 'fair-events-experimental' ) }
						</option>
						{ members.map( ( member ) => (
							<option key={ member.key } value={ member.key }>
								{ memberName( member ) }
							</option>
						) ) }
					</select>
				</div>
			) }
			{ labels.length > 0 && (
				<div className="fair-marketing-assets__filter">
					<label htmlFor={ labelId }>
						{ __( 'Use case', 'fair-events-experimental' ) }
					</label>
					<select
						id={ labelId }
						value={ state.selected.label }
						onChange={ select( 'label' ) }
					>
						<option value="">
							{ __(
								'All use cases',
								'fair-events-experimental'
							) }
						</option>
						{ labels.map( ( label ) => (
							<option key={ label } value={ label }>
								{ label }
							</option>
						) ) }
					</select>
				</div>
			) }
			{ isFiltered( state ) && (
				<button
					type="button"
					className="fair-marketing-assets__button fair-marketing-assets__button--secondary"
					onClick={ () => dispatch( { type: 'clear-filters' } ) }
				>
					{ __( 'Clear filters', 'fair-events-experimental' ) }
				</button>
			) }
		</form>
	);
}

function IndexList( { items } ) {
	return (
		<ul className="fair-marketing-assets__events">
			{ items.map( ( entry ) => (
				<li key={ entry.event_date_id }>
					<a href={ entry.url }>{ occurrenceName( entry ) }</a>
				</li>
			) ) }
		</ul>
	);
}

function AssetList( { state, dispatch } ) {
	return (
		<ul className="fair-marketing-assets__list">
			{ state.items.map( ( asset ) => (
				<li key={ asset.id }>
					<AssetCard
						asset={ asset }
						copied={ state.copied[ asset.id ] || '' }
						onCopied={ ( result ) =>
							dispatch( {
								type: 'copy-result',
								id: asset.id,
								result,
							} )
						}
					/>
				</li>
			) ) }
		</ul>
	);
}

function AssetCard( { asset, copied, onCopied } ) {
	const textRef = useRef( null );
	const hasText = hasMeaningfulText( asset.text );
	const headingId = `fair-marketing-asset-${ asset.id }`;
	const saving = asset.image
		? imageSaving( asset.image.url, window.location.origin )
		: null;

	const copy = () =>
		writeClipboard( asset.text )
			.then( () => onCopied( 'copied' ) )
			.catch( () => {
				selectText( textRef.current );
				onCopied( 'failed' );
			} );

	return (
		<article
			className="fair-marketing-assets__card"
			aria-labelledby={ headingId }
		>
			<h2 id={ headingId } className="fair-marketing-assets__label">
				{ asset.label }
			</h2>

			{ asset.members.length > 0 && (
				<p className="fair-marketing-assets__members">
					{ sprintf(
						/* translators: %s: comma-separated team member names */
						__( 'With %s', 'fair-events-experimental' ),
						asset.members.map( memberName ).join( ', ' )
					) }
				</p>
			) }

			{ asset.image && (
				<figure className="fair-marketing-assets__figure">
					<img
						src={ asset.image.url }
						alt={
							asset.image.alt ||
							sprintf(
								/* translators: %s: asset use case */
								__(
									'Image for %s',
									'fair-events-experimental'
								),
								asset.label
							)
						}
						loading="lazy"
					/>
				</figure>
			) }
			{ asset.image_unavailable && (
				<p className="fair-marketing-assets__notice">
					{ __(
						'The image of this asset is no longer available.',
						'fair-events-experimental'
					) }
				</p>
			) }

			{ hasText && (
				<div
					ref={ textRef }
					className="fair-marketing-assets__text"
					aria-label={ __( 'Text', 'fair-events-experimental' ) }
				>
					{ asset.text }
				</div>
			) }

			{ ( hasText || saving ) && (
				<div className="fair-marketing-assets__actions">
					{ hasText && (
						<button
							type="button"
							className="fair-marketing-assets__button wp-element-button"
							onClick={ copy }
						>
							{ __( 'Copy text', 'fair-events-experimental' ) }
						</button>
					) }
					{ saving &&
						( saving.download ? (
							<a
								className="fair-marketing-assets__button wp-element-button"
								href={ asset.image.url }
								download={ saving.filename || true }
							>
								{ __(
									'Download image',
									'fair-events-experimental'
								) }
							</a>
						) : (
							<a
								className="fair-marketing-assets__button wp-element-button"
								href={ asset.image.url }
								target="_blank"
								rel="noopener noreferrer"
							>
								{ __(
									'Open image',
									'fair-events-experimental'
								) }
							</a>
						) ) }
				</div>
			) }
			<p
				className={ `fair-marketing-assets__status${
					'failed' === copied ? ' is-error' : ''
				}` }
				role="status"
				aria-live="polite"
			>
				{ 'copied' === copied &&
					__( 'Text copied.', 'fair-events-experimental' ) }
				{ 'failed' === copied &&
					__(
						'Couldn’t copy automatically. The text is selected: copy it with your device’s copy command.',
						'fair-events-experimental'
					) }
			</p>
		</article>
	);
}
