/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';
import { CheckboxControl, Spinner, Notice } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

/**
 * EventSourceSelector Component
 *
 * Reusable component for selecting event sources from database.
 * Fetches sources from REST API and displays as CheckboxControl list.
 *
 * @param {Object}   props
 * @param {string[]} props.selectedSources - Array of selected source slugs
 * @param {Function} props.onChange         - Callback when selection changes: (slugs: string[]) => void
 * @param {string}   props.label            - Label for the control (optional)
 * @param {string}   props.help             - Help text (optional)
 */
export default function EventSourceSelector( {
	selectedSources = [],
	onChange,
	label = __( 'Event Sources', 'fair-events' ),
	help = __( 'Select event sources to display', 'fair-events' ),
} ) {
	const [ sources, setSources ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );

	useEffect( () => {
		apiFetch( {
			path: '/fair-events/v1/sources?enabled_only=true',
		} )
			.then( ( data ) => {
				setSources( data );
				setLoading( false );
			} )
			.catch( ( err ) => {
				setError(
					err.message ||
						__( 'Failed to load event sources', 'fair-events' )
				);
				setLoading( false );
			} );
	}, [] );

	const handleToggle = ( slug, checked ) => {
		const newSelection = checked
			? [ ...selectedSources, slug ]
			: selectedSources.filter( ( s ) => s !== slug );
		onChange( newSelection );
	};

	if ( loading ) {
		return <Spinner />;
	}

	if ( error ) {
		return (
			<Notice status="error" isDismissible={ false }>
				{ error }
			</Notice>
		);
	}

	if ( sources.length === 0 ) {
		return (
			<Notice status="info" isDismissible={ false }>
				{ __(
					'No event sources configured. Create event sources in Fair Events settings.',
					'fair-events'
				) }
			</Notice>
		);
	}

	return (
		<div>
			{ label && <strong>{ label }</strong> }
			{ help && (
				<p
					style={ {
						fontSize: '12px',
						color: '#757575',
						marginTop: '4px',
					} }
				>
					{ help }
				</p>
			) }
			<div style={ { marginTop: '12px' } }>
				{ sources.map( ( source ) => (
					<CheckboxControl
						key={ source.slug }
						label={ source.name }
						checked={ selectedSources.includes( source.slug ) }
						onChange={ ( checked ) =>
							handleToggle( source.slug, checked )
						}
					/>
				) ) }
			</div>
			<div style={ { marginTop: '12px' } }>
				<a
					href="admin.php?page=fair-events-sources"
					style={ {
						fontSize: '12px',
					} }
				>
					{ __( 'Manage Event Sources', 'fair-events' ) }
				</a>
			</div>
		</div>
	);
}
