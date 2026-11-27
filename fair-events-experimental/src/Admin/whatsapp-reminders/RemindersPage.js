/**
 * WordPress dependencies
 */
import apiFetch from '@wordpress/api-fetch';
import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useState } from '@wordpress/element';
import { Button, Notice } from '@wordpress/components';

/**
 * Shared dependencies
 */
import {
	AdminTable,
	AdminTableCell,
	AdminTableHeaderCell,
	ItemIdentity,
	ListHeader,
	StatusLabel,
	TableMessage,
} from 'fair-events-shared/src/admin-table/index.js';

/**
 * Internal dependencies
 */
import ReminderEditor from './ReminderEditor.js';
import RunHistory from './RunHistory.js';
import {
	DAYS,
	PATH,
	TEMPLATES_PATH,
	draftFromReminder,
	feedStatus,
} from './model.js';

/**
 * Warn before leaving the page with unsaved edits.
 *
 * @param {boolean} dirty Whether there are unsaved edits.
 */
function useUnsavedWarning( dirty ) {
	useEffect( () => {
		if ( ! dirty ) {
			return undefined;
		}
		const warn = ( event ) => {
			event.preventDefault();
			event.returnValue = '';
		};
		window.addEventListener( 'beforeunload', warn );
		return () => window.removeEventListener( 'beforeunload', warn );
	}, [ dirty ] );
}

/**
 * Fair Events → Event notifications → WhatsApp sharing reminders: one
 * designated collaborator per event feed, reminded weekly to share the
 * feed's summary page by hand.
 *
 * @param {Object}      props
 * @param {string}      props.notificationsUrl Event notifications page.
 * @param {string|null} props.teamMembersUrl   Team members page, when available.
 * @param {string|null} props.sourcesUrl       Event Feeds page, when available.
 * @return {JSX.Element} The page.
 */
export default function RemindersPage( {
	notificationsUrl,
	teamMembersUrl,
	sourcesUrl,
} ) {
	const [ data, setData ] = useState( null );
	const [ loadError, setLoadError ] = useState( null );
	const [ refreshing, setRefreshing ] = useState( false );
	const [ open, setOpen ] = useState( null );
	// Unsaved form state by feed ID, kept while another feed is open.
	const [ drafts, setDrafts ] = useState( {} );
	const [ templates, setTemplates ] = useState( {
		items: null,
		error: null,
		loading: false,
	} );

	const load = useCallback( async () => {
		setRefreshing( true );
		try {
			const next = await apiFetch( { path: PATH } );
			setData( next );
			setLoadError( null );
		} catch ( error ) {
			setLoadError(
				error?.message ||
					__(
						'The sharing reminders could not be loaded.',
						'fair-events-experimental'
					)
			);
		}
		setRefreshing( false );
	}, [] );

	useEffect( () => {
		load();
	}, [ load ] );

	const ready = !! data?.connection.ready;
	useEffect( () => {
		if (
			! ready ||
			null === open ||
			templates.items ||
			templates.loading
		) {
			return;
		}
		setTemplates( { items: null, error: null, loading: true } );
		apiFetch( { path: TEMPLATES_PATH } ).then(
			( items ) => setTemplates( { items, error: null, loading: false } ),
			( error ) =>
				setTemplates( {
					items: null,
					loading: false,
					error:
						error?.message ||
						__(
							'The templates could not be loaded from WhatsApp.',
							'fair-events-experimental'
						),
				} )
		);
	}, [ ready, open, templates.items, templates.loading ] );

	const feeds = data?.feeds || [];
	const savedDraft = ( feed ) => draftFromReminder( feed.reminder );
	const isDirty = ( feed ) =>
		!! drafts[ feed.source_id ] &&
		JSON.stringify( drafts[ feed.source_id ] ) !==
			JSON.stringify( savedDraft( feed ) );
	useUnsavedWarning( feeds.some( isDirty ) );

	const openFeed = feeds.find( ( feed ) => feed.source_id === open );

	const onSaved = ( feed ) => {
		setData( ( current ) => ( {
			...current,
			feeds: current.feeds.map( ( shown ) =>
				shown.source_id === feed.source_id ? feed : shown
			),
		} ) );
		setDrafts( ( current ) => {
			const next = { ...current };
			delete next[ feed.source_id ];
			return next;
		} );
		// The history and next send reflect the saved state.
		load();
	};

	const dayLabel = ( day ) =>
		DAYS.find( ( { value } ) => value === String( day ) )?.label || '';

	return (
		<div className="wrap fair-whatsapp-reminders">
			<ListHeader
				title={ __(
					'WhatsApp sharing reminders',
					'fair-events-experimental'
				) }
			/>
			<p className="fair-whatsapp-reminders__breadcrumbs">
				<a href={ notificationsUrl }>
					{ __(
						'← Event notifications',
						'fair-events-experimental'
					) }
				</a>
			</p>
			<p>
				{ __(
					'Designate one collaborator per event feed. Each week they get a WhatsApp message whose button opens the feed’s weekly summary, so they can copy the prepared message and share it with their community. Nothing is posted to groups automatically.',
					'fair-events-experimental'
				) }
			</p>

			{ loadError && (
				<TableMessage
					status="error"
					onRetry={ load }
					retryLabel={ __( 'Try again', 'fair-events-experimental' ) }
				>
					{ loadError }
				</TableMessage>
			) }
			{ ! data && ! loadError && (
				<TableMessage status="loading">
					{ __( 'Loading reminders…', 'fair-events-experimental' ) }
				</TableMessage>
			) }

			{ data && ! ready && (
				<Notice status="warning" isDismissible={ false }>
					{ __(
						'The WhatsApp connection is not validated, so no reminder is sent. Validate it first.',
						'fair-events-experimental'
					) }{ ' ' }
					<a href={ data.connection.whatsapp_url }>
						{ __(
							'Open Fair Events → WhatsApp',
							'fair-events-experimental'
						) }
					</a>
				</Notice>
			) }

			{ data && 0 === feeds.length && (
				<TableMessage
					status="empty"
					actions={
						sourcesUrl ? (
							<a href={ sourcesUrl }>
								{ __(
									'Create an event feed',
									'fair-events-experimental'
								) }
							</a>
						) : null
					}
				>
					{ __(
						'There is no event feed yet. Each reminder links to an event feed’s weekly summary.',
						'fair-events-experimental'
					) }
				</TableMessage>
			) }

			{ data && feeds.length > 0 && (
				<AdminTable
					caption={ __(
						'Sharing reminders by event feed',
						'fair-events-experimental'
					) }
				>
					<thead>
						<tr>
							<AdminTableHeaderCell variant="identity">
								{ __(
									'Event feed',
									'fair-events-experimental'
								) }
							</AdminTableHeaderCell>
							<AdminTableHeaderCell>
								{ __(
									'Collaborator',
									'fair-events-experimental'
								) }
							</AdminTableHeaderCell>
							<AdminTableHeaderCell variant="status">
								{ __( 'Status', 'fair-events-experimental' ) }
							</AdminTableHeaderCell>
							<AdminTableHeaderCell>
								{ __(
									'Next send',
									'fair-events-experimental'
								) }
							</AdminTableHeaderCell>
							<AdminTableHeaderCell variant="actions">
								{ __( 'Actions', 'fair-events-experimental' ) }
							</AdminTableHeaderCell>
						</tr>
					</thead>
					<tbody>
						{ feeds.map( ( feed ) => {
							const status = feedStatus( feed, ready );
							const reminder = feed.reminder;
							return (
								<tr key={ feed.source_id }>
									<AdminTableCell
										variant="identity"
										label={ __(
											'Event feed',
											'fair-events-experimental'
										) }
									>
										<ItemIdentity
											title={ feed.name }
											fallback={ __(
												'(untitled feed)',
												'fair-events-experimental'
											) }
											meta={ feed.summary_url }
										>
											{ isDirty( feed ) && (
												<span className="fair-whatsapp-reminders__unsaved">
													{ __(
														'Unsaved changes',
														'fair-events-experimental'
													) }
												</span>
											) }
										</ItemIdentity>
									</AdminTableCell>
									<AdminTableCell
										label={ __(
											'Collaborator',
											'fair-events-experimental'
										) }
									>
										{ reminder?.recipient
											? reminder.recipient.name
											: __(
													'Nobody yet',
													'fair-events-experimental'
												) }
									</AdminTableCell>
									<AdminTableCell
										variant="status"
										label={ __(
											'Status',
											'fair-events-experimental'
										) }
									>
										<StatusLabel tone={ status.tone }>
											{ status.label }
										</StatusLabel>
										{ status.detail && (
											<p className="description">
												{ status.detail }
											</p>
										) }
									</AdminTableCell>
									<AdminTableCell
										label={ __(
											'Next send',
											'fair-events-experimental'
										) }
									>
										{ feed.next_run ||
											( reminder?.enabled
												? sprintf(
														/* translators: 1: weekday, 2: time of day */
														__(
															'%1$s at %2$s',
															'fair-events-experimental'
														),
														dayLabel(
															reminder.day_of_week
														),
														reminder.time_of_day
													)
												: __(
														'Not scheduled',
														'fair-events-experimental'
													) ) }
									</AdminTableCell>
									<AdminTableCell
										variant="actions"
										label={ __(
											'Actions',
											'fair-events-experimental'
										) }
									>
										<Button
											variant="link"
											onClick={ () =>
												setOpen( feed.source_id )
											}
											aria-label={ sprintf(
												/* translators: %s: event feed name */
												__(
													'Edit the reminder for %s',
													'fair-events-experimental'
												),
												feed.name
											) }
										>
											{ reminder
												? __(
														'Edit',
														'fair-events-experimental'
													)
												: __(
														'Set up',
														'fair-events-experimental'
													) }
										</Button>
									</AdminTableCell>
								</tr>
							);
						} ) }
					</tbody>
				</AdminTable>
			) }

			{ openFeed && (
				<ReminderEditor
					key={ openFeed.source_id }
					feed={ openFeed }
					draft={
						drafts[ openFeed.source_id ] || savedDraft( openFeed )
					}
					dirty={ isDirty( openFeed ) }
					onDraft={ ( draft ) =>
						setDrafts( ( current ) => ( {
							...current,
							[ openFeed.source_id ]: draft,
						} ) )
					}
					members={ data.team_members }
					membersOn={ data.team_members_available }
					teamMembersUrl={ teamMembersUrl }
					connection={ data.connection }
					templates={ templates }
					onSaved={ onSaved }
					onClose={ () => setOpen( null ) }
				/>
			) }

			{ data && (
				<RunHistory
					runs={ data.history }
					retentionDays={ data.retention_days }
					onRefresh={ load }
					refreshing={ refreshing }
				/>
			) }
		</div>
	);
}
