/**
 * WordPress dependencies
 */
import { __, _n, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import {
	Button,
	Notice,
	__experimentalConfirmDialog as ConfirmDialog,
	__experimentalVStack as VStack,
} from '@wordpress/components';

/**
 * External dependencies
 */
import OrganizerForm, {
	EMPTY_ORGANIZER,
	toSavePayload,
} from 'fair-events/src/Admin/settings/OrganizerForm.js';
import SalesSummaryCard from 'fair-events/src/Admin/settings/SalesSummaryCard.js';
import {
	AdminTable,
	AdminTableCell,
	AdminTableHeaderCell,
	ItemIdentity,
	ListHeader,
	RowActions,
	TableMessage,
} from 'fair-events-shared/src/admin-table/index.js';

/**
 * Internal dependencies
 */
import useEditorView from '../components/useEditorView.js';
import {
	DEFAULT_ORGANIZER_ID,
	createOrganizer,
	loadOrganizers,
	loadSiteDefaults,
	updateOrganizer,
} from './organizers-api.js';

/**
 * Keep only the fields the form edits, so the response's `id` and
 * `is_default` never travel back in a save payload.
 *
 * @param {Object} record Organizer record from the API.
 * @return {Object} Form state.
 */
export function toFormState( record ) {
	const state = {};
	Object.keys( EMPTY_ORGANIZER ).forEach( ( key ) => {
		state[ key ] =
			record && undefined !== record[ key ]
				? record[ key ]
				: EMPTY_ORGANIZER[ key ];
	} );
	return state;
}

/**
 * Turn a failed save into a message, preferring the server's per-field
 * detail over its generic "Invalid parameter(s)" text.
 *
 * @param {Object} error apiFetch rejection.
 * @return {string} Message to show.
 */
function saveErrorMessage( error ) {
	const params = error?.data?.params;
	const detail = params ? Object.values( params ).filter( Boolean ) : [];
	const serverMessage = detail.length ? detail.join( ' ' ) : error?.message;

	return serverMessage
		? sprintf(
				/* translators: %s: error message returned by the server */
				__(
					'The organizer was not saved: %s',
					'fair-events-experimental'
				),
				serverMessage
			)
		: __(
				'The organizer was not saved. Try again.',
				'fair-events-experimental'
			);
}

/**
 * Organizers Page Component
 *
 * The Fair Events → Organizers page, registered while the `organizers`
 * bundle is on (Settings then has no Organizer tab): lists the sitewide
 * default and the additional organizers, and edits one at a time with the
 * shared organizer form. The default keeps the site
 * fallbacks it has always had; additional organizers start blank and never
 * inherit the default's identity, logo or recipients.
 *
 * Results are reported next to the editor, not as page-level notices.
 *
 * @return {JSX.Element} The Organizers page
 */
export default function OrganizersPage() {
	const [ organizers, setOrganizers ] = useState( null );
	const [ siteDefaults, setSiteDefaults ] = useState( {
		name: '',
		website: '',
		logoId: 0,
	} );
	const [ loadError, setLoadError ] = useState( null );
	// { id, saved, draft }: id is null while adding a new organizer.
	const [ editor, setEditor ] = useState( null );
	const [ isSaving, setIsSaving ] = useState( false );
	const [ saveError, setSaveError ] = useState( null );
	const [ savedNotice, setSavedNotice ] = useState( null );
	// Action waiting for the "discard unsaved changes" confirmation.
	const [ pendingLeave, setPendingLeave ] = useState( null );
	const savingRef = useRef( false );

	const load = useCallback( () => {
		setLoadError( null );
		return Promise.all( [ loadOrganizers(), loadSiteDefaults() ] )
			.then( ( [ list, defaults ] ) => {
				setOrganizers( list );
				setSiteDefaults( defaults );
			} )
			.catch( ( error ) => {
				setLoadError(
					error?.message ||
						__(
							'The organizers could not be loaded.',
							'fair-events-experimental'
						)
				);
			} );
	}, [] );

	useEffect( () => {
		load();
	}, [ load ] );

	const { isDirty, focusTarget, listHeadingRef, editorHeadingRef } =
		useEditorView( editor );

	const openEditor = ( record ) => {
		const state = toFormState( record );
		focusTarget.current = 'editor';
		setSaveError( null );
		setSavedNotice( null );
		setEditor( {
			id: record ? record.id : null,
			saved: state,
			draft: state,
		} );
	};

	const closeEditor = () => {
		focusTarget.current = 'list';
		setSaveError( null );
		setSavedNotice( null );
		setEditor( null );
	};

	// Run an action that leaves the current record, asking first when it
	// holds unsaved changes.
	const leaveEditor = ( action ) => {
		if ( isDirty ) {
			setPendingLeave( () => action );
			return;
		}
		action();
	};

	const handleSave = () => {
		if ( savingRef.current ) {
			return;
		}
		savingRef.current = true;
		setIsSaving( true );
		setSaveError( null );
		setSavedNotice( null );

		const payload = toSavePayload( editor.draft );
		const request = editor.id
			? updateOrganizer( editor.id, payload )
			: createOrganizer( payload );

		request
			.then( ( record ) => {
				const state = toFormState( record );
				setEditor( { id: record.id, saved: state, draft: state } );
				setOrganizers( ( list ) => {
					const current = list || [];
					return current.some( ( item ) => item.id === record.id )
						? current.map( ( item ) =>
								item.id === record.id ? record : item
							)
						: [ ...current, record ];
				} );
				setSavedNotice(
					editor.id
						? __( 'Organizer saved.', 'fair-events-experimental' )
						: __( 'Organizer added.', 'fair-events-experimental' )
				);
			} )
			.catch( ( error ) => {
				// Keep everything as entered so the user can fix and retry.
				setSaveError( saveErrorMessage( error ) );
			} )
			.finally( () => {
				savingRef.current = false;
				setIsSaving( false );
			} );
	};

	const displayName = ( organizer ) => {
		if ( organizer.name ) {
			return organizer.name;
		}
		return organizer.is_default ? siteDefaults.name : '';
	};

	const renderList = () => {
		if ( ! organizers ) {
			return loadError ? (
				<TableMessage
					status="error"
					onRetry={ load }
					retryLabel={ __( 'Try again', 'fair-events-experimental' ) }
				>
					{ loadError }
				</TableMessage>
			) : (
				<TableMessage status="loading">
					{ __( 'Loading organizers…', 'fair-events-experimental' ) }
				</TableMessage>
			);
		}

		return (
			<AdminTable
				caption={ __( 'Organizers', 'fair-events-experimental' ) }
			>
				<thead>
					<tr>
						<AdminTableHeaderCell variant="identity">
							{ __( 'Name', 'fair-events-experimental' ) }
						</AdminTableHeaderCell>
						<AdminTableHeaderCell>
							{ __(
								'Notification addresses',
								'fair-events-experimental'
							) }
						</AdminTableHeaderCell>
						<AdminTableHeaderCell variant="actions">
							{ __( 'Actions', 'fair-events-experimental' ) }
						</AdminTableHeaderCell>
					</tr>
				</thead>
				<tbody>
					{ organizers.map( ( organizer ) => {
						const name = displayName( organizer );
						const label =
							name ||
							__(
								'(unnamed organizer)',
								'fair-events-experimental'
							);
						const count = organizer.notification_emails.length;
						return (
							<tr key={ organizer.id }>
								<AdminTableCell variant="identity">
									<ItemIdentity
										title={ name }
										fallback={ __(
											'(unnamed organizer)',
											'fair-events-experimental'
										) }
										meta={
											organizer.is_default
												? __(
														'Default — used for the whole site',
														'fair-events-experimental'
													)
												: undefined
										}
									/>
								</AdminTableCell>
								<AdminTableCell
									label={ __(
										'Notification addresses',
										'fair-events-experimental'
									) }
								>
									{ count
										? sprintf(
												/* translators: %d: number of notification email addresses */
												_n(
													'%d address',
													'%d addresses',
													count,
													'fair-events-experimental'
												),
												count
											)
										: __(
												'None',
												'fair-events-experimental'
											) }
								</AdminTableCell>
								<AdminTableCell variant="actions">
									<RowActions
										primary={ {
											label: __(
												'Edit',
												'fair-events-experimental'
											),
											accessibleLabel: sprintf(
												/* translators: %s: organizer name */
												__(
													'Edit “%s”',
													'fair-events-experimental'
												),
												label
											),
											onClick: () =>
												openEditor( organizer ),
										} }
									/>
								</AdminTableCell>
							</tr>
						);
					} ) }
				</tbody>
			</AdminTable>
		);
	};

	if ( ! editor ) {
		return (
			<div className="wrap fair-events-organizers-page">
				<ListHeader
					ref={ listHeadingRef }
					title={ __( 'Organizers', 'fair-events-experimental' ) }
					actions={
						<Button
							variant="primary"
							onClick={ () => openEditor( null ) }
							disabled={ ! organizers }
						>
							{ __(
								'Add organizer',
								'fair-events-experimental'
							) }
						</Button>
					}
				/>
				<VStack spacing={ 3 }>
					<p className="description" style={ { margin: 0 } }>
						{ __(
							'The default organizer identifies the whole site in its structured data. Additional organizers have their own identity and private notification addresses.',
							'fair-events-experimental'
						) }
					</p>
					{ organizers && loadError && (
						<Notice status="error" isDismissible={ false }>
							{ loadError }
						</Notice>
					) }
					{ renderList() }
					<SalesSummaryCard
						report="central"
						title={ __(
							'Central sales summary',
							'fair-events-experimental'
						) }
						description={ __(
							'One email with every organizer’s ticket sales and paid revenue, grouped by organizer and event. It goes to the default organizer’s notification addresses on its own schedule, whatever each organizer chose for its own summary.',
							'fair-events-experimental'
						) }
					/>
				</VStack>
			</div>
		);
	}

	const isDefault = DEFAULT_ORGANIZER_ID === editor.id;
	const savedName = editor.id
		? displayName( { ...editor.saved, is_default: isDefault } )
		: '';
	let heading = __( 'Add organizer', 'fair-events-experimental' );
	if ( isDefault ) {
		heading = __( 'Edit default organizer', 'fair-events-experimental' );
	} else if ( editor.id ) {
		heading = sprintf(
			/* translators: %s: organizer name */
			__( 'Edit organizer: %s', 'fair-events-experimental' ),
			savedName || __( '(unnamed organizer)', 'fair-events-experimental' )
		);
	}

	return (
		<div className="wrap fair-events-organizers-page fair-events-experimental-organizer-editor">
			<VStack spacing={ 3 }>
				<div>
					<Button
						variant="link"
						onClick={ () => leaveEditor( closeEditor ) }
						disabled={ isSaving }
					>
						{ __( '← All organizers', 'fair-events-experimental' ) }
					</Button>
				</div>
				<h1
					ref={ editorHeadingRef }
					tabIndex={ -1 }
					style={ { margin: 0, overflowWrap: 'anywhere' } }
				>
					{ heading }
				</h1>
				<hr className="wp-header-end" />
				{ isDirty && (
					<p className="description" style={ { margin: 0 } }>
						{ __( 'Unsaved changes', 'fair-events-experimental' ) }
					</p>
				) }
				{ saveError && (
					<Notice status="error" isDismissible={ false }>
						{ saveError }
					</Notice>
				) }
				{ savedNotice && (
					<Notice
						status="success"
						onRemove={ () => setSavedNotice( null ) }
					>
						{ savedNotice }
					</Notice>
				) }
			</VStack>
			<OrganizerForm
				organizer={ editor.draft }
				onChange={ ( draft ) =>
					setEditor( ( current ) => ( { ...current, draft } ) )
				}
				onSubmit={ handleSave }
				isSaving={ isSaving }
				defaults={ isDefault ? siteDefaults : null }
				requireName={ ! isDefault }
				intro={
					isDefault ? undefined : (
						<p className="description">
							{ __(
								'An additional organizer with its own identity and private notification addresses. Fields left blank stay empty: nothing is copied from the default organizer.',
								'fair-events-experimental'
							) }
						</p>
					)
				}
			/>
			{ editor.id && (
				<div style={ { marginTop: '16px' } }>
					<SalesSummaryCard
						key={ editor.id }
						report={ editor.id }
						title={ __(
							'Sales summary',
							'fair-events-experimental'
						) }
						description={ __(
							'An email with this organizer’s own events only: tickets sold and paid revenue per event in the previous day or week, with totals to date. It is off until you choose how often to send it, and it is saved separately from the organizer details above.',
							'fair-events-experimental'
						) }
					/>
				</div>
			) }
			<ConfirmDialog
				isOpen={ null !== pendingLeave }
				onConfirm={ () => {
					const action = pendingLeave;
					setPendingLeave( null );
					action();
				} }
				onCancel={ () => setPendingLeave( null ) }
				confirmButtonText={ __(
					'Discard changes',
					'fair-events-experimental'
				) }
				cancelButtonText={ __(
					'Keep editing',
					'fair-events-experimental'
				) }
			>
				{ editor.id
					? sprintf(
							/* translators: %s: organizer name */
							__(
								'Discard your unsaved changes to “%s”? The saved organizer stays as it was.',
								'fair-events-experimental'
							),
							savedName ||
								__(
									'(unnamed organizer)',
									'fair-events-experimental'
								)
						)
					: __(
							'Discard the organizer you started adding? Nothing has been saved yet.',
							'fair-events-experimental'
						) }
			</ConfirmDialog>
		</div>
	);
}
