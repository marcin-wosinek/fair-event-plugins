/**
 * WordPress dependencies
 */
import { useBlockProps, InspectorControls } from '@wordpress/block-editor';
import {
	Button,
	ComboboxControl,
	Notice,
	PanelBody,
	Placeholder,
	Spinner,
} from '@wordpress/components';
import { useState, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import ServerSideRender from '@wordpress/server-side-render';

const VENUES_PAGE_URL = 'admin.php?page=fair-events-venues';

/**
 * Edit component for the Venue Info block.
 *
 * Only the venue ID is stored; the venue list and the preview are fetched
 * fresh on every editor load and on "Refresh venue details", so the block
 * always shows the venue's current information. The preview is the same
 * server render the public page uses.
 *
 * @param {Object}   props               - Component props
 * @param {Object}   props.attributes    - Block attributes
 * @param {Function} props.setAttributes - Attribute setter
 * @return {JSX.Element} The edit component
 */
export default function EditComponent( { attributes, setAttributes } ) {
	const blockProps = useBlockProps();
	const { venueId } = attributes;

	// 'loading' | 'ready' | 'error'. A failed load keeps the saved venueId.
	const [ status, setStatus ] = useState( 'loading' );
	const [ venues, setVenues ] = useState( [] );
	const [ refreshCount, setRefreshCount ] = useState( 0 );

	useEffect( () => {
		let cancelled = false;
		setStatus( 'loading' );

		apiFetch( { path: '/fair-events/v1/venues' } )
			.then( ( data ) => {
				if ( ! cancelled ) {
					setVenues( Array.isArray( data ) ? data : [] );
					setStatus( 'ready' );
				}
			} )
			.catch( () => {
				if ( ! cancelled ) {
					setStatus( 'error' );
				}
			} );

		return () => {
			cancelled = true;
		};
	}, [ refreshCount ] );

	const refresh = () => setRefreshCount( ( count ) => count + 1 );

	const hasSelection = Number.isInteger( venueId ) && venueId > 0;
	const selectedVenue = hasSelection
		? venues.find( ( venue ) => venue.id === venueId )
		: null;
	const isDeleted = 'ready' === status && hasSelection && ! selectedVenue;

	const venueOptions = venues.map( ( venue ) => ( {
		value: String( venue.id ),
		label: venue.name || __( '(unnamed venue)', 'fair-events' ),
	} ) );

	const venueSelector = (
		<ComboboxControl
			__next40pxDefaultSize
			__nextHasNoMarginBottom
			label={ __( 'Venue', 'fair-events' ) }
			help={ __( 'Type to search your venues.', 'fair-events' ) }
			value={ selectedVenue ? String( selectedVenue.id ) : null }
			options={ venueOptions }
			onChange={ ( value ) =>
				setAttributes( {
					venueId: value ? parseInt( value, 10 ) : undefined,
				} )
			}
		/>
	);

	const venuesPageLink = (
		<a href={ VENUES_PAGE_URL } target="_blank" rel="noopener noreferrer">
			{ __( 'Manage venues (opens in a new tab)', 'fair-events' ) }
		</a>
	);

	let body;
	if ( 'loading' === status ) {
		body = (
			<Placeholder
				icon="location"
				label={ __( 'Venue Info', 'fair-events' ) }
			>
				<Spinner />
				<span>{ __( 'Loading venues…', 'fair-events' ) }</span>
			</Placeholder>
		);
	} else if ( 'error' === status ) {
		body = (
			<Placeholder
				icon="location"
				label={ __( 'Venue Info', 'fair-events' ) }
			>
				<Notice
					status="error"
					isDismissible={ false }
					actions={ [
						{
							label: __( 'Retry', 'fair-events' ),
							onClick: refresh,
						},
					] }
				>
					{ hasSelection
						? __(
								'Venues could not be loaded. Your venue selection is kept; try again.',
								'fair-events'
							)
						: __(
								'Venues could not be loaded. Try again.',
								'fair-events'
							) }
				</Notice>
			</Placeholder>
		);
	} else if ( selectedVenue ) {
		body = (
			<ServerSideRender
				key={ refreshCount }
				block="fair-events/venue-info"
				attributes={ attributes }
			/>
		);
	} else if ( 0 === venues.length ) {
		body = (
			<Placeholder
				icon="location"
				label={ __( 'Venue Info', 'fair-events' ) }
				instructions={
					isDeleted
						? __(
								'The selected venue has been deleted, and there are no venues left to choose. Visitors see nothing for this block. Add a venue, then refresh.',
								'fair-events'
							)
						: __(
								'There are no venues yet. Add a venue, then refresh.',
								'fair-events'
							)
				}
			>
				{ venuesPageLink }
				<Button variant="secondary" onClick={ refresh }>
					{ __( 'Refresh venues', 'fair-events' ) }
				</Button>
			</Placeholder>
		);
	} else {
		body = (
			<Placeholder
				icon="location"
				label={ __( 'Venue Info', 'fair-events' ) }
				instructions={
					isDeleted
						? __(
								'The selected venue has been deleted. Visitors see nothing for this block until you choose another venue.',
								'fair-events'
							)
						: __(
								'Choose the venue whose details this block shows.',
								'fair-events'
							)
				}
			>
				{ venueSelector }
			</Placeholder>
		);
	}

	return (
		<div { ...blockProps }>
			<InspectorControls>
				<PanelBody title={ __( 'Venue', 'fair-events' ) }>
					{ selectedVenue && venueSelector }
					<p>{ venuesPageLink }</p>
					<Button variant="secondary" onClick={ refresh }>
						{ __( 'Refresh venue details', 'fair-events' ) }
					</Button>
				</PanelBody>
			</InspectorControls>
			{ body }
		</div>
	);
}
