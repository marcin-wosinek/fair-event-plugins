/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	TextControl,
	SelectControl,
	ToggleControl,
	Button,
	Notice,
	Spinner,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import DataSourceItem from './DataSourceItem.js';

const SourceForm = ( { source, onSuccess, onCancel } ) => {
	const [ name, setName ] = useState( source?.name || '' );
	const [ slug, setSlug ] = useState( source?.slug || '' );
	const [ dataSources, setDataSources ] = useState(
		source?.data_sources || [ { source_type: 'categories', config: {} } ]
	);
	const [ enabled, setEnabled ] = useState( source?.enabled ?? true );
	const [ pageId, setPageId ] = useState( source?.page_id || '' );
	const [ pages, setPages ] = useState( [] );
	const [ loading, setLoading ] = useState( false );
	const [ error, setError ] = useState( null );

	// Fetch published pages for the page selector.
	useEffect( () => {
		apiFetch( { path: '/wp/v2/pages?per_page=100&status=publish' } )
			.then( ( result ) => setPages( result ) )
			.catch( () => setPages( [] ) );
	}, [] );

	// Auto-generate slug from name if creating new source
	useEffect( () => {
		if ( ! source && name ) {
			const generatedSlug = name
				.toLowerCase()
				.replace( /[^a-z0-9]+/g, '-' )
				.replace( /^-|-$/g, '' );
			setSlug( generatedSlug );
		}
	}, [ name, source ] );

	const handleSubmit = async ( e ) => {
		e.preventDefault();
		setLoading( true );
		setError( null );

		try {
			const data = {
				name,
				slug,
				data_sources: dataSources,
				enabled,
				page_id: pageId ? parseInt( pageId, 10 ) : null,
			};

			if ( source ) {
				// Update existing
				await apiFetch( {
					path: `/fair-events/v1/sources/${ source.id }`,
					method: 'PUT',
					data,
				} );
			} else {
				// Create new
				await apiFetch( {
					path: '/fair-events/v1/sources',
					method: 'POST',
					data,
				} );
			}

			onSuccess();
		} catch ( err ) {
			setError(
				err.message ||
					( source
						? __(
								'Failed to update event feed.',
								'fair-events-experimental'
						  )
						: __(
								'Failed to create event feed.',
								'fair-events-experimental'
						  ) )
			);
		} finally {
			setLoading( false );
		}
	};

	const handleAddDataSource = () => {
		setDataSources( [
			...dataSources,
			{ source_type: 'categories', config: {} },
		] );
	};

	const handleRemoveDataSource = ( index ) => {
		if ( dataSources.length > 1 ) {
			setDataSources( dataSources.filter( ( _, i ) => i !== index ) );
		}
	};

	const handleDataSourceChange = ( index, newDataSource ) => {
		const updated = [ ...dataSources ];
		updated[ index ] = newDataSource;
		setDataSources( updated );
	};

	return (
		<form onSubmit={ handleSubmit }>
			<VStack spacing={ 4 }>
				{ error && (
					<Notice
						status="error"
						isDismissible
						onRemove={ () => setError( null ) }
					>
						{ error }
					</Notice>
				) }

				<TextControl
					label={ __(
						'Event feed name',
						'fair-events-experimental'
					) }
					value={ name }
					onChange={ setName }
					required
					help={ __(
						'A descriptive name for this event feed.',
						'fair-events-experimental'
					) }
				/>

				<TextControl
					label={ __( 'Slug', 'fair-events-experimental' ) }
					value={ slug }
					onChange={ setSlug }
					required
					help={
						source
							? __(
									'URL-friendly identifier for this event feed.',
									'fair-events-experimental'
							  )
							: __(
									'Auto-generated from name. Can be customized.',
									'fair-events-experimental'
							  )
					}
				/>

				<SelectControl
					label={ __( 'Linked Page', 'fair-events-experimental' ) }
					value={ pageId }
					onChange={ setPageId }
					options={ [
						{
							label: __(
								'— No page —',
								'fair-events-experimental'
							),
							value: '',
						},
						...pages.map( ( page ) => ( {
							label: page.title.rendered,
							value: page.id,
						} ) ),
					] }
					help={ __(
						'Optional page that displays events from this event feed.',
						'fair-events-experimental'
					) }
				/>

				<div>
					<HStack justify="space-between" alignment="center">
						<label style={ { fontWeight: 500, margin: 0 } }>
							{ __( 'Feed inputs', 'fair-events-experimental' ) }
						</label>
						<Button
							variant="secondary"
							size="small"
							onClick={ handleAddDataSource }
						>
							{ __(
								'Add feed input',
								'fair-events-experimental'
							) }
						</Button>
					</HStack>
					<p className="description" style={ { marginTop: '8px' } }>
						{ __(
							'Add one or more inputs whose events this event feed combines.',
							'fair-events-experimental'
						) }
					</p>

					<VStack spacing={ 3 } style={ { marginTop: '12px' } }>
						{ dataSources.map( ( dataSource, index ) => (
							<DataSourceItem
								key={ index }
								dataSource={ dataSource }
								index={ index }
								onChange={ ( newDataSource ) =>
									handleDataSourceChange(
										index,
										newDataSource
									)
								}
								onRemove={ () =>
									handleRemoveDataSource( index )
								}
							/>
						) ) }
					</VStack>
				</div>

				<ToggleControl
					label={ __(
						'Enable this event feed',
						'fair-events-experimental'
					) }
					checked={ enabled }
					onChange={ setEnabled }
					help={ __(
						'Disabled event feeds will not be used for event imports.',
						'fair-events-experimental'
					) }
				/>

				<HStack justify="flex-end" spacing={ 2 }>
					<Button
						variant="tertiary"
						onClick={ onCancel }
						disabled={ loading }
					>
						{ __( 'Cancel', 'fair-events-experimental' ) }
					</Button>
					<Button
						variant="primary"
						type="submit"
						disabled={ loading }
					>
						{ loading ? (
							<>
								<Spinner style={ { marginRight: '8px' } } />
								{ __(
									'Saving...',
									'fair-events-experimental'
								) }
							</>
						) : source ? (
							__(
								'Update event feed',
								'fair-events-experimental'
							)
						) : (
							__(
								'Create event feed',
								'fair-events-experimental'
							)
						) }
					</Button>
				</HStack>
			</VStack>
		</form>
	);
};

export default SourceForm;
