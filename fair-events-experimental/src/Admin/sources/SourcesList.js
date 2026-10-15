/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	Notice,
	Modal,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import SourceForm from './components/SourceForm.js';
import CopyUrlButton from '../components/CopyUrlButton.js';
import './style.css';

const SourcesList = () => {
	const [ sources, setSources ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ success, setSuccess ] = useState( null );
	const [ isFormOpen, setIsFormOpen ] = useState( false );
	const [ editingSource, setEditingSource ] = useState( null );

	useEffect( () => {
		loadSources();
	}, [] );

	const loadSources = async () => {
		setLoading( true );
		setError( null );

		try {
			const data = await apiFetch( {
				path: '/fair-events/v1/sources',
			} );
			setSources( data );
		} catch ( err ) {
			setError(
				err.message ||
					__(
						'Failed to load event feeds.',
						'fair-events-experimental'
					)
			);
		} finally {
			setLoading( false );
		}
	};

	const handleCreate = () => {
		setEditingSource( null );
		setIsFormOpen( true );
	};

	const handleEdit = ( source ) => {
		setEditingSource( source );
		setIsFormOpen( true );
	};

	const handleDelete = async ( id ) => {
		if (
			! window.confirm(
				__(
					'Are you sure you want to delete this event feed?',
					'fair-events-experimental'
				)
			)
		) {
			return;
		}

		setError( null );
		setSuccess( null );

		try {
			await apiFetch( {
				path: `/fair-events/v1/sources/${ id }`,
				method: 'DELETE',
			} );
			setSuccess(
				__( 'Event feed deleted.', 'fair-events-experimental' )
			);
			loadSources();
		} catch ( err ) {
			setError(
				err.message ||
					__(
						'Failed to delete event feed.',
						'fair-events-experimental'
					)
			);
		}
	};

	const handleFormSuccess = () => {
		setIsFormOpen( false );
		setEditingSource( null );
		setSuccess(
			editingSource
				? __( 'Event feed updated.', 'fair-events-experimental' )
				: __( 'Event feed created.', 'fair-events-experimental' )
		);
		loadSources();
	};

	const handleFormCancel = () => {
		setIsFormOpen( false );
		setEditingSource( null );
	};

	const getStatusBadge = ( enabled ) => {
		return enabled ? (
			<span className="source-status-badge source-status-enabled">
				{ __( 'Enabled', 'fair-events-experimental' ) }
			</span>
		) : (
			<span className="source-status-badge source-status-disabled">
				{ __( 'Disabled', 'fair-events-experimental' ) }
			</span>
		);
	};

	const getIcalUrl = ( slug ) => {
		const template =
			window.fairEventsSourcesData?.icalUrlTemplate ||
			'/wp-json/fair-events/v1/sources/{slug}/ical';
		return template.replace( '{slug}', slug );
	};

	const getJsonUrl = ( slug ) => {
		const template =
			window.fairEventsSourcesData?.jsonUrlTemplate ||
			'/wp-json/fair-events/v1/sources/{slug}/json';
		return template.replace( '{slug}', slug );
	};

	return (
		<div className="fair-events-sources-page">
			<Card>
				<CardHeader>
					<HStack justify="space-between">
						<h1>
							{ __( 'Event Feeds', 'fair-events-experimental' ) }
						</h1>
						<Button variant="primary" onClick={ handleCreate }>
							{ __(
								'Add Event Feed',
								'fair-events-experimental'
							) }
						</Button>
					</HStack>
				</CardHeader>
				<CardBody>
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

						{ success && (
							<Notice
								status="success"
								isDismissible
								onRemove={ () => setSuccess( null ) }
							>
								{ success }
							</Notice>
						) }

						{ loading && (
							<div className="sources-loading">
								<Spinner />
								<p>
									{ __(
										'Loading event feeds…',
										'fair-events-experimental'
									) }
								</p>
							</div>
						) }

						{ ! loading && sources.length === 0 && (
							<div className="sources-empty">
								<p>
									{ __(
										'No event feeds yet. Add your first event feed to get started.',
										'fair-events-experimental'
									) }
								</p>
							</div>
						) }

						{ ! loading && sources.length > 0 && (
							<table className="wp-list-table widefat fixed striped">
								<thead>
									<tr>
										<th>
											{ __(
												'Name',
												'fair-events-experimental'
											) }
										</th>
										<th>
											{ __(
												'Slug',
												'fair-events-experimental'
											) }
										</th>
										<th>
											{ __(
												'Feed inputs',
												'fair-events-experimental'
											) }
										</th>
										<th>
											{ __(
												'iCal Feed',
												'fair-events-experimental'
											) }
										</th>
										<th>
											{ __(
												'JSON API',
												'fair-events-experimental'
											) }
										</th>
										<th>
											{ __(
												'Status',
												'fair-events-experimental'
											) }
										</th>
										<th>
											{ __(
												'Actions',
												'fair-events-experimental'
											) }
										</th>
									</tr>
								</thead>
								<tbody>
									{ sources.map( ( source ) => (
										<tr key={ source.id }>
											<td>
												<strong>
													<a
														href={ `admin.php?page=fair-events-source-view&source_id=${ source.id }` }
													>
														{ source.name }
													</a>
												</strong>
											</td>
											<td>
												<code>{ source.slug }</code>
											</td>
											<td>
												{ sprintf(
													/* translators: %d: number of feed inputs */
													_n(
														'%d feed input',
														'%d feed inputs',
														source.data_sources
															?.length || 0,
														'fair-events-experimental'
													),
													source.data_sources
														?.length || 0
												) }
											</td>
											<td>
												<CopyUrlButton
													url={ getIcalUrl(
														source.slug
													) }
													tooltip={ __(
														'Copy iCal feed URL',
														'fair-events-experimental'
													) }
												/>
											</td>
											<td>
												<CopyUrlButton
													url={ getJsonUrl(
														source.slug
													) }
													tooltip={ __(
														'Copy JSON API URL',
														'fair-events-experimental'
													) }
												/>
											</td>
											<td>
												{ getStatusBadge(
													source.enabled
												) }
											</td>
											<td>
												<HStack spacing={ 2 }>
													<Button
														variant="secondary"
														size="small"
														href={ `admin.php?page=fair-events-source-view&source_id=${ source.id }` }
													>
														{ __(
															'View',
															'fair-events-experimental'
														) }
													</Button>
													<Button
														variant="secondary"
														size="small"
														onClick={ () =>
															handleEdit( source )
														}
													>
														{ __(
															'Edit',
															'fair-events-experimental'
														) }
													</Button>
													<Button
														variant="tertiary"
														size="small"
														isDestructive
														onClick={ () =>
															handleDelete(
																source.id
															)
														}
													>
														{ __(
															'Delete',
															'fair-events-experimental'
														) }
													</Button>
												</HStack>
											</td>
										</tr>
									) ) }
								</tbody>
							</table>
						) }
					</VStack>
				</CardBody>
			</Card>

			{ isFormOpen && (
				<Modal
					title={
						editingSource
							? __(
									'Edit Event Feed',
									'fair-events-experimental'
								)
							: __( 'Add Event Feed', 'fair-events-experimental' )
					}
					onRequestClose={ handleFormCancel }
					style={ { maxWidth: '800px', width: '100%' } }
				>
					<SourceForm
						source={ editingSource }
						onSuccess={ handleFormSuccess }
						onCancel={ handleFormCancel }
					/>
				</Modal>
			) }
		</div>
	);
};

export default SourcesList;
