/**
 * What an event invitation will do, shown right before it is sent: the event
 * and its date, who was selected, how many different people will receive it
 * and why the others will not.
 *
 * The counts come from the server's invitation preview, which resolves
 * recipients exactly as the send does. The eligible IDs it returns are what
 * the screens send, so the invitation reaches the people summarized here and
 * nobody added to a group since.
 *
 * @package FairAudience
 */

import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import {
	Button,
	Notice,
	Spinner,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import SelectedParticipantsList from './SelectedParticipantsList.js';
import { identifyParticipants } from './participantIdentity.js';

const IDLE_PREVIEW = { status: 'idle', data: null, error: null };

/**
 * Why people are left out, in the order the server checks them.
 *
 * @param {Object} excluded Counts by reason.
 * @return {string[]} One sentence per reason that applies.
 */
const exclusionLines = ( excluded ) =>
	[
		excluded.already_signed_up > 0 &&
			sprintf(
				/* translators: %d: number of people */
				_n(
					'%d is already signed up for this date.',
					'%d are already signed up for this date.',
					excluded.already_signed_up,
					'fair-audience'
				),
				excluded.already_signed_up
			),
		excluded.unavailable > 0 &&
			sprintf(
				/* translators: %d: number of people */
				_n(
					'%d is no longer in the audience.',
					'%d are no longer in the audience.',
					excluded.unavailable,
					'fair-audience'
				),
				excluded.unavailable
			),
		excluded.invalid_email > 0 &&
			sprintf(
				/* translators: %d: number of people */
				_n(
					'%d has no valid email address.',
					'%d have no valid email address.',
					excluded.invalid_email,
					'fair-audience'
				),
				excluded.invalid_email
			),
		excluded.no_marketing_consent > 0 &&
			sprintf(
				/* translators: %d: number of people */
				_n(
					'%d has not confirmed they want marketing emails, or opted out.',
					'%d have not confirmed they want marketing emails, or opted out.',
					excluded.no_marketing_consent,
					'fair-audience'
				),
				excluded.no_marketing_consent
			),
	].filter( Boolean );

/**
 * Ask the server who an invitation would reach whenever the selection
 * changes. Only the answer to the latest request is kept: an earlier one
 * arriving late would summarize a selection the organizer has moved on from.
 *
 * @param {number|string} eventDateId    Event date invited to.
 * @param {Object}        selection
 * @param {number[]}      selection.groupIds       Selected group IDs.
 * @param {number[]}      selection.participantIds Selected participant IDs.
 * @return {{status: string, data: Object|null, error: string|null, reload: Function}} Preview state.
 */
export function useInvitationPreview(
	eventDateId,
	{ groupIds = [], participantIds = [] }
) {
	const [ preview, setPreview ] = useState( IDLE_PREVIEW );
	const [ attempt, setAttempt ] = useState( 0 );
	const latestRequest = useRef( 0 );

	const groupsKey = groupIds.join( ',' );
	const participantsKey = participantIds.join( ',' );

	useEffect( () => {
		latestRequest.current += 1;
		const requestId = latestRequest.current;

		if ( ! eventDateId || ( groupsKey === '' && participantsKey === '' ) ) {
			setPreview( IDLE_PREVIEW );
			return;
		}

		const data = {};
		if ( groupsKey !== '' ) {
			data.group_ids = groupsKey.split( ',' ).map( Number );
		}
		if ( participantsKey !== '' ) {
			data.participant_ids = participantsKey.split( ',' ).map( Number );
		}

		// The previous summary no longer describes this selection.
		setPreview( { status: 'loading', data: null, error: null } );
		apiFetch( {
			path: `/fair-audience/v1/event-dates/${ eventDateId }/event-invitations/preview`,
			method: 'POST',
			data,
		} )
			.then( ( response ) => {
				if ( requestId === latestRequest.current ) {
					setPreview( {
						status: 'ready',
						data: response,
						error: null,
					} );
				}
			} )
			.catch( ( err ) => {
				if ( requestId === latestRequest.current ) {
					setPreview( {
						status: 'error',
						data: null,
						error: err?.message || null,
					} );
				}
			} );
	}, [ eventDateId, groupsKey, participantsKey, attempt ] );

	const reload = useCallback( () => setAttempt( ( n ) => n + 1 ), [] );

	return { ...preview, reload };
}

/**
 * Why the invitation cannot be sent yet, or null when it can.
 *
 * @param {Object} preview State from useInvitationPreview().
 * @return {string|null} Reason.
 */
export function invitationBlockReason( preview ) {
	switch ( preview.status ) {
		case 'idle':
			return __(
				'Select who should receive the invitation.',
				'fair-audience'
			);
		case 'loading':
			return __( 'Checking who can be invited…', 'fair-audience' );
		case 'error':
			return __(
				'Check the recipients again before sending.',
				'fair-audience'
			);
		default:
			return preview.data.eligible_count === 0
				? __( 'Nobody selected can be invited.', 'fair-audience' )
				: null;
	}
}

/**
 * @param {Object}   props
 * @param {string}   props.eventTitle Event invited to.
 * @param {string}   props.dateLabel  Its date and time, as the page shows it.
 * @param {Array}    props.groups     Selected groups (id, name, member_count).
 * @param {Array}    props.people     Selected people ({id, name, email}).
 * @param {Object}   props.preview    State from useInvitationPreview().
 * @return {Element} Summary.
 */
export default function InvitationSummary( {
	eventTitle,
	dateLabel,
	groups = [],
	people = [],
	preview,
} ) {
	const title = eventTitle || __( '(untitled event)', 'fair-audience' );
	const data = preview.status === 'ready' ? preview.data : null;
	const exclusions = data ? exclusionLines( data.excluded ) : [];

	return (
		<section
			className="fair-audience-invitation-summary"
			aria-label={ __( 'Invitation summary', 'fair-audience' ) }
			style={ {
				padding: '12px 16px',
				border: '1px solid #ddd',
				borderRadius: '4px',
				background: '#f6f7f7',
				overflowWrap: 'anywhere',
			} }
		>
			<VStack spacing={ 3 }>
				<p style={ { margin: 0 } }>
					{ dateLabel
						? sprintf(
								/* translators: 1: event title, 2: event date and time */
								__(
									'Invitation to %1$s on %2$s',
									'fair-audience'
								),
								title,
								dateLabel
							)
						: sprintf(
								/* translators: %s: event title */
								__( 'Invitation to %s', 'fair-audience' ),
								title
							) }
				</p>

				{ groups.length > 0 && (
					<div>
						<p style={ { margin: '0 0 4px' } }>
							{ __( 'Selected groups:', 'fair-audience' ) }
						</p>
						<ul
							style={ {
								margin: 0,
								paddingLeft: '20px',
								listStyle: 'disc',
							} }
						>
							{ groups.map( ( group ) => (
								<li key={ group.id }>
									<strong>{ group.name }</strong>
									{ ' — ' }
									{ sprintf(
										/* translators: %d: number of group members */
										_n(
											'%d member',
											'%d members',
											group.member_count || 0,
											'fair-audience'
										),
										group.member_count || 0
									) }
								</li>
							) ) }
						</ul>
					</div>
				) }

				{ people.length > 0 && (
					<div>
						<p style={ { margin: '0 0 4px' } }>
							{ sprintf(
								/* translators: %d: number of selected people */
								_n(
									'%d person selected:',
									'%d people selected:',
									people.length,
									'fair-audience'
								),
								people.length
							) }
						</p>
						<SelectedParticipantsList
							label={ __( 'Selected people', 'fair-audience' ) }
							people={ identifyParticipants( people ) }
						/>
					</div>
				) }

				{ preview.status === 'loading' && (
					<p style={ { margin: 0 } } role="status">
						<Spinner />
						{ __(
							'Checking who can be invited…',
							'fair-audience'
						) }
					</p>
				) }

				{ preview.status === 'error' && (
					<Notice status="error" isDismissible={ false }>
						<p style={ { marginTop: 0 } }>
							{ preview.error
								? sprintf(
										/* translators: %s: error message */
										__(
											'Who can be invited could not be checked: %s',
											'fair-audience'
										),
										preview.error
									)
								: __(
										'Who can be invited could not be checked.',
										'fair-audience'
									) }
						</p>
						<Button variant="secondary" onClick={ preview.reload }>
							{ __( 'Check again', 'fair-audience' ) }
						</Button>
					</Notice>
				) }

				{ data && (
					<>
						{ data.group_membership_count > 0 && (
							<p style={ { margin: 0 } }>
								{ sprintf(
									/* translators: 1: number of group memberships, 2: number of different people */
									_n(
										'%1$d group membership in total, %2$d different people selected.',
										'%1$d group memberships in total, %2$d different people selected.',
										data.group_membership_count,
										'fair-audience'
									),
									data.group_membership_count,
									data.candidate_count
								) }
							</p>
						) }

						{ data.eligible_count > 0 ? (
							<p style={ { margin: 0 } }>
								<strong>
									{ sprintf(
										/* translators: %d: number of people who will receive the invitation */
										_n(
											'%d person will receive this invitation.',
											'%d people will receive this invitation.',
											data.eligible_count,
											'fair-audience'
										),
										data.eligible_count
									) }
								</strong>
							</p>
						) : (
							<Notice status="warning" isDismissible={ false }>
								{ __(
									'Nobody selected can be invited, so nothing will be sent.',
									'fair-audience'
								) }
							</Notice>
						) }

						{ exclusions.length > 0 && (
							<div>
								<p style={ { margin: '0 0 4px' } }>
									{ __( 'Not invited:', 'fair-audience' ) }
								</p>
								<ul
									style={ {
										margin: 0,
										paddingLeft: '20px',
										listStyle: 'disc',
									} }
								>
									{ exclusions.map( ( line ) => (
										<li key={ line }>{ line }</li>
									) ) }
								</ul>
							</div>
						) }
					</>
				) }
			</VStack>
		</section>
	);
}
