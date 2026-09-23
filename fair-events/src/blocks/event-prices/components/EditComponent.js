/**
 * WordPress dependencies
 */
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import {
	PanelBody,
	CheckboxControl,
	Notice,
	Spinner,
	Button,
} from '@wordpress/components';
import { useState, useEffect, useCallback } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import ServerSideRender from '@wordpress/server-side-render';

/**
 * Pricing lives on the series master, so a generated occurrence pivots to
 * it — same as render.php and event-signup/render.php.
 *
 * @param {Object} eventDate - Event date from the event-dates list.
 * @return {number} Event date ID holding the pricing configuration.
 */
function pricingEventDateId( eventDate ) {
	if ( eventDate.occurrence_type === 'generated' && eventDate.master_id ) {
		return parseInt( eventDate.master_id, 10 );
	}
	return parseInt( eventDate.id, 10 );
}

/**
 * Return a copy of `ids` with `id` added (hidden) or removed (visible).
 *
 * @param {number[]} ids     Currently hidden IDs.
 * @param {number}   id      ID to toggle.
 * @param {boolean}  visible Whether the entry should be visible.
 * @return {number[]} Updated hidden IDs.
 */
function toggleHidden( ids, id, visible ) {
	const without = ( ids || [] ).filter( ( hiddenId ) => hiddenId !== id );
	return visible ? without : [ ...without, id ];
}

/**
 * Edit component for Event Prices block.
 *
 * Linkage is resolved the same way the server does (by post ID, not post
 * type), mirroring the Event Info block's EditComponent: an event-date is
 * linked to this post if its primary `event_id` matches, or if the post
 * appears in the date's junction-linked posts. Once linked, the real
 * dynamic render is fetched via ServerSideRender — including the "no public
 * prices configured" explanatory placeholder render.php returns for editor
 * requests, so an unpriced event doesn't just look like a missing block.
 *
 * The sidebar lets editors hide ticket types and sale periods in this block
 * only; hidden IDs are stored so new entries appear by default.
 *
 * @param {Object}   props               - Component props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Attribute setter
 * @param {Object}   props.context       - Block context (postId, postType)
 * @return {JSX.Element} The edit component
 */
export default function EditComponent( {
	attributes,
	setAttributes,
	context,
} ) {
	const blockProps = useBlockProps();
	const { postId } = context;
	const { hiddenTicketTypeIds = [], hiddenSalePeriodIds = [] } = attributes;

	// null = still resolving, false = not linked, number = pricing event date ID.
	const [ pricingId, setPricingId ] = useState( null );
	const [ tickets, setTickets ] = useState( null );
	const [ ticketsError, setTicketsError ] = useState( false );
	const [ reloadKey, setReloadKey ] = useState( 0 );

	useEffect( () => {
		if ( ! postId ) {
			setPricingId( false );
			return undefined;
		}

		let cancelled = false;
		const currentPostId = parseInt( postId, 10 );

		apiFetch( { path: '/fair-events/v1/event-dates?include_linked=true' } )
			.then( ( eventDates ) => {
				if ( cancelled ) {
					return;
				}
				const linkedDate = ( eventDates || [] ).find(
					( ed ) =>
						ed.event_id === currentPostId ||
						( ed.linked_posts || [] ).some(
							( p ) => p.id === currentPostId
						)
				);
				setPricingId(
					linkedDate ? pricingEventDateId( linkedDate ) : false
				);
			} )
			.catch( () => {
				if ( ! cancelled ) {
					setPricingId( false );
				}
			} );

		return () => {
			cancelled = true;
		};
	}, [ postId ] );

	useEffect( () => {
		if ( ! pricingId ) {
			return undefined;
		}

		let cancelled = false;
		setTickets( null );
		setTicketsError( false );

		apiFetch( {
			path: `/fair-events/v1/event-dates/${ pricingId }/tickets`,
		} )
			.then( ( data ) => {
				if ( ! cancelled ) {
					setTickets( data );
				}
			} )
			.catch( () => {
				if ( ! cancelled ) {
					setTicketsError( true );
				}
			} );

		return () => {
			cancelled = true;
		};
	}, [ pricingId, reloadKey ] );

	const retry = useCallback( () => setReloadKey( ( key ) => key + 1 ), [] );

	const ticketTypes = ( tickets?.ticket_types || [] ).filter(
		( type ) => ! type.disabled
	);
	const salePeriods = tickets?.sale_periods || [];

	const renderPanelBody = ( items, hiddenIds, attributeName, fallback ) => {
		if ( ticketsError ) {
			return (
				<Notice status="error" isDismissible={ false }>
					{ __(
						'Could not load this event’s prices.',
						'fair-events'
					) }{ ' ' }
					<Button variant="link" onClick={ retry }>
						{ __( 'Try again', 'fair-events' ) }
					</Button>
				</Notice>
			);
		}
		if ( ! tickets ) {
			return <Spinner />;
		}
		if ( items.length === 0 ) {
			return (
				<p>
					{ __(
						'Nothing is configured on the Prices tab yet.',
						'fair-events'
					) }
				</p>
			);
		}
		return items.map( ( item ) => {
			const id = parseInt( item.id, 10 );
			return (
				<CheckboxControl
					key={ id }
					__nextHasNoMarginBottom
					label={ item.name || fallback }
					checked={ ! hiddenIds.includes( id ) }
					onChange={ ( visible ) =>
						setAttributes( {
							[ attributeName ]: toggleHidden(
								hiddenIds,
								id,
								visible
							),
						} )
					}
				/>
			);
		} );
	};

	return (
		<div { ...blockProps }>
			{ pricingId ? (
				<InspectorControls>
					<PanelBody title={ __( 'Ticket types', 'fair-events' ) }>
						<p>
							{ __(
								'Choose what this block shows. Hidden entries can still be bought during signup, and other Event Prices blocks are not affected.',
								'fair-events'
							) }
						</p>
						{ renderPanelBody(
							ticketTypes,
							hiddenTicketTypeIds,
							'hiddenTicketTypeIds',
							__( '(untitled ticket type)', 'fair-events' )
						) }
					</PanelBody>
					<PanelBody title={ __( 'Sale periods', 'fair-events' ) }>
						{ renderPanelBody(
							salePeriods,
							hiddenSalePeriodIds,
							'hiddenSalePeriodIds',
							__( '(untitled sale period)', 'fair-events' )
						) }
					</PanelBody>
				</InspectorControls>
			) : null }
			{ pricingId === null ? null : pricingId ? (
				<ServerSideRender
					block="fair-events/event-prices"
					attributes={ attributes }
				/>
			) : (
				<p style={ { fontStyle: 'italic', color: '#999' } }>
					{ __(
						'Event Prices block is disabled — no event is linked to this post.',
						'fair-events'
					) }
				</p>
			) }
		</div>
	);
}
