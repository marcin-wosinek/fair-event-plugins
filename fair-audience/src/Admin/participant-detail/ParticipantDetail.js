import { __, _n, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useCallback } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	Spinner,
	Notice,
} from '@wordpress/components';
import ParticipantEditModal from '../components/ParticipantEditModal.js';
import DeleteParticipantsModal from '../components/DeleteParticipantsModal.js';
import FeedbackSnackbar from '../components/FeedbackSnackbar.js';
import { formatTimingStart } from 'fair-events-shared/src/dateTime.js';

// The All Participants page, which is the plugin's top-level menu page.
const ALL_PARTICIPANTS_URL = 'admin.php?page=fair-audience';

function formatDateTime( dateString ) {
	if ( ! dateString ) {
		return '';
	}
	const date = new Date( dateString + 'Z' );
	return date.toLocaleString();
}

// An event's date, with its start time only when one is set.
function formatEventDate( timing ) {
	return formatTimingStart( timing ) || '—';
}

const LABEL_DISPLAY = {
	collaborator: __( 'Collaborator', 'fair-audience' ),
	signed_up: __( 'Signed up', 'fair-audience' ),
	interested: __( 'Interested', 'fair-audience' ),
};

const TRANSACTION_STATUS_DISPLAY = {
	success: { color: '#00a32a', label: __( 'Paid', 'fair-audience' ) },
	pending: { color: '#dba617', label: __( 'Pending', 'fair-audience' ) },
	failed: { color: '#d63638', label: __( 'Failed', 'fair-audience' ) },
};

const EMAIL_PROFILE_DISPLAY = {
	minimal: __( 'Minimal', 'fair-audience' ),
	marketing: __( 'Marketing', 'fair-audience' ),
	declined: __( 'No marketing', 'fair-audience' ),
};

const STATUS_DISPLAY = {
	pending: __( 'Pending', 'fair-audience' ),
	confirmed: __( 'Confirmed', 'fair-audience' ),
};

// The weekly event feeds a participant chose. A saved choice says nothing
// about delivery, so the opt-out and consent stay spelled out next to it.
function WeeklyFeeds( { participant } ) {
	const feedIds = participant.weekly_feed_ids || [];
	const summary = participant.weekly_feed_summary;
	const isAll = participant.weekly_feed_mode !== 'selected';

	let deliveryNote = null;
	if ( participant.weekly_summary_opt_out ) {
		deliveryNote = __(
			'Saved preference only: this participant opted out of weekly summaries.',
			'fair-audience'
		);
	} else if (
		participant.email_profile !== 'marketing' ||
		participant.status !== 'confirmed'
	) {
		deliveryNote = __(
			'Saved preference only: weekly summaries go to confirmed participants with the Marketing email profile.',
			'fair-audience'
		);
	}

	let content;
	if ( isAll ) {
		content = (
			<>
				<strong>{ __( 'All event feeds', 'fair-audience' ) }</strong>
				<p className="fair-audience-participant-detail__note">
					{ __(
						'Includes event feeds added later.',
						'fair-audience'
					) }
				</p>
			</>
		);
	} else if ( feedIds.length === 0 ) {
		content = <strong>{ __( 'No event feeds', 'fair-audience' ) }</strong>;
	} else if ( ! summary?.available ) {
		content = (
			<>
				<strong>
					{ __( 'Selected event feeds', 'fair-audience' ) }
				</strong>
				<p className="fair-audience-participant-detail__note">
					{ sprintf(
						/* translators: %d: number of selected event feeds. */
						_n(
							'%d feed is selected, but feed names cannot be retrieved right now.',
							'%d feeds are selected, but feed names cannot be retrieved right now.',
							feedIds.length,
							'fair-audience'
						),
						feedIds.length
					) }
				</p>
			</>
		);
	} else {
		const selected = summary.selected || [];
		const unavailable = summary.unavailable || [];
		content = (
			<>
				<strong>
					{ __( 'Selected event feeds', 'fair-audience' ) }
				</strong>
				{ selected.length + unavailable.length > 0 && (
					<ul className="fair-audience-participant-detail__feeds">
						{ selected.map( ( feed ) => (
							<li key={ feed.id }>{ feed.name }</li>
						) ) }
						{ unavailable.map( ( feed ) => (
							<li key={ feed.id }>
								{ sprintf(
									/* translators: %s: event feed name. */
									__(
										'%s (not available right now)',
										'fair-audience'
									),
									feed.name
								) }
							</li>
						) ) }
					</ul>
				) }
				{ summary.deleted > 0 && (
					<p className="fair-audience-participant-detail__note">
						{ sprintf(
							/* translators: %d: number of deleted event feeds. */
							_n(
								'%d selected feed was deleted.',
								'%d selected feeds were deleted.',
								summary.deleted,
								'fair-audience'
							),
							summary.deleted
						) }
					</p>
				) }
			</>
		);
	}

	return (
		<>
			{ content }
			{ deliveryNote && (
				<p className="fair-audience-participant-detail__note">
					{ deliveryNote }
				</p>
			) }
		</>
	);
}

export default function ParticipantDetail() {
	const urlParams = new URLSearchParams( window.location.search );
	const participantId = urlParams.get( 'participant_id' );

	const [ participant, setParticipant ] = useState( null );
	const [ activity, setActivity ] = useState( null );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ isEditModalOpen, setIsEditModalOpen ] = useState( false );
	const [ isDeleteModalOpen, setIsDeleteModalOpen ] = useState( false );
	const [ snackbar, setSnackbar ] = useState( null );

	const loadParticipant = useCallback( () => {
		if ( ! participantId ) {
			setIsLoading( false );
			setError( __( 'No participant ID provided.', 'fair-audience' ) );
			return;
		}

		Promise.all( [
			apiFetch( {
				path: `/fair-audience/v1/participants/${ participantId }`,
			} ),
			apiFetch( {
				path: `/fair-audience/v1/participants/${ participantId }/activity`,
			} ),
		] )
			.then( ( [ profileData, activityData ] ) => {
				setParticipant( profileData );
				setActivity( activityData );
			} )
			.catch( () => {
				setError( __( 'Participant not found.', 'fair-audience' ) );
			} )
			.finally( () => {
				setIsLoading( false );
			} );
	}, [ participantId ] );

	useEffect( () => {
		loadParticipant();
	}, [ loadParticipant ] );

	// The profile is gone: back to the list it was opened from.
	const handleDeleted = () => {
		setIsDeleteModalOpen( false );
		window.location.href = ALL_PARTICIPANTS_URL;
	};

	const handleSaved = ( result, outcome ) => {
		loadParticipant();
		if ( outcome?.complete ) {
			setSnackbar( __( 'Participant updated.', 'fair-audience' ) );
		}
	};

	if ( isLoading ) {
		return (
			<div className="wrap fair-audience-participant-detail fair-audience-participant-detail--loading">
				<Spinner />
			</div>
		);
	}

	if ( error ) {
		return (
			<div className="wrap fair-audience-participant-detail">
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			</div>
		);
	}

	if ( ! participant ) {
		return null;
	}

	const fullName = `${ participant.name || '' } ${
		participant.surname || ''
	}`.trim();
	const events = activity?.events || [];
	const submissions = activity?.submissions || [];

	return (
		<div className="wrap fair-audience-participant-detail">
			<p className="fair-audience-participant-detail__back">
				<a href={ ALL_PARTICIPANTS_URL }>
					&larr; { __( 'All participants', 'fair-audience' ) }
				</a>
			</p>
			<div className="fair-audience-participant-detail__header">
				<h1>{ fullName || __( 'Participant', 'fair-audience' ) }</h1>
				<div className="fair-audience-participant-detail__actions">
					<Button
						variant="secondary"
						onClick={ () => setIsEditModalOpen( true ) }
					>
						{ __( 'Edit participant', 'fair-audience' ) }
					</Button>
					<Button
						variant="secondary"
						isDestructive
						onClick={ () => setIsDeleteModalOpen( true ) }
					>
						{ __( 'Delete participant', 'fair-audience' ) }
					</Button>
				</div>
			</div>

			<Card className="fair-audience-participant-detail__card">
				<CardHeader>
					<h2>{ __( 'Profile', 'fair-audience' ) }</h2>
				</CardHeader>
				<CardBody>
					<table className="widefat striped fair-audience-participant-detail__profile-table">
						<tbody>
							<tr>
								<th>{ __( 'Name', 'fair-audience' ) }</th>
								<td>{ fullName || '—' }</td>
							</tr>
							<tr>
								<th>{ __( 'Email', 'fair-audience' ) }</th>
								<td>{ participant.email || '—' }</td>
							</tr>
							<tr>
								<th>{ __( 'Status', 'fair-audience' ) }</th>
								<td>
									{ STATUS_DISPLAY[ participant.status ] ||
										participant.status ||
										'—' }
								</td>
							</tr>
							<tr>
								<th>
									{ __( 'Email profile', 'fair-audience' ) }
								</th>
								<td>
									{ EMAIL_PROFILE_DISPLAY[
										participant.email_profile
									] ||
										participant.email_profile ||
										'—' }
								</td>
							</tr>
							<tr>
								<th>
									{ __( 'Weekly summary', 'fair-audience' ) }
								</th>
								<td>
									{ participant.weekly_summary_opt_out
										? __( 'Opted out', 'fair-audience' )
										: __( 'Subscribed', 'fair-audience' ) }
								</td>
							</tr>
							<tr>
								<th>
									{ __( 'Event feeds', 'fair-audience' ) }
								</th>
								<td>
									<WeeklyFeeds participant={ participant } />
								</td>
							</tr>
							<tr>
								<th>{ __( 'Phone', 'fair-audience' ) }</th>
								<td>{ participant.phone || '—' }</td>
							</tr>
							<tr>
								<th>{ __( 'Instagram', 'fair-audience' ) }</th>
								<td>
									{ participant.instagram ? (
										<a
											href={ `https://instagram.com/${ participant.instagram }` }
											target="_blank"
											rel="noopener noreferrer"
										>
											@{ participant.instagram }
										</a>
									) : (
										'—'
									) }
								</td>
							</tr>
							<tr>
								<th>
									{ __( 'WordPress user', 'fair-audience' ) }
								</th>
								<td>
									{ participant.wp_user
										? participant.wp_user.display_name
										: '—' }
								</td>
							</tr>
							<tr>
								<th>{ __( 'Created', 'fair-audience' ) }</th>
								<td>
									{ formatDateTime( participant.created_at ) }
								</td>
							</tr>
						</tbody>
					</table>
				</CardBody>
			</Card>

			<Card className="fair-audience-participant-detail__card">
				<CardHeader>
					<h2>
						{ __( 'Events', 'fair-audience' ) } ({ events.length })
					</h2>
				</CardHeader>
				<CardBody className="fair-audience-participant-detail__table">
					{ events.length === 0 ? (
						<p>{ __( 'No events yet.', 'fair-audience' ) }</p>
					) : (
						<table className="wp-list-table widefat striped">
							<thead>
								<tr>
									<th>{ __( 'Event', 'fair-audience' ) }</th>
									<th>{ __( 'Date', 'fair-audience' ) }</th>
									<th>{ __( 'Role', 'fair-audience' ) }</th>
									<th>
										{ __(
											'Signed up at',
											'fair-audience'
										) }
									</th>
									<th>
										{ __( 'Transaction', 'fair-audience' ) }
									</th>
								</tr>
							</thead>
							<tbody>
								{ events.map( ( ev ) => {
									const manageUrl = ev.event_date_id
										? `admin.php?page=fair-events-manage-event&event_date_id=${ ev.event_date_id }&tab=audience`
										: null;
									const transactionUrl = ev.transaction_id
										? `admin.php?page=fair-payments-connector-transaction&transaction_id=${ ev.transaction_id }`
										: null;
									return (
										<tr key={ ev.id }>
											<td>
												{ manageUrl ? (
													<a href={ manageUrl }>
														{ ev.event_title ||
															__(
																'(untitled)',
																'fair-audience'
															) }
													</a>
												) : (
													ev.event_title || '—'
												) }
											</td>
											<td>{ formatEventDate( ev ) }</td>
											<td>
												{ LABEL_DISPLAY[ ev.label ] ||
													ev.label }
											</td>
											<td>
												{ formatDateTime(
													ev.created_at
												) }
											</td>
											<td>
												{ transactionUrl ? (
													<>
														<a
															href={
																transactionUrl
															}
														>
															{ `#${ ev.transaction_id }` }
														</a>
														{ ev.transaction_status && (
															<span
																title={
																	TRANSACTION_STATUS_DISPLAY[
																		ev
																			.transaction_status
																	]?.label
																}
																style={ {
																	marginLeft:
																		'6px',
																	color: TRANSACTION_STATUS_DISPLAY[
																		ev
																			.transaction_status
																	]?.color,
																	fontWeight:
																		'bold',
																} }
															>
																{
																	TRANSACTION_STATUS_DISPLAY[
																		ev
																			.transaction_status
																	]?.label
																}
															</span>
														) }
													</>
												) : (
													'—'
												) }
											</td>
										</tr>
									);
								} ) }
							</tbody>
						</table>
					) }
				</CardBody>
			</Card>

			<Card className="fair-audience-participant-detail__card">
				<CardHeader>
					<h2>
						{ __( 'Form submissions', 'fair-audience' ) } (
						{ submissions.length })
					</h2>
				</CardHeader>
				<CardBody className="fair-audience-participant-detail__table">
					{ submissions.length === 0 ? (
						<p>
							{ __(
								'No form submissions yet.',
								'fair-audience'
							) }
						</p>
					) : (
						<table className="wp-list-table widefat striped">
							<thead>
								<tr>
									<th>{ __( 'Form', 'fair-audience' ) }</th>
									<th>{ __( 'Page', 'fair-audience' ) }</th>
									<th>{ __( 'Event', 'fair-audience' ) }</th>
									<th>
										{ __(
											'Submitted at',
											'fair-audience'
										) }
									</th>
								</tr>
							</thead>
							<tbody>
								{ submissions.map( ( sub ) => {
									const detailUrl = `admin.php?page=fair-form-submission-detail&submission_id=${ sub.id }`;
									return (
										<tr key={ sub.id }>
											<td>
												<a href={ detailUrl }>
													{ sub.title ||
														__(
															'Fair Form',
															'fair-audience'
														) }
												</a>
											</td>
											<td>{ sub.page_title || '—' }</td>
											<td>{ sub.event_title || '—' }</td>
											<td>
												{ formatDateTime(
													sub.created_at
												) }
											</td>
										</tr>
									);
								} ) }
							</tbody>
						</table>
					) }
				</CardBody>
			</Card>

			<ParticipantEditModal
				isOpen={ isEditModalOpen }
				participant={ participant }
				onClose={ () => setIsEditModalOpen( false ) }
				onSaved={ handleSaved }
			/>

			{ isDeleteModalOpen && (
				<DeleteParticipantsModal
					participants={ [ participant ] }
					onClose={ () => setIsDeleteModalOpen( false ) }
					onDeleted={ handleDeleted }
				/>
			) }

			<FeedbackSnackbar
				message={ snackbar }
				onRemove={ () => setSnackbar( null ) }
			/>
		</div>
	);
}
