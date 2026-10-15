/**
 * Delete one or several participant profiles, from the participants list or
 * a participant's own page.
 *
 * The popup names who is deleted — every selected person when there are
 * several — and says what deleting a profile does and does not do before
 * anything is changed. Each profile is deleted on its own: the ones that
 * went through are reported, and only the ones that failed stay in the
 * popup for another attempt.
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
import SelectedParticipantsList from './SelectedParticipantsList.js';
import {
	identifyParticipants,
	participantLabel,
	personFromProfile,
} from './participantIdentity.js';

// A long name or event title wraps inside the popup instead of widening it.
const MODAL_STYLE = {
	maxWidth: '560px',
	width: '100%',
	overflowWrap: 'anywhere',
};

/**
 * @param {Object}   props
 * @param {Array}    props.participants Profiles to delete, as the participants endpoint returns them.
 * @param {Function} props.onClose      Close without deleting anything more.
 * @param {Function} props.onDeleted    Called after an attempt that deleted at least one profile, with the deleted profiles and the ones still in the popup.
 * @return {Element} Popup.
 */
export default function DeleteParticipantsModal( {
	participants,
	onClose,
	onDeleted,
} ) {
	// The profiles still to delete, each with why its last attempt failed.
	const [ items, setItems ] = useState( () =>
		participants.map( ( participant ) => ( { participant, error: null } ) )
	);
	const [ isBulk ] = useState( participants.length > 1 );
	const [ isDeleting, setIsDeleting ] = useState( false );
	const [ deletedCount, setDeletedCount ] = useState( 0 );
	// Refuses a second submission before the first one re-rendered the popup.
	const inFlight = useRef( false );

	const people = useMemo( () => {
		const identified = identifyParticipants(
			items.map( ( item ) => personFromProfile( item.participant ) )
		);
		return identified.map( ( person, index ) => ( {
			...person,
			note: items[ index ].error,
		} ) );
	}, [ items ] );
	const failedPeople = people.filter( ( person ) => person.note );
	// Named once: the popup closes as soon as its only profile is deleted.
	const [ name ] = useState( () =>
		participantLabel( personFromProfile( participants[ 0 ] ) )
	);

	const submit = async () => {
		if ( inFlight.current ) {
			return;
		}
		inFlight.current = true;
		setIsDeleting( true );

		const outcomes = await Promise.all(
			items.map( ( { participant } ) =>
				apiFetch( {
					path: `/fair-audience/v1/participants/${ participant.id }`,
					method: 'DELETE',
				} )
					.then( () => ( { participant, error: null } ) )
					.catch( ( err ) => ( {
						participant,
						// Already gone: what a retry after a lost response finds.
						error:
							err?.code === 'participant_not_found'
								? null
								: err?.message ||
									__(
										'The profile could not be deleted.',
										'fair-audience'
									),
					} ) )
			)
		);

		const deleted = outcomes
			.filter( ( outcome ) => ! outcome.error )
			.map( ( outcome ) => outcome.participant );
		const remaining = outcomes.filter( ( outcome ) => outcome.error );

		setItems( remaining );
		setDeletedCount( ( count ) => count + deleted.length );
		inFlight.current = false;
		setIsDeleting( false );

		if ( deleted.length > 0 ) {
			onDeleted(
				deleted,
				remaining.map( ( outcome ) => outcome.participant )
			);
		}
	};

	const close = () => {
		if ( ! isDeleting ) {
			onClose();
		}
	};

	return (
		<Modal
			title={
				isBulk
					? __( 'Delete participant profiles', 'fair-audience' )
					: sprintf(
							/* translators: %s: participant name */
							__( 'Delete participant — %s', 'fair-audience' ),
							name
						)
			}
			onRequestClose={ close }
			style={ MODAL_STYLE }
		>
			<VStack spacing={ 4 }>
				{ deletedCount > 0 && (
					<Notice status="success" isDismissible={ false }>
						{ sprintf(
							/* translators: %d: number of participant profiles */
							_n(
								'%d participant profile was deleted.',
								'%d participant profiles were deleted.',
								deletedCount,
								'fair-audience'
							),
							deletedCount
						) }
					</Notice>
				) }

				{ failedPeople.length > 0 && (
					<Notice status="error" isDismissible={ false }>
						<p style={ { marginTop: 0 } }>
							{ sprintf(
								/* translators: %d: number of participant profiles */
								_n(
									'%d participant profile could not be deleted and was kept. Try again:',
									'%d participant profiles could not be deleted and were kept. Try again:',
									failedPeople.length,
									'fair-audience'
								),
								failedPeople.length
							) }
						</p>
						<SelectedParticipantsList
							label={ __(
								'Profiles that could not be deleted',
								'fair-audience'
							) }
							people={ failedPeople }
						/>
					</Notice>
				) }

				{ isBulk ? (
					<>
						<p style={ { margin: 0 } }>
							{ sprintf(
								/* translators: %d: number of participant profiles */
								_n(
									'Permanently delete the profile of %d participant?',
									'Permanently delete the profiles of %d participants?',
									people.length,
									'fair-audience'
								),
								people.length
							) }
						</p>
						{ failedPeople.length === 0 && (
							<SelectedParticipantsList
								label={ __(
									'Participants to delete',
									'fair-audience'
								) }
								people={ people }
							/>
						) }
					</>
				) : (
					<p style={ { margin: 0 } }>
						{ sprintf(
							/* translators: %s: participant name */
							__(
								'Permanently delete the participant profile of %s?',
								'fair-audience'
							),
							name
						) }
					</p>
				) }

				<p style={ { margin: 0 } }>
					{ __(
						'A deleted profile is gone with the name, contact details and mailing settings stored on it. This cannot be undone.',
						'fair-audience'
					) }
				</p>
				<p style={ { margin: 0 } }>
					{ __(
						'Deleting a profile does not cancel tickets, delete event registrations or refund payments. To take someone out of one event only, remove them from that event instead.',
						'fair-audience'
					) }
				</p>

				<HStack spacing={ 3 } justify="flex-end" wrap>
					<Button
						variant="secondary"
						onClick={ close }
						disabled={ isDeleting }
					>
						{ __( 'Cancel', 'fair-audience' ) }
					</Button>
					<Button
						variant="primary"
						isDestructive
						onClick={ submit }
						isBusy={ isDeleting }
						disabled={ isDeleting }
					>
						{ isDeleting && __( 'Deleting…', 'fair-audience' ) }
						{ ! isDeleting &&
							( isBulk
								? sprintf(
										/* translators: %d: number of participant profiles */
										_n(
											'Delete %d participant',
											'Delete %d participants',
											people.length,
											'fair-audience'
										),
										people.length
									)
								: __(
										'Delete participant',
										'fair-audience'
									) ) }
					</Button>
				</HStack>
			</VStack>
		</Modal>
	);
}
