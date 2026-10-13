/**
 * Remove one or several participants from one event date, from the Audience
 * tab or the Event Participants page.
 *
 * The popup names who is removed — every selected person when there are
 * several — the event and the date, and says what is removed and what is
 * kept before anything is changed. A participant whose tickets,
 * registrations or payments still rest on this date cannot be removed: the
 * popup then says what to resolve first, and offers no removal for them.
 * The server checks again, so a refusal for something that changed since the
 * list was loaded is shown the same way. Of several participants, the ones
 * that could be removed are, and the others stay in the popup with the
 * reason.
 *
 * @package FairAudience
 */

import { useMemo, useRef, useState } from '@wordpress/element';
import {
	Button,
	Modal,
	Notice,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import SelectedParticipantsList from '../components/SelectedParticipantsList.js';
import {
	identifyParticipants,
	personFromEventRow,
} from '../components/participantIdentity.js';

// A long name or event title wraps inside the popup instead of widening it.
const MODAL_STYLE = {
	maxWidth: '560px',
	width: '100%',
	overflowWrap: 'anywhere',
};

// The List tab of the same Manage Event page, where registrations are deleted.
const listTabUrl = () => {
	const url = new URL( window.location.href );
	url.searchParams.set( 'tab', 'list' );
	return url.toString();
};

const hasRegistrationBlocker = ( blockers ) =>
	blockers.some( ( blocker ) => blocker.code === 'registration' );

const blockerList = ( blockers ) => (
	<ul
		style={ {
			margin: 0,
			paddingLeft: '18px',
			listStyle: 'disc',
		} }
	>
		{ blockers.map( ( blocker ) => (
			<li key={ blocker.code }>{ blocker.message }</li>
		) ) }
	</ul>
);

/**
 * One participant: the confirmation names them in its title and question.
 *
 * @param {Object} props Same as the default export, with the one row as `participant`.
 * @return {Element} Popup.
 */
function RemoveOneParticipantModal( {
	eventDateId,
	participant,
	eventTitle,
	dateLabel,
	listUrl,
	onClose,
	onRemoved,
	onRefused,
} ) {
	const [ isRemoving, setIsRemoving ] = useState( false );
	const [ error, setError ] = useState( null );
	// What stops the removal: as listed, until the server says otherwise.
	const [ blockers, setBlockers ] = useState(
		participant.removal_blockers || []
	);
	// Refuses a second submission before the first one re-rendered the popup.
	const inFlight = useRef( false );

	const name =
		( participant.participant_name || '' ).trim() ||
		__( 'this participant', 'fair-audience' );
	const isBlocked = blockers.length > 0;

	const submit = async () => {
		if ( inFlight.current ) {
			return;
		}
		inFlight.current = true;
		setIsRemoving( true );
		setError( null );
		try {
			await apiFetch( {
				path: `/fair-audience/v1/event-dates/${ eventDateId }/participants/${ participant.participant_id }`,
				method: 'DELETE',
			} );
			onRemoved( [ participant ], [] );
		} catch ( err ) {
			if (
				err?.code === 'removal_blocked' &&
				Array.isArray( err.data?.blockers )
			) {
				setBlockers( err.data.blockers );
			} else {
				setError( err );
			}
			inFlight.current = false;
			setIsRemoving( false );
			onRefused();
		}
	};

	const close = () => {
		if ( ! isRemoving ) {
			onClose();
		}
	};

	return (
		<Modal
			title={ sprintf(
				/* translators: %s: participant name */
				__( 'Remove participant — %s', 'fair-audience' ),
				name
			) }
			onRequestClose={ close }
			style={ MODAL_STYLE }
		>
			<VStack spacing={ 4 }>
				{ isBlocked ? (
					<>
						<Notice status="warning" isDismissible={ false }>
							<p style={ { marginTop: 0 } }>
								{ dateLabel
									? sprintf(
											/* translators: 1: participant name, 2: event title, 3: event date and time */
											__(
												'%1$s cannot be removed from %2$s on %3$s yet.',
												'fair-audience'
											),
											name,
											eventTitle,
											dateLabel
									  )
									: sprintf(
											/* translators: 1: participant name, 2: event title */
											__(
												'%1$s cannot be removed from %2$s yet.',
												'fair-audience'
											),
											name,
											eventTitle
									  ) }
							</p>
							{ blockerList( blockers ) }
						</Notice>
						<p style={ { margin: 0 } }>
							{ __(
								'Nothing was changed. Tickets are never cancelled, registrations never deleted and payments never refunded for you: once the points above are resolved, remove the participant here.',
								'fair-audience'
							) }
						</p>
					</>
				) : (
					<>
						<p style={ { margin: 0 } }>
							{ dateLabel
								? sprintf(
										/* translators: 1: participant name, 2: event title, 3: event date and time */
										__(
											'Remove %1$s from the audience of %2$s on %3$s?',
											'fair-audience'
										),
										name,
										eventTitle,
										dateLabel
								  )
								: sprintf(
										/* translators: 1: participant name, 2: event title */
										__(
											'Remove %1$s from the audience of %2$s?',
											'fair-audience'
										),
										name,
										eventTitle
								  ) }
						</p>
						<p style={ { margin: 0 } }>
							{ __(
								'Only their place in the audience of this date is removed, with the role, activities, check-in and comment recorded for it. Their participant profile, their other events and dates, and all payment records are kept. You can add them to this date again later.',
								'fair-audience'
							) }
						</p>
					</>
				) }

				{ error && (
					<Notice status="error" isDismissible={ false }>
						{ error.message ||
							__(
								'The participant could not be removed. Nothing was changed; try again.',
								'fair-audience'
							) }
					</Notice>
				) }

				<HStack spacing={ 3 } justify="flex-end" wrap>
					{ isBlocked && hasRegistrationBlocker( blockers ) && (
						<Button
							variant="secondary"
							href={ listUrl || listTabUrl() }
						>
							{ __( 'Open the List tab', 'fair-audience' ) }
						</Button>
					) }
					<Button
						variant={ isBlocked ? 'primary' : 'secondary' }
						onClick={ close }
						disabled={ isRemoving }
					>
						{ isBlocked
							? __( 'Back to the audience', 'fair-audience' )
							: __( 'Keep participant', 'fair-audience' ) }
					</Button>
					{ ! isBlocked && (
						<Button
							variant="primary"
							isDestructive
							onClick={ submit }
							isBusy={ isRemoving }
							disabled={ isRemoving }
						>
							{ isRemoving
								? __( 'Removing…', 'fair-audience' )
								: __( 'Remove participant', 'fair-audience' ) }
						</Button>
					) }
				</HStack>
			</VStack>
		</Modal>
	);
}

/**
 * Several participants: the confirmation counts them and lists who they are.
 *
 * @param {Object} props Same as the default export.
 * @return {Element} Popup.
 */
function RemoveParticipantsModal( {
	eventDateId,
	participants,
	eventTitle,
	dateLabel,
	listUrl,
	onClose,
	onRemoved,
	onRefused,
} ) {
	// The rows still in the audience: each with what stops its removal (as
	// listed, until the server says otherwise) or why its last attempt failed.
	const [ items, setItems ] = useState( () =>
		participants.map( ( row ) => ( {
			row,
			blockers: row.removal_blockers || [],
			error: null,
		} ) )
	);
	const [ isRemoving, setIsRemoving ] = useState( false );
	const [ removedCount, setRemovedCount ] = useState( 0 );
	// A request that failed as a whole: nothing is known to have changed.
	const [ requestError, setRequestError ] = useState( null );
	// Refuses a second submission before the first one re-rendered the popup.
	const inFlight = useRef( false );

	const people = useMemo( () => {
		const identified = identifyParticipants(
			items.map( ( item ) => personFromEventRow( item.row ) )
		);
		return identified.map( ( person, index ) => ( {
			...person,
			blockers: items[ index ].blockers,
			error: items[ index ].error,
		} ) );
	}, [ items ] );
	const removable = people.filter(
		( person ) => person.blockers.length === 0
	);
	const blocked = people.filter( ( person ) => person.blockers.length > 0 );
	const failed = removable.filter( ( person ) => person.error );

	const submit = async () => {
		if ( inFlight.current ) {
			return;
		}
		inFlight.current = true;
		setIsRemoving( true );
		setRequestError( null );

		const submitted = items.filter(
			( item ) => item.blockers.length === 0
		);
		try {
			const response = await apiFetch( {
				path: `/fair-audience/v1/event-dates/${ eventDateId }/participants/batch`,
				method: 'DELETE',
				data: {
					participant_ids: submitted.map(
						( item ) => item.row.participant_id
					),
				},
			} );

			// The route answers 200 with removals and refusals side by side.
			const failures = new Map(
				( response.failures || [] ).map( ( failure ) => [
					Number( failure.participant_id ),
					failure,
				] )
			);
			const removedRows = [];
			const remaining = items
				.map( ( item ) => {
					if ( item.blockers.length > 0 ) {
						return item;
					}
					const failure = failures.get(
						Number( item.row.participant_id )
					);
					if ( ! failure ) {
						removedRows.push( item.row );
						return null;
					}
					const blockers = Array.isArray( failure.blockers )
						? failure.blockers
						: [];
					return {
						row: item.row,
						blockers,
						error: blockers.length > 0 ? null : failure.message,
					};
				} )
				.filter( Boolean );

			setItems( remaining );
			setRemovedCount( ( count ) => count + removedRows.length );
			inFlight.current = false;
			setIsRemoving( false );

			if ( removedRows.length > 0 ) {
				onRemoved(
					removedRows,
					remaining.map( ( item ) => item.row )
				);
			} else {
				onRefused();
			}
		} catch ( err ) {
			setRequestError( err );
			inFlight.current = false;
			setIsRemoving( false );
			onRefused();
		}
	};

	const close = () => {
		if ( ! isRemoving ) {
			onClose();
		}
	};

	return (
		<Modal
			title={ __(
				'Remove participants from this event',
				'fair-audience'
			) }
			onRequestClose={ close }
			style={ MODAL_STYLE }
		>
			<VStack spacing={ 4 }>
				{ removedCount > 0 && (
					<Notice status="success" isDismissible={ false }>
						{ sprintf(
							/* translators: %d: number of participants */
							_n(
								'%d participant was removed from this date.',
								'%d participants were removed from this date.',
								removedCount,
								'fair-audience'
							),
							removedCount
						) }
					</Notice>
				) }

				{ removable.length > 0 && (
					<>
						<p style={ { margin: 0 } }>
							{ dateLabel
								? sprintf(
										/* translators: 1: number of participants, 2: event title, 3: event date and time */
										_n(
											'Remove %1$d participant from the audience of %2$s on %3$s?',
											'Remove %1$d participants from the audience of %2$s on %3$s?',
											removable.length,
											'fair-audience'
										),
										removable.length,
										eventTitle,
										dateLabel
								  )
								: sprintf(
										/* translators: 1: number of participants, 2: event title */
										_n(
											'Remove %1$d participant from the audience of %2$s?',
											'Remove %1$d participants from the audience of %2$s?',
											removable.length,
											'fair-audience'
										),
										removable.length,
										eventTitle
								  ) }
						</p>
						<SelectedParticipantsList
							label={ __(
								'Participants to remove',
								'fair-audience'
							) }
							people={ removable.map( ( person ) => ( {
								...person,
								note: person.error,
							} ) ) }
						/>
						<p style={ { margin: 0 } }>
							{ __(
								'Only their place in the audience of this date is removed, with the role, activities, check-in and comment recorded for it. Their participant profiles, their other events and dates, and all payment records are kept. You can add them to this date again later.',
								'fair-audience'
							) }
						</p>
					</>
				) }

				{ failed.length > 0 && (
					<Notice status="error" isDismissible={ false }>
						{ sprintf(
							/* translators: %d: number of participants */
							_n(
								'%d participant could not be removed and is still in the audience. The reason is shown with their name; try again.',
								'%d participants could not be removed and are still in the audience. The reason is shown with each name; try again.',
								failed.length,
								'fair-audience'
							),
							failed.length
						) }
					</Notice>
				) }

				{ blocked.length > 0 && (
					<>
						<Notice status="warning" isDismissible={ false }>
							<p style={ { marginTop: 0 } }>
								{ dateLabel
									? sprintf(
											/* translators: 1: number of participants, 2: event title, 3: event date and time */
											_n(
												'%1$d participant cannot be removed from %2$s on %3$s yet and stays in the audience:',
												'%1$d participants cannot be removed from %2$s on %3$s yet and stay in the audience:',
												blocked.length,
												'fair-audience'
											),
											blocked.length,
											eventTitle,
											dateLabel
									  )
									: sprintf(
											/* translators: 1: number of participants, 2: event title */
											_n(
												'%1$d participant cannot be removed from %2$s yet and stays in the audience:',
												'%1$d participants cannot be removed from %2$s yet and stay in the audience:',
												blocked.length,
												'fair-audience'
											),
											blocked.length,
											eventTitle
									  ) }
							</p>
							<SelectedParticipantsList
								label={ __(
									'Participants who cannot be removed yet',
									'fair-audience'
								) }
								people={ blocked.map( ( person ) => ( {
									...person,
									note: blockerList( person.blockers ),
								} ) ) }
							/>
						</Notice>
						<p style={ { margin: 0 } }>
							{ __(
								'Nothing was changed for them. Tickets are never cancelled, registrations never deleted and payments never refunded for you: once the points above are resolved, remove them here.',
								'fair-audience'
							) }
						</p>
					</>
				) }

				{ requestError && (
					<Notice status="error" isDismissible={ false }>
						{ requestError.message ||
							__(
								'The participants could not be removed. Nothing was changed; try again.',
								'fair-audience'
							) }
					</Notice>
				) }

				<HStack spacing={ 3 } justify="flex-end" wrap>
					{ blocked.some( ( person ) =>
						hasRegistrationBlocker( person.blockers )
					) && (
						<Button
							variant="secondary"
							href={ listUrl || listTabUrl() }
						>
							{ __( 'Open the List tab', 'fair-audience' ) }
						</Button>
					) }
					<Button
						variant={
							removable.length > 0 ? 'secondary' : 'primary'
						}
						onClick={ close }
						disabled={ isRemoving }
					>
						{ removable.length > 0
							? __( 'Keep participants', 'fair-audience' )
							: __( 'Back to the audience', 'fair-audience' ) }
					</Button>
					{ removable.length > 0 && (
						<Button
							variant="primary"
							isDestructive
							onClick={ submit }
							isBusy={ isRemoving }
							disabled={ isRemoving }
						>
							{ isRemoving
								? __( 'Removing…', 'fair-audience' )
								: sprintf(
										/* translators: %d: number of participants */
										_n(
											'Remove %d participant',
											'Remove %d participants',
											removable.length,
											'fair-audience'
										),
										removable.length
								  ) }
						</Button>
					) }
				</HStack>
			</VStack>
		</Modal>
	);
}

/**
 * @param {Object}   props
 * @param {number}   props.eventDateId  Event date the participants are removed from.
 * @param {Array}    props.participants Rows from the event participants endpoint.
 * @param {string}   props.eventTitle   Event title.
 * @param {string}   props.dateLabel    The event date, as shown to the organizer; empty when unknown.
 * @param {string}   props.listUrl      Where registrations are deleted; the List tab of the current page when omitted.
 * @param {Function} props.onClose      Close without removing anything more.
 * @param {Function} props.onRemoved    Called after an attempt that removed at least one participant, with the removed rows and the rows still in the popup.
 * @param {Function} props.onRefused    Called when the server refused or failed without removing anyone, so the list can be reloaded.
 * @return {Element} Popup.
 */
export default function RemoveParticipantModal( { participants, ...props } ) {
	// Decided once: a selection that shrinks to one person after a partial
	// removal keeps its results on screen.
	const [ isBulk ] = useState( participants.length > 1 );
	const [ participant ] = useState( participants[ 0 ] );

	return isBulk ? (
		<RemoveParticipantsModal participants={ participants } { ...props } />
	) : (
		<RemoveOneParticipantModal participant={ participant } { ...props } />
	);
}
