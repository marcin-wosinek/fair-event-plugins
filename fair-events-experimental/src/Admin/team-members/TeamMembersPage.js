/**
 * WordPress dependencies
 */
import { __, _n, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import {
	Button,
	Notice,
	SearchControl,
	Spinner,
	__experimentalConfirmDialog as ConfirmDialog,
	__experimentalVStack as VStack,
} from '@wordpress/components';

/**
 * Shared dependencies
 */
import {
	AdminTable,
	AdminTableCell,
	AdminTableHeaderCell,
	ItemIdentity,
	ListHeader,
	ListToolbar,
	ListToolbarField,
	ResultCount,
	RowActions,
	TableMessage,
} from 'fair-events-shared/src/admin-table/index.js';
import { decodeEntityText } from 'fair-events-shared/src/event-utils.js';

/**
 * Internal dependencies
 */
import ConfirmActionModal from '../components/ConfirmActionModal.js';
import useEditorView from '../components/useEditorView.js';
import TeamMemberForm from './TeamMemberForm.js';
import {
	createTeamMember,
	deleteTeamMember,
	loadTeamMember,
	loadTeamMembers,
	updateTeamMember,
} from './team-members-api.js';
import {
	fieldErrors,
	manageEventUrl,
	memberName,
	toFormState,
	toSavePayload,
} from './utils.js';

/**
 * Manage Event page URL, from the page's bootstrap data.
 *
 * @return {string} URL.
 */
function manageEventBaseUrl() {
	return (
		window.fairEventsTeamMembersData?.manageEventUrl ||
		'admin.php?page=fair-events-manage-event'
	);
}

/**
 * Title of a linked event, with a fallback for untitled ones.
 *
 * @param {Object} event Linked event `{ title }`.
 * @return {string} Title.
 */
function eventTitle( event ) {
	const title = decodeEntityText( event.title ).trim();
	return title || __( '(untitled event)', 'fair-events-experimental' );
}

/**
 * List of linked events, each linking to its Manage Event page.
 *
 * @param {Object}   props        Component props.
 * @param {Object[]} props.events Linked events.
 * @return {JSX.Element} The list.
 */
function LinkedEvents( { events } ) {
	return (
		<ul className="fair-events-team-members__events">
			{ events.map( ( event ) => (
				<li key={ event.event_date_id }>
					<a
						href={ manageEventUrl(
							manageEventBaseUrl(),
							event.event_date_id
						) }
					>
						{ eventTitle( event ) }
					</a>
					{ event.start_date && (
						<span className="fair-events-team-members__event-meta">
							{ ' — ' }
							{ event.is_series
								? sprintf(
										/* translators: %s: start date of the series' first date (YYYY-MM-DD) */
										__(
											'series from %s',
											'fair-events-experimental'
										),
										event.start_date
									)
								: event.start_date }
						</span>
					) }
				</li>
			) ) }
		</ul>
	);
}

/**
 * Message for a failed save, preferring the server's per-field detail.
 *
 * @param {Object} error apiFetch rejection.
 * @return {string} Message.
 */
function saveErrorMessage( error ) {
	if ( Object.keys( fieldErrors( error ) ).length ) {
		return __(
			'The team member was not saved. Correct the highlighted fields and try again.',
			'fair-events-experimental'
		);
	}
	return error?.message
		? sprintf(
				/* translators: %s: error message returned by the server */
				__(
					'The team member was not saved: %s',
					'fair-events-experimental'
				),
				error.message
			)
		: __(
				'The team member was not saved. Try again.',
				'fair-events-experimental'
			);
}

/**
 * Team Members Page Component
 *
 * The Fair Events → Team members page, registered while the `team-members`
 * bundle is on: lists the sitewide directory and edits one profile at a
 * time. A profile still on an event's team cannot be deleted; the
 * confirmation names those events so they can be unlinked first.
 *
 * @return {JSX.Element} The page.
 */
export default function TeamMembersPage() {
	const [ members, setMembers ] = useState( null );
	const [ loadError, setLoadError ] = useState( null );
	const [ search, setSearch ] = useState( '' );
	// { id, saved, draft, events }: id is null while adding a new member.
	const [ editor, setEditor ] = useState( null );
	const [ isSaving, setIsSaving ] = useState( false );
	const [ saveError, setSaveError ] = useState( null );
	const [ errors, setErrors ] = useState( {} );
	const [ notice, setNotice ] = useState( null );
	const [ pendingLeave, setPendingLeave ] = useState( null );
	// { member, events: Object[]|null, eventsError }: the delete target.
	const [ pendingDelete, setPendingDelete ] = useState( null );
	const [ isDeleting, setIsDeleting ] = useState( false );
	const [ deleteError, setDeleteError ] = useState( null );
	const savingRef = useRef( false );
	const deletingRef = useRef( false );

	const load = useCallback( () => {
		setLoadError( null );
		return loadTeamMembers()
			.then( setMembers )
			.catch( ( error ) => {
				setLoadError(
					error?.message ||
						__(
							'The team members could not be loaded.',
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

	const openEditor = ( member ) => {
		const state = toFormState( member );
		focusTarget.current = 'editor';
		setSaveError( null );
		setErrors( {} );
		setNotice( null );
		setEditor( {
			id: member ? member.id : null,
			saved: state,
			draft: state,
			events: member ? null : [],
		} );
		if ( member ) {
			loadTeamMember( member.id )
				.then( ( profile ) =>
					setEditor( ( current ) =>
						current && current.id === profile.id
							? { ...current, events: profile.events || [] }
							: current
					)
				)
				.catch( () =>
					setEditor( ( current ) =>
						current && current.id === member.id
							? { ...current, events: false }
							: current
					)
				);
		}
	};

	const closeEditor = () => {
		focusTarget.current = 'list';
		setSaveError( null );
		setErrors( {} );
		setEditor( null );
	};

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
		setErrors( {} );
		setNotice( null );

		const payload = toSavePayload( editor.draft );
		const isNew = ! editor.id;
		const request = isNew
			? createTeamMember( payload )
			: updateTeamMember( editor.id, payload );

		request
			.then( ( profile ) => {
				const state = toFormState( profile );
				setEditor( {
					id: profile.id,
					saved: state,
					draft: state,
					events: profile.events || [],
				} );
				setMembers( ( list ) => {
					const current = list || [];
					return current.some( ( item ) => item.id === profile.id )
						? current.map( ( item ) =>
								item.id === profile.id ? profile : item
							)
						: [ ...current, profile ];
				} );
				setNotice( {
					status: 'success',
					message: isNew
						? __( 'Team member added.', 'fair-events-experimental' )
						: __(
								'Team member saved. Every event they are on shows the new details.',
								'fair-events-experimental'
							),
				} );
			} )
			.catch( ( error ) => {
				// Keep everything as entered so the user can fix and retry.
				setErrors( fieldErrors( error ) );
				setSaveError( saveErrorMessage( error ) );
			} )
			.finally( () => {
				savingRef.current = false;
				setIsSaving( false );
			} );
	};

	const openDelete = ( member ) => {
		setDeleteError( null );
		setNotice( null );
		setPendingDelete( {
			member,
			events: member.event_count ? null : [],
		} );
		if ( member.event_count ) {
			loadTeamMember( member.id )
				.then( ( profile ) =>
					setPendingDelete( ( current ) =>
						current && current.member.id === member.id
							? { ...current, events: profile.events || [] }
							: current
					)
				)
				.catch( ( error ) =>
					setDeleteError(
						error?.message ||
							__(
								'The events of this team member could not be loaded.',
								'fair-events-experimental'
							)
					)
				);
		}
	};

	const closeDelete = () => {
		if ( deletingRef.current ) {
			return;
		}
		setDeleteError( null );
		setPendingDelete( null );
	};

	const confirmDelete = async () => {
		if ( deletingRef.current || ! pendingDelete ) {
			return;
		}
		deletingRef.current = true;
		setIsDeleting( true );
		setDeleteError( null );
		const { member } = pendingDelete;
		try {
			await deleteTeamMember( member.id );
			setMembers( ( list ) =>
				( list || [] ).filter( ( item ) => item.id !== member.id )
			);
			setPendingDelete( null );
			focusTarget.current = 'list';
			setEditor( null );
			setNotice( {
				status: 'success',
				message: sprintf(
					/* translators: %s: team member name */
					__(
						'%s was deleted from the directory.',
						'fair-events-experimental'
					),
					memberName( member )
				),
			} );
			listHeadingRef.current?.focus();
		} catch ( error ) {
			if ( 'rest_team_member_linked' === error?.code ) {
				// Linked meanwhile: show the events to unlink first.
				setPendingDelete( ( current ) =>
					current
						? { ...current, events: error.data?.events || [] }
						: current
				);
			} else {
				setDeleteError(
					error?.message ||
						__(
							'The team member could not be deleted. Try again.',
							'fair-events-experimental'
						)
				);
			}
		} finally {
			deletingRef.current = false;
			setIsDeleting( false );
		}
	};

	const query = search.trim().toLowerCase();
	const visible = ( members || [] ).filter( ( member ) =>
		query
			? [ member.name, member.surname, member.email, member.instagram ]
					.join( ' ' )
					.toLowerCase()
					.includes( query )
			: true
	);

	const renderList = () => {
		if ( ! members ) {
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
					{ __(
						'Loading team members…',
						'fair-events-experimental'
					) }
				</TableMessage>
			);
		}

		if ( ! members.length ) {
			return (
				<TableMessage status="empty">
					{ __(
						'No team members yet. Add the people who help run your events, then add them to each event’s team in Manage Event.',
						'fair-events-experimental'
					) }
				</TableMessage>
			);
		}

		if ( ! visible.length ) {
			return (
				<TableMessage
					status="no-results"
					onClear={ () => setSearch( '' ) }
					clearLabel={ __(
						'Clear search',
						'fair-events-experimental'
					) }
				>
					{ sprintf(
						/* translators: %s: search text */
						__(
							'No team members match “%s”.',
							'fair-events-experimental'
						),
						search.trim()
					) }
				</TableMessage>
			);
		}

		return (
			<AdminTable
				caption={ __( 'Team members', 'fair-events-experimental' ) }
			>
				<thead>
					<tr>
						<AdminTableHeaderCell variant="identity">
							{ __( 'Name', 'fair-events-experimental' ) }
						</AdminTableHeaderCell>
						<AdminTableHeaderCell>
							{ __( 'Phone', 'fair-events-experimental' ) }
						</AdminTableHeaderCell>
						<AdminTableHeaderCell>
							{ __( 'Events', 'fair-events-experimental' ) }
						</AdminTableHeaderCell>
						<AdminTableHeaderCell variant="actions">
							{ __( 'Actions', 'fair-events-experimental' ) }
						</AdminTableHeaderCell>
					</tr>
				</thead>
				<tbody>
					{ visible.map( ( member ) => {
						const name = memberName( member );
						return (
							<tr key={ member.id }>
								<AdminTableCell variant="identity">
									<ItemIdentity
										title={ name }
										onClick={ ( event ) => {
											event?.preventDefault?.();
											openEditor( member );
										} }
										href="#"
										meta={
											[ member.email, member.instagram ]
												.filter( Boolean )
												.join( ' · ' ) || undefined
										}
									/>
								</AdminTableCell>
								<AdminTableCell
									label={ __(
										'Phone',
										'fair-events-experimental'
									) }
								>
									{ member.phone || '—' }
								</AdminTableCell>
								<AdminTableCell
									label={ __(
										'Events',
										'fair-events-experimental'
									) }
								>
									{ member.event_count
										? sprintf(
												/* translators: %d: number of events */
												_n(
													'%d event',
													'%d events',
													member.event_count,
													'fair-events-experimental'
												),
												member.event_count
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
												/* translators: %s: team member name */
												__(
													'Edit “%s”',
													'fair-events-experimental'
												),
												name
											),
											onClick: () => openEditor( member ),
										} }
										secondary={ [
											{
												label: __(
													'Delete',
													'fair-events-experimental'
												),
												isDestructive: true,
												onClick: () =>
													openDelete( member ),
											},
										] }
										moreLabel={ sprintf(
											/* translators: %s: team member name */
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
					} ) }
				</tbody>
			</AdminTable>
		);
	};

	const deleteModal = pendingDelete && (
		<ConfirmActionModal
			title={ sprintf(
				/* translators: %s: team member name */
				__( 'Delete team member — %s', 'fair-events-experimental' ),
				memberName( pendingDelete.member )
			) }
			confirmLabel={ __(
				'Delete team member',
				'fair-events-experimental'
			) }
			busyLabel={ __( 'Deleting…', 'fair-events-experimental' ) }
			isDestructive
			isBusy={ isDeleting }
			confirmDisabled={
				null === pendingDelete.events || pendingDelete.events.length > 0
			}
			error={ deleteError }
			onConfirm={ confirmDelete }
			onCancel={ closeDelete }
		>
			{ null === pendingDelete.events && ! deleteError && (
				<p>
					<Spinner />{ ' ' }
					{ __(
						'Checking the events of this team member…',
						'fair-events-experimental'
					) }
				</p>
			) }
			{ pendingDelete.events && pendingDelete.events.length > 0 && (
				<>
					<p>
						{ sprintf(
							/* translators: 1: team member name, 2: number of events */
							_n(
								'%1$s is on the team of %2$d event. Remove them from it in Manage Event before deleting the profile:',
								'%1$s is on the team of %2$d events. Remove them from each in Manage Event before deleting the profile:',
								pendingDelete.events.length,
								'fair-events-experimental'
							),
							memberName( pendingDelete.member ),
							pendingDelete.events.length
						) }
					</p>
					<LinkedEvents events={ pendingDelete.events } />
				</>
			) }
			{ pendingDelete.events && 0 === pendingDelete.events.length && (
				<p>
					{ sprintf(
						/* translators: %s: team member name */
						__(
							'Delete the profile of %s, with all their contact details? It is not on any event’s team. This cannot be undone.',
							'fair-events-experimental'
						),
						memberName( pendingDelete.member )
					) }
				</p>
			) }
		</ConfirmActionModal>
	);

	const noticeElement = notice && (
		<Notice status={ notice.status } onRemove={ () => setNotice( null ) }>
			{ notice.message }
		</Notice>
	);

	if ( ! editor ) {
		return (
			<div className="wrap fair-events-team-members-page">
				<ListHeader
					ref={ listHeadingRef }
					title={ __( 'Team members', 'fair-events-experimental' ) }
					actions={
						<Button
							variant="primary"
							onClick={ () => openEditor( null ) }
							disabled={ ! members }
						>
							{ __(
								'Add team member',
								'fair-events-experimental'
							) }
						</Button>
					}
				/>
				<VStack spacing={ 3 }>
					<p className="description" style={ { margin: 0 } }>
						{ __(
							'People who help run your events. Add them to an event’s team in Manage Event → Event Details; a series shares one team across all its dates.',
							'fair-events-experimental'
						) }
					</p>
					{ noticeElement }
					{ members && loadError && (
						<Notice status="error" isDismissible={ false }>
							{ loadError }
						</Notice>
					) }
					{ members && members.length > 0 && (
						<ListToolbar
							count={
								<ResultCount>
									{ sprintf(
										/* translators: %d: number of team members shown */
										_n(
											'%d team member',
											'%d team members',
											visible.length,
											'fair-events-experimental'
										),
										visible.length
									) }
								</ResultCount>
							}
						>
							<ListToolbarField wide>
								<SearchControl
									label={ __(
										'Search team members',
										'fair-events-experimental'
									) }
									value={ search }
									onChange={ setSearch }
									__nextHasNoMarginBottom
								/>
							</ListToolbarField>
						</ListToolbar>
					) }
					{ renderList() }
				</VStack>
				{ deleteModal }
			</div>
		);
	}

	const savedName = editor.id ? memberName( editor.saved ) : '';
	const heading = editor.id
		? sprintf(
				/* translators: %s: team member name */
				__( 'Edit team member: %s', 'fair-events-experimental' ),
				savedName
			)
		: __( 'Add team member', 'fair-events-experimental' );

	return (
		<div className="wrap fair-events-team-members-page">
			<VStack spacing={ 3 }>
				<div>
					<Button
						variant="link"
						onClick={ () => leaveEditor( closeEditor ) }
						disabled={ isSaving }
					>
						{ __(
							'← All team members',
							'fair-events-experimental'
						) }
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
				{ noticeElement }
				<TeamMemberForm
					value={ editor.draft }
					onChange={ ( draft ) =>
						setEditor( ( current ) => ( { ...current, draft } ) )
					}
					onSubmit={ handleSave }
					isSaving={ isSaving }
					isNew={ ! editor.id }
					errors={ errors }
				/>
				{ editor.id && (
					<section className="fair-events-team-members__linked">
						<h2>{ __( 'Events', 'fair-events-experimental' ) }</h2>
						{ null === editor.events && <Spinner /> }
						{ false === editor.events && (
							<Notice status="warning" isDismissible={ false }>
								{ __(
									'The events of this team member could not be loaded.',
									'fair-events-experimental'
								) }
							</Notice>
						) }
						{ Array.isArray( editor.events ) &&
							( editor.events.length ? (
								<LinkedEvents events={ editor.events } />
							) : (
								<p className="description">
									{ __(
										'Not on any event’s team yet. Add them in Manage Event → Event Details.',
										'fair-events-experimental'
									) }
								</p>
							) ) }
						<div>
							<Button
								variant="tertiary"
								isDestructive
								onClick={ () =>
									openDelete( {
										id: editor.id,
										...editor.saved,
										event_count: Array.isArray(
											editor.events
										)
											? editor.events.length
											: 1,
									} )
								}
								disabled={ isSaving }
							>
								{ __(
									'Delete team member',
									'fair-events-experimental'
								) }
							</Button>
						</div>
					</section>
				) }
			</VStack>
			{ deleteModal }
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
							/* translators: %s: team member name */
							__(
								'Discard your unsaved changes to “%s”? The saved profile stays as it was.',
								'fair-events-experimental'
							),
							savedName
						)
					: __(
							'Discard the team member you started adding? Nothing has been saved yet.',
							'fair-events-experimental'
						) }
			</ConfirmDialog>
		</div>
	);
}
