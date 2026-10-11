/**
 * Remove a participant from one event date, from the Audience tab.
 *
 * The popup names the participant, the event and the date, and says what
 * is removed and what is kept before anything is changed. A participant
 * whose tickets, registrations or payments still rest on this date cannot be
 * removed: the popup then says what to resolve first, and offers no removal.
 * The server checks again, so a refusal for something that changed since the
 * list was loaded is shown the same way.
 *
 * @package FairAudience
 */

import { useRef, useState } from '@wordpress/element';
import {
	Button,
	Modal,
	Notice,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

// The List tab of the same Manage Event page, where registrations are deleted.
const listTabUrl = () => {
	const url = new URL( window.location.href );
	url.searchParams.set( 'tab', 'list' );
	return url.toString();
};

/**
 * @param {Object}   props
 * @param {number}   props.eventDateId Event date the participant is removed from.
 * @param {Object}   props.participant Row from the participants endpoint.
 * @param {string}   props.eventTitle  Event title.
 * @param {string}   props.dateLabel   The event date, as shown to the organizer; empty when unknown.
 * @param {Function} props.onClose     Close without removing.
 * @param {Function} props.onRemoved   Called once the participant is removed.
 * @param {Function} props.onRefused   Called when the server refused or failed, so the list can be reloaded.
 * @return {Element} Popup.
 */
export default function RemoveParticipantModal( {
	eventDateId,
	participant,
	eventTitle,
	dateLabel,
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
			onRemoved( participant );
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
			style={ { maxWidth: '560px', width: '100%' } }
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
							<ul
								style={ {
									margin: 0,
									paddingLeft: '18px',
									listStyle: 'disc',
								} }
							>
								{ blockers.map( ( blocker ) => (
									<li key={ blocker.code }>
										{ blocker.message }
									</li>
								) ) }
							</ul>
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
					{ isBlocked &&
						blockers.some(
							( blocker ) => blocker.code === 'registration'
						) && (
							<Button variant="secondary" href={ listTabUrl() }>
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
