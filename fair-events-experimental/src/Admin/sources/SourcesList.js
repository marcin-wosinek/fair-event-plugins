/**
 * WordPress dependencies
 */
import { useState, useEffect, useRef } from '@wordpress/element';
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { Button, Notice, Modal } from '@wordpress/components';

/**
 * Shared dependencies
 */
import {
	AdminTable,
	AdminTableHeaderCell,
	AdminTableCell,
	ItemIdentity,
	StatusLabel,
	RowActions,
	TableMessage,
	ListHeader,
	ListToolbar,
	ResultCount,
} from 'fair-events-shared/src/admin-table/index.js';

/**
 * Internal dependencies
 */
import SourceForm from './components/SourceForm.js';
import ConfirmActionModal, {
	useConfirmAction,
} from '../components/ConfirmActionModal.js';
import './style.css';

const detailsUrl = ( source ) =>
	`admin.php?page=fair-events-source-view&source_id=${ source.id }`;

const feedName = ( source ) =>
	source.name || __( '(untitled feed)', 'fair-events-experimental' );

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

const SourcesList = () => {
	const [ sources, setSources ] = useState( [] );
	const [ hasLoaded, setHasLoaded ] = useState( false );
	const [ loading, setLoading ] = useState( true );
	const [ loadError, setLoadError ] = useState( null );
	// One action result at a time; `key` re-announces a repeated message.
	const [ notice, setNotice ] = useState( null );
	const [ isFormOpen, setIsFormOpen ] = useState( false );
	const [ editingSource, setEditingSource ] = useState( null );
	const [ focusHeading, setFocusHeading ] = useState( false );
	const deleteFeed = useConfirmAction();
	const headingRef = useRef( null );
	const latestLoad = useRef( 0 );
	const noticeKey = useRef( 0 );

	const showNotice = ( status, message ) => {
		noticeKey.current += 1;
		setNotice( { status, message, key: noticeKey.current } );
	};

	// Loaded rows stay mounted while a reload runs or fails, so the
	// organizer keeps their place and focus can return to a row's controls.
	const loadSources = async () => {
		const request = ++latestLoad.current;
		setLoading( true );
		setLoadError( null );

		try {
			const data = await apiFetch( {
				path: '/fair-events/v1/sources',
			} );
			if ( request === latestLoad.current ) {
				setSources( Array.isArray( data ) ? data : [] );
				setHasLoaded( true );
			}
		} catch ( err ) {
			if ( request === latestLoad.current ) {
				setLoadError(
					err?.message ||
						__(
							'Failed to load event feeds.',
							'fair-events-experimental'
						)
				);
			}
		} finally {
			if ( request === latestLoad.current ) {
				setLoading( false );
			}
		}
	};

	useEffect( () => {
		loadSources();
	}, [] );

	// After a deletion the row and its menu trigger are gone. Focus the
	// heading once the dialog has unmounted and returned focus.
	useEffect( () => {
		if ( focusHeading && ! deleteFeed.target ) {
			headingRef.current?.focus();
			setFocusHeading( false );
		}
	}, [ focusHeading, deleteFeed.target ] );

	const handleCreate = () => {
		setEditingSource( null );
		setIsFormOpen( true );
	};

	const handleEdit = ( source ) => {
		setEditingSource( source );
		setIsFormOpen( true );
	};

	const handleCopy = async ( source, kind ) => {
		const name = feedName( source );
		const url =
			'ical' === kind
				? getIcalUrl( source.slug )
				: getJsonUrl( source.slug );
		try {
			if ( ! window.navigator?.clipboard?.writeText ) {
				throw new Error( 'Clipboard API unavailable' );
			}
			await window.navigator.clipboard.writeText( url );
		} catch {
			showNotice(
				'error',
				'ical' === kind
					? sprintf(
							/* translators: 1: event feed name, 2: iCal feed URL */
							__(
								'The iCal feed URL for “%1$s” could not be copied to the clipboard. Copy it here instead: %2$s',
								'fair-events-experimental'
							),
							name,
							url
						)
					: sprintf(
							/* translators: 1: event feed name, 2: JSON API URL */
							__(
								'The JSON API URL for “%1$s” could not be copied to the clipboard. Copy it here instead: %2$s',
								'fair-events-experimental'
							),
							name,
							url
						)
			);
			return;
		}
		showNotice(
			'success',
			'ical' === kind
				? sprintf(
						/* translators: %s: event feed name */
						__(
							'iCal feed URL for “%s” copied.',
							'fair-events-experimental'
						),
						name
					)
				: sprintf(
						/* translators: %s: event feed name */
						__(
							'JSON API URL for “%s” copied.',
							'fair-events-experimental'
						),
						name
					)
		);
	};

	const handleDelete = () =>
		deleteFeed.run(
			async ( source ) => {
				await apiFetch( {
					path: `/fair-events/v1/sources/${ source.id }`,
					method: 'DELETE',
				} );
				setSources( ( current ) =>
					current.filter( ( item ) => item.id !== source.id )
				);
				showNotice(
					'success',
					sprintf(
						/* translators: %s: event feed name */
						__(
							'Event feed “%s” deleted.',
							'fair-events-experimental'
						),
						feedName( source )
					)
				);
				setFocusHeading( true );
				loadSources();
			},
			__(
				'The event feed could not be deleted. Try again.',
				'fair-events-experimental'
			)
		);

	const handleFormSuccess = () => {
		setIsFormOpen( false );
		setEditingSource( null );
		showNotice(
			'success',
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

	const getWhatsAppSummary = ( source ) => {
		if ( ! source.weekly_summary_url ) {
			return __(
				'Choose a page to enable the WhatsApp summary.',
				'fair-events-experimental'
			);
		}
		if ( ! source.enabled ) {
			return __(
				'Enable this feed to use its WhatsApp summary.',
				'fair-events-experimental'
			);
		}
		return (
			<a href={ source.weekly_summary_url }>
				{ __( 'Open WhatsApp summary', 'fair-events-experimental' ) }
			</a>
		);
	};

	const columns = {
		feed: __( 'Feed', 'fair-events-experimental' ),
		inputs: __( 'Feed inputs', 'fair-events-experimental' ),
		whatsapp: __( 'WhatsApp', 'fair-events-experimental' ),
		status: __( 'Status', 'fair-events-experimental' ),
		actions: __( 'Actions', 'fair-events-experimental' ),
	};

	const renderRow = ( source ) => {
		const name = feedName( source );
		const inputCount = source.data_sources?.length || 0;
		return (
			<tr key={ source.id }>
				<AdminTableCell label={ columns.feed } variant="identity">
					<ItemIdentity
						title={ source.name }
						fallback={ __(
							'(untitled feed)',
							'fair-events-experimental'
						) }
						href={ detailsUrl( source ) }
						meta={ source.slug }
					/>
				</AdminTableCell>
				<AdminTableCell label={ columns.inputs }>
					{ sprintf(
						/* translators: %d: number of feed inputs */
						_n(
							'%d feed input',
							'%d feed inputs',
							inputCount,
							'fair-events-experimental'
						),
						inputCount
					) }
				</AdminTableCell>
				<AdminTableCell label={ columns.whatsapp }>
					{ getWhatsAppSummary( source ) }
				</AdminTableCell>
				<AdminTableCell label={ columns.status } variant="status">
					{ source.enabled ? (
						<StatusLabel tone="success">
							{ __( 'Enabled', 'fair-events-experimental' ) }
						</StatusLabel>
					) : (
						<StatusLabel tone="neutral">
							{ __( 'Disabled', 'fair-events-experimental' ) }
						</StatusLabel>
					) }
				</AdminTableCell>
				<AdminTableCell label={ columns.actions } variant="actions">
					<RowActions
						primary={ {
							label: __( 'Edit', 'fair-events-experimental' ),
							accessibleLabel: sprintf(
								/* translators: %s: event feed name */
								__( 'Edit “%s”', 'fair-events-experimental' ),
								name
							),
							onClick: () => handleEdit( source ),
						} }
						secondary={ [
							{
								label: __(
									'Copy iCal feed URL',
									'fair-events-experimental'
								),
								onClick: () => handleCopy( source, 'ical' ),
							},
							{
								label: __(
									'Copy JSON API URL',
									'fair-events-experimental'
								),
								onClick: () => handleCopy( source, 'json' ),
							},
							{
								label: __(
									'Delete',
									'fair-events-experimental'
								),
								isDestructive: true,
								onClick: () => deleteFeed.open( source ),
							},
						] }
						moreLabel={ sprintf(
							/* translators: %s: event feed name */
							__(
								'More actions for “%s”',
								'fair-events-experimental'
							),
							name
						) }
					/>
				</AdminTableCell>
			</tr>
		);
	};

	const loadErrorMessage = loadError && (
		<TableMessage
			status="error"
			onRetry={ loadSources }
			retryLabel={ __( 'Try again', 'fair-events-experimental' ) }
		>
			{ loadError }
		</TableMessage>
	);

	const addFirstButton = (
		<Button variant="secondary" onClick={ handleCreate }>
			{ __( 'Add your first event feed', 'fair-events-experimental' ) }
		</Button>
	);

	let body;
	if ( ! hasLoaded ) {
		body =
			loading || ! loadError ? (
				<TableMessage status="loading">
					{ __( 'Loading event feeds…', 'fair-events-experimental' ) }
				</TableMessage>
			) : (
				loadErrorMessage
			);
	} else {
		body = (
			<>
				{ loadErrorMessage }
				{ sources.length === 0 ? (
					<TableMessage status="empty" actions={ addFirstButton }>
						{ __(
							'No event feeds yet. Add your first event feed to get started.',
							'fair-events-experimental'
						) }
					</TableMessage>
				) : (
					<>
						{ /* The complete list, unpaginated and unfiltered. */ }
						<ListToolbar
							count={
								<ResultCount>
									{ sprintf(
										/* translators: %d: number of event feeds */
										_n(
											'%d event feed',
											'%d event feeds',
											sources.length,
											'fair-events-experimental'
										),
										sources.length
									) }
								</ResultCount>
							}
						/>
						<AdminTable
							caption={ __(
								'Event feeds',
								'fair-events-experimental'
							) }
						>
							<thead>
								<tr>
									<AdminTableHeaderCell variant="identity">
										{ columns.feed }
									</AdminTableHeaderCell>
									<AdminTableHeaderCell>
										{ columns.inputs }
									</AdminTableHeaderCell>
									<AdminTableHeaderCell>
										{ columns.whatsapp }
									</AdminTableHeaderCell>
									<AdminTableHeaderCell variant="status">
										{ columns.status }
									</AdminTableHeaderCell>
									<AdminTableHeaderCell variant="actions">
										{ columns.actions }
									</AdminTableHeaderCell>
								</tr>
							</thead>
							<tbody>{ sources.map( renderRow ) }</tbody>
						</AdminTable>
					</>
				) }
			</>
		);
	}

	return (
		<div className="wrap fair-events-sources-page">
			<ListHeader
				ref={ headingRef }
				title={ __( 'Event Feeds', 'fair-events-experimental' ) }
				actions={
					<Button variant="primary" onClick={ handleCreate }>
						{ __( 'Add Event Feed', 'fair-events-experimental' ) }
					</Button>
				}
			/>
			{ notice && (
				<Notice
					key={ notice.key }
					status={ notice.status }
					isDismissible
					onRemove={ () => setNotice( null ) }
					className="fair-events-sources-page__notice"
				>
					{ notice.message }
				</Notice>
			) }
			{ body }

			{ deleteFeed.target && (
				<ConfirmActionModal
					title={ sprintf(
						/* translators: %s: event feed name */
						__(
							'Delete event feed — %s',
							'fair-events-experimental'
						),
						feedName( deleteFeed.target )
					) }
					confirmLabel={ __(
						'Delete event feed',
						'fair-events-experimental'
					) }
					busyLabel={ __( 'Deleting…', 'fair-events-experimental' ) }
					isDestructive
					isBusy={ deleteFeed.isBusy }
					error={ deleteFeed.error }
					onConfirm={ handleDelete }
					onCancel={ deleteFeed.close }
				>
					<p>
						{ sprintf(
							/* translators: %s: event feed slug */
							__(
								'Its iCal and JSON feed URLs (slug “%s”) stop working for every calendar or site that reads them.',
								'fair-events-experimental'
							),
							deleteFeed.target.slug
						) }
					</p>
					<p>
						{ __(
							'Events and categories included in the feed are not changed. Deleting the feed cannot be undone.',
							'fair-events-experimental'
						) }
					</p>
				</ConfirmActionModal>
			) }

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
