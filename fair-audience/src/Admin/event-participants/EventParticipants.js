import { __, _n, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useMemo, useRef } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Modal,
	Notice,
	SelectControl,
	Spinner,
	CheckboxControl,
	Card,
	CardHeader,
	CardBody,
} from '@wordpress/components';
import { DataViews } from '@wordpress/dataviews';
import { formatTimingStart } from 'fair-events-shared/src/dateTime.js';
import EmailSendResultNotice from '../components/EmailSendResultNotice.js';
import FeedbackSnackbar from '../components/FeedbackSnackbar.js';
import InvitationSummary, {
	invitationBlockReason,
	useInvitationPreview,
} from '../components/InvitationSummary.js';
import { personFromProfile } from '../components/participantIdentity.js';
import RemoveParticipantModal from '../manage-event-audience-tab/RemoveParticipantModal.js';
import { ticketShortLabel } from '../manage-event-audience-tab/ticketLabels.js';

const DEFAULT_VIEW = {
	type: 'table',
	perPage: 25,
	page: 1,
	sort: {
		field: 'participant_name',
		direction: 'asc',
	},
	search: '',
	filters: [],
	fields: [ 'name', 'role', 'questions' ],
};

const DEFAULT_LAYOUTS = {
	table: {},
};

/**
 * Format a single questionnaire answer value for display.
 *
 * @param {Object} answer The answer record.
 * @return {string} Human-readable value.
 */
function formatAnswerValue( answer ) {
	if ( answer.question_type === 'multiselect' ) {
		try {
			const values = JSON.parse( answer.answer_value );
			if ( Array.isArray( values ) ) {
				return values.join( ', ' );
			}
		} catch ( e ) {
			// Fall through to the raw value.
		}
	}
	return answer.answer_value || '';
}

/**
 * Render the custom question answers captured during signup as a compact list.
 *
 * @param {Array}   answers     Answer records from the REST response.
 * @param {boolean} needsReview Whether the answers' link to a ticket should be checked.
 * @return {JSX.Element|null} The rendered list, or null when there are none.
 */
function renderQuestionnaireAnswers( answers, needsReview = false ) {
	if ( ! answers || answers.length === 0 ) {
		return null;
	}

	return (
		<dl
			className="fair-audience-signup-answers"
			style={ { margin: 0, fontSize: '12px' } }
		>
			{ needsReview && (
				<div
					className="fair-audience-signup-answers__review"
					style={ { color: '#996800', marginBottom: '4px' } }
				>
					{ __(
						'Check which ticket these belong to',
						'fair-audience'
					) }
				</div>
			) }
			{ answers.map( ( answer, index ) => (
				<div
					key={ answer.question_key || index }
					className="fair-audience-signup-answer"
					style={ { marginBottom: '4px' } }
				>
					<dt style={ { fontWeight: 600 } }>
						{ answer.question_text }
					</dt>
					<dd style={ { margin: 0 } }>
						{ answer.file_url ? (
							<a
								href={ answer.file_url }
								target="_blank"
								rel="noreferrer"
							>
								{ __( 'View file', 'fair-audience' ) }
							</a>
						) : (
							formatAnswerValue( answer )
						) }
					</dd>
				</div>
			) ) }
		</dl>
	);
}

/**
 * Render a participant's signup answers: each ticket's own answers under
 * the ticket's label, then any answers not attached to a ticket.
 *
 * @param {Object} item Participant row from the REST response.
 * @return {JSX.Element|null} The rendered answers, or null when there are none.
 */
export function renderParticipantAnswers( item ) {
	const ticketsWithAnswers = ( item.tickets || [] ).filter(
		( ticket ) => ( ticket.answers || [] ).length > 0
	);
	const participantAnswers = renderQuestionnaireAnswers(
		item.questionnaire_answers,
		item.questionnaire_answers_need_review
	);

	if ( ticketsWithAnswers.length === 0 ) {
		return participantAnswers;
	}

	return (
		<div>
			{ ticketsWithAnswers.map( ( ticket ) => (
				<div
					key={ ticket.id }
					className="fair-audience-ticket-answers"
					style={ { marginBottom: '8px' } }
				>
					<div style={ { fontSize: '12px', color: '#646970' } }>
						{ ticketShortLabel( ticket, ticket.position ) }
					</div>
					{ renderQuestionnaireAnswers(
						ticket.answers,
						ticket.answers_need_review
					) }
				</div>
			) ) }
			{ participantAnswers }
		</div>
	);
}

/**
 * Number of answers a participant row carries, across its tickets.
 *
 * @param {Object} item Participant row from the REST response.
 * @return {number} Answer count.
 */
export function countParticipantAnswers( item ) {
	return ( item.tickets || [] ).reduce(
		( total, ticket ) => total + ( ticket.answers || [] ).length,
		( item.questionnaire_answers || [] ).length
	);
}

export default function EventParticipants() {
	const [ participants, setParticipants ] = useState( [] );
	const [ allParticipants, setAllParticipants ] = useState( [] );
	const [ eventInfo, setEventInfo ] = useState( null );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ addModalLabel, setAddModalLabel ] = useState( null );
	const [ selectedToAdd, setSelectedToAdd ] = useState( new Set() );
	const [ addSearch, setAddSearch ] = useState( '' );
	const [ addGroupFilter, setAddGroupFilter ] = useState( '' );
	const [ isAdding, setIsAdding ] = useState( false );
	const [ addError, setAddError ] = useState( null );
	// The rows a removal is being confirmed for, or null.
	const [ removing, setRemoving ] = useState( null );
	const [ snackbar, setSnackbar ] = useState( null );
	const [ view, setView ] = useState( DEFAULT_VIEW );
	const [ selection, setSelection ] = useState( [] );
	const [ editModalOpen, setEditModalOpen ] = useState( false );
	const [ editingParticipant, setEditingParticipant ] = useState( null );
	const [ editLabel, setEditLabel ] = useState( '' );
	const [ isSavingLabel, setIsSavingLabel ] = useState( false );
	const [ labelError, setLabelError ] = useState( null );
	const [ showInvitationModal, setShowInvitationModal ] = useState( false );
	const [ groups, setGroups ] = useState( [] );
	const [ selectedGroups, setSelectedGroups ] = useState( new Set() );
	const [ isSendingInvitations, setIsSendingInvitations ] = useState( false );
	const [ inviteMode, setInviteMode ] = useState( 'groups' ); // 'groups' or 'participants'
	const [ selectedInviteParticipants, setSelectedInviteParticipants ] =
		useState( new Set() );
	const [ inviteSearch, setInviteSearch ] = useState( '' );
	const [ invitationSendResult, setInvitationSendResult ] = useState( null );
	const [ invitationError, setInvitationError ] = useState( null );
	// Refuse a second submission before the first one re-rendered its popup.
	const addInFlight = useRef( false );
	const labelInFlight = useRef( false );
	const invitationInFlight = useRef( false );

	const params = new URLSearchParams( window.location.search );
	const urlEventDateId = params.get( 'event_date_id' );
	const legacyEventId = params.get( 'event_id' );
	const [ resolvedEventDateId, setResolvedEventDateId ] =
		useState( urlEventDateId );

	// Step 1: resolve event_date_id if only legacy event_id is provided.
	useEffect( () => {
		if ( ! urlEventDateId && ! legacyEventId ) {
			setError( __( 'No event date ID provided', 'fair-audience' ) );
			setIsLoading( false );
			return;
		}

		if ( urlEventDateId ) {
			// Already have event_date_id.
			return;
		}

		// Legacy: resolve event_date_id from event_id.
		apiFetch( {
			path: `/fair-events/v1/event-dates?event_id=${ legacyEventId }`,
		} )
			.then( ( data ) => {
				if ( data && data.length > 0 ) {
					setResolvedEventDateId( String( data[ 0 ].id ) );
				} else {
					setError(
						__(
							'No event date found for this event',
							'fair-audience'
						)
					);
					setIsLoading( false );
				}
			} )
			.catch( ( err ) => {
				setError( err.message );
				setIsLoading( false );
			} );
	}, [ urlEventDateId, legacyEventId ] );

	// Step 2: load data once event_date_id is resolved.
	useEffect( () => {
		if ( ! resolvedEventDateId ) {
			return;
		}

		loadEventInfo();
		loadParticipants();
		loadAllParticipants();
		loadGroups();
	}, [ resolvedEventDateId ] );

	const loadEventInfo = () => {
		apiFetch( {
			path: `/fair-audience/v1/event-dates/${ resolvedEventDateId }`,
		} )
			.then( ( data ) => {
				setEventInfo( data );
			} )
			.catch( ( err ) => {
				// eslint-disable-next-line no-console
				console.error( 'Error loading event info:', err );
			} );
	};

	const loadParticipants = () => {
		apiFetch( {
			path: `/fair-audience/v1/event-dates/${ resolvedEventDateId }/participants`,
		} )
			.then( ( data ) => {
				setParticipants( data );
				setIsLoading( false );
			} )
			.catch( ( err ) => {
				setError( err.message );
				setIsLoading( false );
			} );
	};

	const loadAllParticipants = () => {
		apiFetch( { path: '/fair-audience/v1/participants' } )
			.then( ( data ) => {
				setAllParticipants( data );
			} )
			.catch( () => {} );
	};

	const loadGroups = () => {
		apiFetch( { path: '/fair-audience/v1/groups' } )
			.then( ( data ) => {
				setGroups( data );
			} )
			.catch( () => {} );
	};

	// Get participants not already in this event.
	const availableParticipants = useMemo( () => {
		const existingIds = new Set(
			participants.map( ( p ) => p.participant_id )
		);
		return allParticipants.filter( ( p ) => ! existingIds.has( p.id ) );
	}, [ allParticipants, participants ] );

	// Filter available participants by search text and group.
	const filteredAvailableParticipants = useMemo( () => {
		let filtered = availableParticipants;

		if ( addSearch.trim() ) {
			const searchLower = addSearch.toLowerCase();
			filtered = filtered.filter(
				( p ) =>
					( p.name &&
						p.name.toLowerCase().includes( searchLower ) ) ||
					( p.surname &&
						p.surname.toLowerCase().includes( searchLower ) ) ||
					( p.email && p.email.toLowerCase().includes( searchLower ) )
			);
		}

		if ( addGroupFilter ) {
			const groupId = parseInt( addGroupFilter, 10 );
			filtered = filtered.filter(
				( p ) => p.groups && p.groups.some( ( g ) => g.id === groupId )
			);
		}

		return filtered;
	}, [ availableParticipants, addSearch, addGroupFilter ] );

	// The selection that can still be added: someone added meanwhile is
	// no longer offered, and no longer counted or sent.
	const selectedAvailableIds = useMemo(
		() =>
			availableParticipants
				.map( ( p ) => p.id )
				.filter( ( id ) => selectedToAdd.has( id ) ),
		[ availableParticipants, selectedToAdd ]
	);

	const resetAddModal = ( label ) => {
		setAddModalLabel( label );
		setSelectedToAdd( new Set() );
		setAddSearch( '' );
		setAddGroupFilter( '' );
		setAddError( null );
	};

	const handleOpenAddModal = ( label ) => resetAddModal( label );

	// Closing mid-request would drop the selection while its result is unknown.
	const handleCloseAddModal = () => {
		if ( ! addInFlight.current ) {
			resetAddModal( null );
		}
	};

	const handleToggleParticipantToAdd = ( participantId ) => {
		const newSelected = new Set( selectedToAdd );
		if ( newSelected.has( participantId ) ) {
			newSelected.delete( participantId );
		} else {
			newSelected.add( participantId );
		}
		setSelectedToAdd( newSelected );
	};

	const handleSelectAllToAdd = () => {
		const filteredIds = filteredAvailableParticipants.map( ( p ) => p.id );
		const allSelected = filteredIds.every( ( id ) =>
			selectedToAdd.has( id )
		);
		if ( allSelected ) {
			const newSelected = new Set( selectedToAdd );
			filteredIds.forEach( ( id ) => newSelected.delete( id ) );
			setSelectedToAdd( newSelected );
		} else {
			const newSelected = new Set( selectedToAdd );
			filteredIds.forEach( ( id ) => newSelected.add( id ) );
			setSelectedToAdd( newSelected );
		}
	};

	const handleBatchAdd = async () => {
		if (
			selectedAvailableIds.length === 0 ||
			! addModalLabel ||
			addInFlight.current
		) {
			return;
		}

		addInFlight.current = true;
		setIsAdding( true );
		setAddError( null );

		try {
			const batchBasePath = `/fair-audience/v1/event-dates/${ resolvedEventDateId }/participants/batch`;
			const response = await apiFetch( {
				path: batchBasePath,
				method: 'POST',
				data: {
					participant_ids: selectedAvailableIds,
					label: addModalLabel,
				},
			} );

			loadParticipants();
			loadEventInfo();

			if ( response.added > 0 ) {
				setSnackbar(
					sprintf(
						/* translators: %d: number of participants */
						_n(
							'%d participant added.',
							'%d participants added.',
							response.added,
							'fair-audience'
						),
						response.added
					)
				);
			}

			if ( response.failed > 0 ) {
				// The ones added drop out of the list; the rest stay selected.
				loadAllParticipants();
				setAddError(
					sprintf(
						/* translators: %d: number of participants */
						_n(
							'%d participant could not be added. They are still selected: try again.',
							'%d participants could not be added. They are still selected: try again.',
							response.failed,
							'fair-audience'
						),
						response.failed
					)
				);
			} else {
				resetAddModal( null );
			}
		} catch ( err ) {
			setAddError(
				err.message ||
					__(
						'The participants could not be added. Nothing was changed; try again.',
						'fair-audience'
					)
			);
		} finally {
			addInFlight.current = false;
			setIsAdding( false );
		}
	};

	const handleUpdateLabel = async ( participantId, newLabel ) => {
		if ( labelInFlight.current ) {
			return;
		}
		labelInFlight.current = true;
		setIsSavingLabel( true );
		setLabelError( null );

		try {
			const updatePath = `/fair-audience/v1/event-dates/${ resolvedEventDateId }/participants/${ participantId }`;
			await apiFetch( {
				path: updatePath,
				method: 'PUT',
				data: { label: newLabel },
			} );
			loadParticipants();
			loadEventInfo();
			setEditModalOpen( false );
			setEditingParticipant( null );
			setEditLabel( '' );
			setSnackbar( __( 'Role updated.', 'fair-audience' ) );
		} catch ( err ) {
			setLabelError(
				err.message ||
					__(
						'The role could not be saved. Nothing was changed; try again.',
						'fair-audience'
					)
			);
		} finally {
			labelInFlight.current = false;
			setIsSavingLabel( false );
		}
	};

	const handleRemove = ( items ) => {
		setRemoving( items );
	};

	// Whoever was removed is gone from the list and the totals; whoever
	// could not be removed stays selected, and in the popup with the reason.
	const handleRemoved = ( removedRows, remainingRows ) => {
		loadParticipants();
		loadEventInfo();
		setSelection( remainingRows.map( ( row ) => row.participant_id ) );

		if ( remainingRows.length > 0 ) {
			return;
		}

		setRemoving( null );
		const removedName = ( removedRows[ 0 ].participant_name || '' ).trim();
		setSnackbar(
			removedRows.length === 1 && removedName
				? sprintf(
						/* translators: %s: participant name */
						__( '%s was removed from this date.', 'fair-audience' ),
						removedName
					)
				: sprintf(
						/* translators: %d: number of participants */
						_n(
							'%d participant was removed from this date.',
							'%d participants were removed from this date.',
							removedRows.length,
							'fair-audience'
						),
						removedRows.length
					)
		);
	};

	const handleOpenEditModal = ( item ) => {
		setEditingParticipant( item );
		setEditLabel( item.label );
		setLabelError( null );
		setEditModalOpen( true );
	};

	const handleCloseEditModal = () => {
		if ( labelInFlight.current ) {
			return;
		}
		setEditModalOpen( false );
		setEditingParticipant( null );
		setEditLabel( '' );
	};

	const handleSaveEdit = () => {
		if ( editingParticipant && editLabel ) {
			handleUpdateLabel( editingParticipant.participant_id, editLabel );
		}
	};

	const handleToggleGroup = ( groupId ) => {
		const newSelected = new Set( selectedGroups );
		if ( newSelected.has( groupId ) ) {
			newSelected.delete( groupId );
		} else {
			newSelected.add( groupId );
		}
		setSelectedGroups( newSelected );
	};

	const handleToggleInviteParticipant = ( participantId ) => {
		const newSelected = new Set( selectedInviteParticipants );
		if ( newSelected.has( participantId ) ) {
			newSelected.delete( participantId );
		} else {
			newSelected.add( participantId );
		}
		setSelectedInviteParticipants( newSelected );
	};

	// Filter participants for invitation modal based on search.
	const filteredInviteParticipants = useMemo( () => {
		if ( ! inviteSearch.trim() ) {
			return allParticipants;
		}
		const searchLower = inviteSearch.toLowerCase();
		return allParticipants.filter(
			( p ) =>
				( p.name && p.name.toLowerCase().includes( searchLower ) ) ||
				( p.surname &&
					p.surname.toLowerCase().includes( searchLower ) ) ||
				( p.email && p.email.toLowerCase().includes( searchLower ) )
		);
	}, [ allParticipants, inviteSearch ] );

	const sortedIds = ( ids ) => Array.from( ids ).sort( ( a, b ) => a - b );

	// Only the selection of the open tab is invited.
	const invitationSelection =
		inviteMode === 'groups'
			? { groupIds: sortedIds( selectedGroups ) }
			: { participantIds: sortedIds( selectedInviteParticipants ) };
	const invitationPreview = useInvitationPreview(
		showInvitationModal ? resolvedEventDateId : null,
		invitationSelection
	);
	const invitationBlocked = invitationBlockReason( invitationPreview );

	const invitedGroupsSummary =
		inviteMode === 'groups'
			? groups.filter( ( group ) => selectedGroups.has( group.id ) )
			: [];
	const invitedPeopleSummary =
		inviteMode === 'participants'
			? allParticipants
					.filter( ( p ) => selectedInviteParticipants.has( p.id ) )
					.map( personFromProfile )
			: [];

	const resetInvitationModal = () => {
		setShowInvitationModal( false );
		setSelectedGroups( new Set() );
		setSelectedInviteParticipants( new Set() );
		setInviteSearch( '' );
		setInvitationError( null );
	};

	// Closing mid-request would drop the selection while its result is unknown.
	const handleCloseInvitationModal = () => {
		if ( ! invitationInFlight.current ) {
			resetInvitationModal();
		}
	};

	const handleSendInvitations = async () => {
		if ( invitationBlocked || invitationInFlight.current ) {
			return;
		}

		invitationInFlight.current = true;
		setIsSendingInvitations( true );
		setInvitationError( null );

		try {
			// Exactly the people the summary counted: the server checks each
			// one again, but invites nobody who joined a group since.
			const response = await apiFetch( {
				path: `/fair-audience/v1/event-dates/${ resolvedEventDateId }/event-invitations`,
				method: 'POST',
				data: {
					participant_ids:
						invitationPreview.data.eligible_participant_ids,
				},
			} );

			setInvitationSendResult( {
				sent_count: response.sent_count,
				failed: response.failed,
				skipped_count: response.skipped_count,
			} );

			resetInvitationModal();
		} catch ( err ) {
			setInvitationError(
				err.message ||
					__(
						'The invitations could not be sent. Your selection is kept; try again.',
						'fair-audience'
					)
			);
		} finally {
			invitationInFlight.current = false;
			setIsSendingInvitations( false );
		}
	};

	const getLabelTitle = ( label ) => {
		switch ( label ) {
			case 'collaborator':
				return __( 'Add Collaborators', 'fair-audience' );
			case 'interested':
				return __( 'Add Interested', 'fair-audience' );
			case 'signed_up':
				return __( 'Add Participants', 'fair-audience' );
			default:
				return __( 'Add', 'fair-audience' );
		}
	};

	// Define fields for DataViews.
	const formatLabel = ( label ) => {
		switch ( label ) {
			case 'signed_up':
				return __( 'Signed Up', 'fair-audience' );
			case 'collaborator':
				return __( 'Collaborator', 'fair-audience' );
			case 'interested':
				return __( 'Interested', 'fair-audience' );
			default:
				return label || '';
		}
	};

	const fields = useMemo(
		() => [
			{
				id: 'name',
				label: __( 'Name', 'fair-audience' ),
				render: ( { item } ) => item.participant_name,
				enableSorting: true,
				enableHiding: false,
				getValue: ( { item } ) =>
					item.participant_name?.toLowerCase() || '',
			},
			{
				id: 'role',
				label: __( 'Role', 'fair-audience' ),
				render: ( { item } ) => formatLabel( item.label ),
				enableSorting: true,
				getValue: ( { item } ) => item.label || '',
			},
			{
				id: 'questions',
				label: __( 'Questions', 'fair-audience' ),
				render: ( { item } ) => renderParticipantAnswers( item ),
				enableSorting: false,
				getValue: ( { item } ) => countParticipantAnswers( item ),
			},
		],
		[]
	);

	// Define actions for DataViews.
	const actions = useMemo(
		() => [
			{
				id: 'edit',
				label: __( 'Edit', 'fair-audience' ),
				callback: ( [ item ] ) => handleOpenEditModal( item ),
			},
			{
				id: 'remove',
				label: __( 'Remove', 'fair-audience' ),
				// With an icon the bulk action stays reachable on narrow
				// screens, where the selection bar shows icons only.
				icon: 'remove',
				// A series pass is managed on its series date, not here.
				isEligible: ( item ) => ! item.is_series_pass,
				callback: handleRemove,
				supportsBulk: true,
			},
		],
		[ resolvedEventDateId ]
	);

	// Pagination info for DataViews (client-side pagination).
	const paginationInfo = useMemo(
		() => ( {
			totalItems: participants.length,
			totalPages: Math.ceil( participants.length / view.perPage ) || 1,
		} ),
		[ participants.length, view.perPage ]
	);

	// The stored date is the site's wall-clock time: shown as it is, in
	// the header and in the removal popup alike, with the start time only
	// when one is set.
	const eventDateLabel = formatTimingStart( eventInfo );

	if ( isLoading ) {
		return (
			<div className="wrap">
				<h1>{ __( 'Event Participants', 'fair-audience' ) }</h1>
				<Spinner />
			</div>
		);
	}

	if ( error ) {
		return (
			<div className="wrap">
				<h1>{ __( 'Event Participants', 'fair-audience' ) }</h1>
				<div className="notice notice-error">
					<p>{ __( 'Error: ', 'fair-audience' ) + error }</p>
				</div>
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1>{ __( 'Event Participants', 'fair-audience' ) }</h1>

			<EmailSendResultNotice
				result={ invitationSendResult }
				onDismiss={ () => setInvitationSendResult( null ) }
			/>

			<Card>
				<CardHeader>
					<div
						style={ {
							display: 'flex',
							justifyContent: 'space-between',
							alignItems: 'center',
							width: '100%',
							flexWrap: 'wrap',
							gap: '10px',
						} }
					>
						<div>
							<h2 style={ { margin: 0 } }>
								{ eventInfo?.title ||
									__(
										'Event Participants',
										'fair-audience'
									) }
							</h2>
							<div
								style={ {
									display: 'flex',
									gap: '12px',
									marginTop: '4px',
								} }
							>
								{ eventInfo?.edit_url && (
									<a href={ eventInfo.edit_url }>
										{ __(
											'Edit Article',
											'fair-audience'
										) }
									</a>
								) }
								{ eventInfo?.manage_event_url && (
									<a href={ eventInfo.manage_event_url }>
										{ __(
											'Manage Event',
											'fair-audience'
										) }
									</a>
								) }
							</div>
						</div>
						{ eventInfo && (
							<div
								style={ {
									display: 'flex',
									gap: '24px',
									alignItems: 'center',
									flexWrap: 'wrap',
								} }
							>
								<span>
									{ __( 'Date:', 'fair-audience' ) }{ ' ' }
									{ eventDateLabel || '—' }
								</span>
								<span>
									{ sprintf(
										/* translators: %d: number of signed up participants */
										__( '%d Signed Up', 'fair-audience' ),
										eventInfo.signed_up || 0
									) }
								</span>
								<span>
									{ sprintf(
										/* translators: %d: number of collaborators */
										__(
											'%d Collaborators',
											'fair-audience'
										),
										eventInfo.collaborators || 0
									) }
								</span>
							</div>
						) }
					</div>
				</CardHeader>
				<CardBody>
					<div
						style={ {
							display: 'flex',
							gap: '10px',
							marginBottom: '15px',
							flexWrap: 'wrap',
						} }
					>
						<Button
							isPrimary
							onClick={ () => handleOpenAddModal( 'signed_up' ) }
						>
							{ __( 'Add Participants', 'fair-audience' ) }
						</Button>
						<Button
							variant="secondary"
							onClick={ () =>
								handleOpenAddModal( 'collaborator' )
							}
						>
							{ __( 'Add Collaborators', 'fair-audience' ) }
						</Button>
						<Button
							variant="secondary"
							onClick={ () => handleOpenAddModal( 'interested' ) }
						>
							{ __( 'Add Interested', 'fair-audience' ) }
						</Button>
						<Button
							variant="secondary"
							onClick={ () => {
								setInvitationError( null );
								setShowInvitationModal( true );
							} }
						>
							{ __( 'Send Invitation', 'fair-audience' ) }
						</Button>
					</div>

					<DataViews
						data={ participants }
						fields={ fields }
						view={ view }
						onChangeView={ setView }
						actions={ actions }
						paginationInfo={ paginationInfo }
						defaultLayouts={ DEFAULT_LAYOUTS }
						isLoading={ isLoading }
						getItemId={ ( item ) => item.participant_id }
						selection={ selection }
						onChangeSelection={ setSelection }
					/>
				</CardBody>
			</Card>

			{ addModalLabel && (
				<Modal
					title={ getLabelTitle( addModalLabel ) }
					onRequestClose={ handleCloseAddModal }
					style={ { maxWidth: '640px', width: '100%' } }
				>
					{ availableParticipants.length === 0 ? (
						<p>
							{ __(
								'All participants are already added to this event.',
								'fair-audience'
							) }
						</p>
					) : (
						<>
							<div
								style={ {
									display: 'flex',
									gap: '10px',
									marginBottom: '10px',
								} }
							>
								<input
									type="text"
									placeholder={ __(
										'Search by name or email...',
										'fair-audience'
									) }
									value={ addSearch }
									onChange={ ( e ) =>
										setAddSearch( e.target.value )
									}
									style={ {
										flex: 1,
										padding: '8px 12px',
										border: '1px solid #ddd',
										borderRadius: '4px',
									} }
								/>
								{ groups.length > 0 && (
									<SelectControl
										value={ addGroupFilter }
										options={ [
											{
												label: __(
													'All groups',
													'fair-audience'
												),
												value: '',
											},
											...groups.map( ( g ) => ( {
												label: g.name,
												value: String( g.id ),
											} ) ),
										] }
										onChange={ setAddGroupFilter }
										__nextHasNoMarginBottom
									/>
								) }
							</div>

							<div
								style={ {
									marginBottom: '10px',
									display: 'flex',
									justifyContent: 'space-between',
									alignItems: 'center',
								} }
							>
								<span
									style={ {
										fontSize: '12px',
										color: '#666',
									} }
								>
									{ selectedAvailableIds.length > 0
										? sprintf(
												/* translators: 1: selected count, 2: shown count */
												__(
													'%1$d selected, %2$d shown',
													'fair-audience'
												),
												selectedAvailableIds.length,
												filteredAvailableParticipants.length
											)
										: sprintf(
												/* translators: %d: number of available participants */
												__(
													'%d participant(s) available',
													'fair-audience'
												),
												filteredAvailableParticipants.length
											) }
								</span>
								<Button
									variant="secondary"
									isSmall
									onClick={ handleSelectAllToAdd }
								>
									{ filteredAvailableParticipants.length >
										0 &&
									filteredAvailableParticipants.every(
										( p ) => selectedToAdd.has( p.id )
									)
										? __( 'Deselect All', 'fair-audience' )
										: __( 'Select All', 'fair-audience' ) }
								</Button>
							</div>

							<div
								style={ {
									maxHeight: '400px',
									overflowY: 'auto',
									border: '1px solid #ddd',
									borderRadius: '4px',
								} }
							>
								{ filteredAvailableParticipants.map( ( p ) => (
									<div
										key={ p.id }
										style={ {
											padding: '10px 15px',
											borderBottom: '1px solid #eee',
											display: 'flex',
											alignItems: 'center',
											gap: '10px',
										} }
									>
										<CheckboxControl
											checked={ selectedToAdd.has(
												p.id
											) }
											onChange={ () =>
												handleToggleParticipantToAdd(
													p.id
												)
											}
										/>
										<div>
											<strong>
												{ p.name } { p.surname }
											</strong>
											<br />
											<span
												style={ {
													color: '#666',
													fontSize: '12px',
												} }
											>
												{ p.email }
											</span>
										</div>
									</div>
								) ) }
								{ filteredAvailableParticipants.length ===
									0 && (
									<p
										style={ {
											padding: '15px',
											color: '#666',
										} }
									>
										{ __(
											'No participants match your search.',
											'fair-audience'
										) }
									</p>
								) }
							</div>

							{ addError && (
								<div style={ { marginTop: '16px' } }>
									<Notice
										status="error"
										isDismissible={ false }
									>
										{ addError }
									</Notice>
								</div>
							) }

							<div
								style={ {
									marginTop: '20px',
									display: 'flex',
									justifyContent: 'flex-end',
									gap: '10px',
								} }
							>
								<Button
									variant="secondary"
									onClick={ handleCloseAddModal }
									disabled={ isAdding }
								>
									{ __( 'Cancel', 'fair-audience' ) }
								</Button>
								<Button
									isPrimary
									onClick={ handleBatchAdd }
									isBusy={ isAdding }
									disabled={
										selectedAvailableIds.length === 0 ||
										isAdding
									}
								>
									{ isAdding
										? __( 'Adding...', 'fair-audience' )
										: sprintf(
												/* translators: %d: number of selected participants */
												__(
													'Add %d Selected',
													'fair-audience'
												),
												selectedAvailableIds.length
											) }
								</Button>
							</div>
						</>
					) }
				</Modal>
			) }

			{ editModalOpen && editingParticipant && (
				<Modal
					title={ __( 'Edit Participant', 'fair-audience' ) }
					onRequestClose={ handleCloseEditModal }
					style={ { maxWidth: '500px', width: '100%' } }
				>
					<p>
						<strong>{ editingParticipant.participant_name }</strong>
					</p>
					<SelectControl
						label={ __( 'Label', 'fair-audience' ) }
						value={ editLabel }
						options={ [
							{
								label: __( 'Interested', 'fair-audience' ),
								value: 'interested',
							},
							{
								label: __( 'Signed Up', 'fair-audience' ),
								value: 'signed_up',
							},
							{
								label: __( 'Collaborator', 'fair-audience' ),
								value: 'collaborator',
							},
						] }
						onChange={ ( value ) => setEditLabel( value ) }
					/>
					{ labelError && (
						<div style={ { marginTop: '16px' } }>
							<Notice status="error" isDismissible={ false }>
								{ labelError }
							</Notice>
						</div>
					) }
					<div
						style={ {
							marginTop: '20px',
							display: 'flex',
							justifyContent: 'flex-end',
							gap: '10px',
						} }
					>
						<Button
							variant="secondary"
							onClick={ handleCloseEditModal }
							disabled={ isSavingLabel }
						>
							{ __( 'Cancel', 'fair-audience' ) }
						</Button>
						<Button
							isPrimary
							onClick={ handleSaveEdit }
							isBusy={ isSavingLabel }
							disabled={ isSavingLabel }
						>
							{ __( 'Save', 'fair-audience' ) }
						</Button>
					</div>
				</Modal>
			) }

			{ showInvitationModal && (
				<Modal
					title={ __( 'Send Event Invitations', 'fair-audience' ) }
					onRequestClose={ handleCloseInvitationModal }
					style={ { maxWidth: '640px', width: '100%' } }
				>
					<p style={ { fontSize: '12px', color: '#666' } }>
						{ __(
							'Participants already signed up or who opted out of marketing emails will be skipped.',
							'fair-audience'
						) }
					</p>

					<div
						style={ {
							display: 'flex',
							gap: '0',
							marginBottom: '15px',
							borderBottom: '1px solid #ddd',
						} }
					>
						<button
							type="button"
							onClick={ () => setInviteMode( 'groups' ) }
							disabled={ isSendingInvitations }
							style={ {
								padding: '10px 20px',
								border: 'none',
								background:
									inviteMode === 'groups'
										? '#fff'
										: '#f0f0f0',
								borderBottom:
									inviteMode === 'groups'
										? '2px solid #007cba'
										: '2px solid transparent',
								cursor: 'pointer',
								fontWeight:
									inviteMode === 'groups' ? '600' : '400',
							} }
						>
							{ __( 'By Group', 'fair-audience' ) }
						</button>
						<button
							type="button"
							onClick={ () => setInviteMode( 'participants' ) }
							disabled={ isSendingInvitations }
							style={ {
								padding: '10px 20px',
								border: 'none',
								background:
									inviteMode === 'participants'
										? '#fff'
										: '#f0f0f0',
								borderBottom:
									inviteMode === 'participants'
										? '2px solid #007cba'
										: '2px solid transparent',
								cursor: 'pointer',
								fontWeight:
									inviteMode === 'participants'
										? '600'
										: '400',
							} }
						>
							{ __( 'By Participant', 'fair-audience' ) }
						</button>
					</div>

					{ inviteMode === 'groups' && (
						<>
							{ groups.length === 0 ? (
								<p>
									{ __(
										'No groups available. Create groups first.',
										'fair-audience'
									) }
								</p>
							) : (
								<div
									style={ {
										maxHeight: '300px',
										overflow: 'auto',
										marginBottom: '15px',
										border: '1px solid #ddd',
										borderRadius: '4px',
									} }
								>
									{ groups.map( ( group ) => (
										<div
											key={ group.id }
											style={ {
												padding: '10px 15px',
												borderBottom: '1px solid #eee',
												display: 'flex',
												alignItems: 'center',
												gap: '10px',
											} }
										>
											<CheckboxControl
												label={ sprintf(
													/* translators: 1: group name, 2: member count */
													__(
														'%1$s (%2$d members)',
														'fair-audience'
													),
													group.name,
													group.member_count || 0
												) }
												checked={ selectedGroups.has(
													group.id
												) }
												disabled={
													isSendingInvitations
												}
												onChange={ () =>
													handleToggleGroup(
														group.id
													)
												}
											/>
										</div>
									) ) }
								</div>
							) }
						</>
					) }

					{ inviteMode === 'participants' && (
						<>
							<input
								type="text"
								placeholder={ __(
									'Search by name or email...',
									'fair-audience'
								) }
								value={ inviteSearch }
								onChange={ ( e ) =>
									setInviteSearch( e.target.value )
								}
								disabled={ isSendingInvitations }
								style={ {
									width: '100%',
									padding: '8px 12px',
									marginBottom: '10px',
									border: '1px solid #ddd',
									borderRadius: '4px',
								} }
							/>
							<div
								style={ {
									marginBottom: '10px',
									fontSize: '12px',
									color: '#666',
								} }
							>
								{ sprintf(
									/* translators: 1: selected count, 2: total count */
									__(
										'%1$d selected of %2$d participants',
										'fair-audience'
									),
									selectedInviteParticipants.size,
									allParticipants.length
								) }
							</div>
							{ allParticipants.length === 0 ? (
								<p>
									{ __(
										'No participants available.',
										'fair-audience'
									) }
								</p>
							) : (
								<div
									style={ {
										maxHeight: '300px',
										overflow: 'auto',
										marginBottom: '15px',
										border: '1px solid #ddd',
										borderRadius: '4px',
									} }
								>
									{ filteredInviteParticipants.map( ( p ) => (
										<div
											key={ p.id }
											style={ {
												padding: '10px 15px',
												borderBottom: '1px solid #eee',
												display: 'flex',
												alignItems: 'center',
												gap: '10px',
											} }
										>
											<CheckboxControl
												checked={ selectedInviteParticipants.has(
													p.id
												) }
												disabled={
													isSendingInvitations
												}
												onChange={ () =>
													handleToggleInviteParticipant(
														p.id
													)
												}
											/>
											<div>
												<strong>
													{ p.name } { p.surname }
												</strong>
												<br />
												<span
													style={ {
														color: '#666',
														fontSize: '12px',
													} }
												>
													{ p.email }
												</span>
											</div>
										</div>
									) ) }
									{ filteredInviteParticipants.length ===
										0 && (
										<p
											style={ {
												padding: '15px',
												color: '#666',
											} }
										>
											{ __(
												'No participants match your search.',
												'fair-audience'
											) }
										</p>
									) }
								</div>
							) }
						</>
					) }

					{ invitationPreview.status !== 'idle' && (
						<div style={ { marginBottom: '16px' } }>
							<InvitationSummary
								eventTitle={ eventInfo?.title }
								dateLabel={ eventDateLabel }
								groups={ invitedGroupsSummary }
								people={ invitedPeopleSummary }
								preview={ invitationPreview }
							/>
						</div>
					) }

					{ invitationError && (
						<div style={ { marginBottom: '16px' } }>
							<Notice status="error" isDismissible={ false }>
								{ invitationError }
							</Notice>
						</div>
					) }

					<div
						style={ {
							display: 'flex',
							justifyContent: 'flex-end',
							alignItems: 'center',
							flexWrap: 'wrap',
							gap: '10px',
						} }
					>
						{ invitationBlocked && (
							<span
								className="fair-audience-invitation-block-reason"
								style={ {
									color: '#646970',
									marginRight: 'auto',
								} }
							>
								{ invitationBlocked }
							</span>
						) }
						<Button
							variant="secondary"
							onClick={ handleCloseInvitationModal }
							disabled={ isSendingInvitations }
						>
							{ __( 'Cancel', 'fair-audience' ) }
						</Button>
						<Button
							variant="primary"
							onClick={ handleSendInvitations }
							isBusy={ isSendingInvitations }
							disabled={
								!! invitationBlocked || isSendingInvitations
							}
						>
							{ isSendingInvitations
								? __( 'Sending…', 'fair-audience' )
								: invitationPreview.status === 'ready' &&
									  invitationPreview.data.eligible_count > 0
									? sprintf(
											/* translators: %d: number of invitations to send */
											_n(
												'Send %d invitation',
												'Send %d invitations',
												invitationPreview.data
													.eligible_count,
												'fair-audience'
											),
											invitationPreview.data
												.eligible_count
										)
									: __(
											'Send Invitations',
											'fair-audience'
										) }
						</Button>
					</div>
				</Modal>
			) }
			{ removing && (
				<RemoveParticipantModal
					eventDateId={ resolvedEventDateId }
					participants={ removing }
					eventTitle={
						eventInfo?.title || __( 'this event', 'fair-audience' )
					}
					dateLabel={ eventDateLabel }
					listUrl={
						eventInfo?.manage_event_url
							? `${ eventInfo.manage_event_url }&tab=list`
							: undefined
					}
					onClose={ () => setRemoving( null ) }
					onRemoved={ handleRemoved }
					onRefused={ loadParticipants }
				/>
			) }

			<FeedbackSnackbar
				message={ snackbar }
				onRemove={ () => setSnackbar( null ) }
			/>
		</div>
	);
}
