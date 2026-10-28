/**
 * Add the participants behind a questionnaire's responses to a fair-audience
 * group, picking an existing group or creating a new one.
 *
 * The popup lists everyone it is about to add and says up front who is left
 * out or skipped. Each participant is added on its own: the ones that went
 * through or were already in the group are reported, and only the ones that
 * failed stay in the popup for another attempt — against the same group, so
 * a retry after creating a group never creates a second one.
 */

import { __, _n, sprintf } from '@wordpress/i18n';
import { useEffect, useMemo, useRef, useState } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Modal,
	Notice,
	RadioControl,
	SelectControl,
	TextControl,
	TextareaControl,
} from '@wordpress/components';

// A long name or group title wraps inside the popup instead of widening it.
const MODAL_STYLE = {
	maxWidth: '560px',
	width: '100%',
	overflowWrap: 'anywhere',
};

const clean = ( value ) => ( value || '' ).trim();

/**
 * The unique participants behind the loaded responses, in response order,
 * with how many responses were left out or counted once.
 *
 * @param {Array} responses Rows as the questionnaire-responses endpoint returns them.
 * @return {{participants: Array<{id: number, name: string, email: string}>, unlinkedCount: number, duplicateCount: number}} Snapshot for the popup.
 */
export function collectParticipants( responses ) {
	const byId = new Map();
	let unlinkedCount = 0;
	let duplicateCount = 0;

	responses.forEach( ( response ) => {
		const id = parseInt( response.participant_id, 10 );
		if ( ! ( id > 0 ) ) {
			unlinkedCount++;
			return;
		}
		if ( byId.has( id ) ) {
			duplicateCount++;
			return;
		}
		byId.set( id, {
			id,
			name: clean( response.participant_name ),
			email: clean( response.participant_email ),
		} );
	} );

	return {
		participants: Array.from( byId.values() ),
		unlinkedCount,
		duplicateCount,
	};
}

/**
 * What to call each person of a list: their name, with the email (or the ID
 * when there is no email) added only where the name alone is missing or
 * shared by someone else in the list.
 *
 * @param {Array<{id: number, name: string, email: string}>} people People to identify.
 * @return {Array<{id: number, label: string, detail: string}>} A label per person.
 */
export function identifyParticipants( people ) {
	const nameCounts = people.reduce(
		( counts, person ) =>
			counts.set(
				person.name.toLowerCase(),
				( counts.get( person.name.toLowerCase() ) || 0 ) + 1
			),
		new Map()
	);
	const idDetail = ( id ) =>
		sprintf(
			/* translators: %d: participant ID */
			__( 'ID %d', 'fair-form' ),
			id
		);

	return people.map( ( person ) => {
		if ( ! person.name ) {
			return {
				id: person.id,
				label:
					person.email ||
					sprintf(
						/* translators: %d: participant ID */
						__( 'Participant #%d', 'fair-form' ),
						person.id
					),
				detail: person.email ? idDetail( person.id ) : '',
			};
		}
		const isShared = nameCounts.get( person.name.toLowerCase() ) > 1;
		return {
			id: person.id,
			label: person.name,
			detail: isShared
				? `${ person.email ? person.email + ', ' : '' }${ idDetail(
						person.id
					) }`
				: '',
		};
	} );
}

function ParticipantList( { label, people } ) {
	return (
		<ul
			className="fair-form-group-modal__people"
			aria-label={ label }
			// Focusable, so a keyboard can scroll a long selection.
			tabIndex={ 0 }
		>
			{ people.map( ( person ) => (
				<li key={ person.id }>
					<strong>{ person.label }</strong>
					{ person.detail && (
						<span className="fair-form-group-modal__detail">
							{ ' ' }
							({ person.detail })
						</span>
					) }
					{ person.note && (
						<div className="fair-form-group-modal__note">
							{ person.note }
						</div>
					) }
				</li>
			) ) }
		</ul>
	);
}

/**
 * The sentences reporting how many participants were added and skipped.
 *
 * @param {number} added   Participants added to the group.
 * @param {number} skipped Participants that were already in the group.
 * @return {Array<string>} One sentence per non-zero count.
 */
export function describeOutcome( added, skipped ) {
	const sentences = [];
	if ( added > 0 ) {
		sentences.push(
			sprintf(
				/* translators: %d: number of participants */
				_n(
					'%d participant was added to the group.',
					'%d participants were added to the group.',
					added,
					'fair-form'
				),
				added
			)
		);
	}
	if ( skipped > 0 ) {
		sentences.push(
			sprintf(
				/* translators: %d: number of participants */
				_n(
					'%d participant was already in the group and was skipped.',
					'%d participants were already in the group and were skipped.',
					skipped,
					'fair-form'
				),
				skipped
			)
		);
	}
	return sentences;
}

/**
 * @typedef {Object} GroupOutcome
 * @property {string} groupName Group the participants went to, empty when none was used.
 * @property {number} added     Participants added to the group.
 * @property {number} skipped   Participants already in the group.
 * @property {number} failed    Participants still not added when the popup closed.
 */

/**
 * @param {Object}                    props
 * @param {Array}                     props.participants   Unique participants to add, snapshotted when the popup opened.
 * @param {number}                    props.unlinkedCount  Responses without a participant link, left out.
 * @param {number}                    props.duplicateCount Further responses of a participant already listed, counted once.
 * @param {(o: GroupOutcome) => void} props.onClose        Called when the popup closes; counts are zero when nothing was attempted.
 * @return {Element} Popup.
 */
export default function AddToGroupModal( {
	participants,
	unlinkedCount,
	duplicateCount,
	onClose,
} ) {
	const [ groups, setGroups ] = useState( [] );
	const [ groupsStatus, setGroupsStatus ] = useState( 'loading' );
	const [ groupMode, setGroupMode ] = useState( 'existing' );
	const [ selectedGroupId, setSelectedGroupId ] = useState( '' );
	const [ newGroupName, setNewGroupName ] = useState( '' );
	const [ newGroupDescription, setNewGroupDescription ] = useState( '' );

	// The participants still to add, each with why its last attempt failed.
	const [ items, setItems ] = useState( () =>
		participants.map( ( participant ) => ( { participant, error: null } ) )
	);
	// Everyone already handled, each noted as added or skipped.
	const [ done, setDone ] = useState( [] );
	// The group the participants go to, fixed once assignment has started.
	const [ target, setTarget ] = useState( null );
	const [ groupError, setGroupError ] = useState( null );
	const [ isSubmitting, setIsSubmitting ] = useState( false );
	// Refuses a second submission, or a dismissal, before the re-render.
	const inFlight = useRef( false );

	const loadGroups = () => {
		setGroupsStatus( 'loading' );
		apiFetch( { path: '/fair-audience/v1/groups?orderby=name&order=asc' } )
			.then( ( data ) => {
				setGroups( Array.isArray( data ) ? data : [] );
				setGroupsStatus( 'ready' );
			} )
			.catch( () => setGroupsStatus( 'error' ) );
	};

	useEffect( loadGroups, [] );

	const identified = useMemo( () => {
		const all = identifyParticipants( participants );
		return new Map( all.map( ( person ) => [ person.id, person ] ) );
	}, [ participants ] );

	const people = items.map( ( item ) => ( {
		...identified.get( item.participant.id ),
		note: item.error,
	} ) );
	const failedPeople = people.filter( ( person ) => person.note );
	const doneNotes = {
		added: __( 'Added', 'fair-form' ),
		skipped: __( 'Already in the group — skipped', 'fair-form' ),
	};
	const donePeople = done.map( ( entry ) => ( {
		...identified.get( entry.id ),
		note: doneNotes[ entry.outcome ],
	} ) );
	const addedCount = done.filter( ( e ) => e.outcome === 'added' ).length;
	const skippedCount = done.length - addedCount;

	const selectedGroup = groups.find(
		( group ) => String( group.id ) === selectedGroupId
	);

	let blockedReason = null;
	if ( ! target ) {
		if ( groupMode === 'existing' && ! selectedGroup ) {
			blockedReason = __(
				'Select a group to add the participants to.',
				'fair-form'
			);
		} else if ( groupMode === 'new' && ! clean( newGroupName ) ) {
			blockedReason = __(
				'Enter a name for the new group.',
				'fair-form'
			);
		}
	}

	const resolveTarget = async () => {
		if ( target ) {
			return target;
		}
		if ( groupMode === 'existing' ) {
			return { id: selectedGroup.id, name: selectedGroup.name };
		}
		const group = await apiFetch( {
			path: '/fair-audience/v1/groups',
			method: 'POST',
			data: {
				name: clean( newGroupName ),
				description: clean( newGroupDescription ),
			},
		} );
		return { id: group.id, name: group.name || clean( newGroupName ) };
	};

	const submit = async () => {
		if ( inFlight.current || blockedReason || items.length === 0 ) {
			return;
		}
		inFlight.current = true;
		setIsSubmitting( true );
		setGroupError( null );

		let group;
		try {
			group = await resolveTarget();
		} catch ( err ) {
			setGroupError(
				err?.message ||
					__(
						'The group could not be created. Try again.',
						'fair-form'
					)
			);
			inFlight.current = false;
			setIsSubmitting( false );
			return;
		}
		// Kept before any participant is added, so a retry reuses it.
		setTarget( group );

		const outcomes = await Promise.all(
			items.map( ( { participant } ) =>
				apiFetch( {
					path: `/fair-audience/v1/groups/${ group.id }/participants`,
					method: 'POST',
					data: { participant_id: participant.id },
				} )
					.then( () => ( { participant, outcome: 'added' } ) )
					.catch( ( err ) =>
						err?.code === 'already_member'
							? { participant, outcome: 'skipped' }
							: {
									participant,
									outcome: 'failed',
									error:
										err?.message ||
										__(
											'The participant could not be added to the group.',
											'fair-form'
										),
								}
					)
			)
		);

		const handled = outcomes
			.filter( ( o ) => o.outcome !== 'failed' )
			.map( ( o ) => ( { id: o.participant.id, outcome: o.outcome } ) );
		const remaining = outcomes
			.filter( ( o ) => o.outcome === 'failed' )
			.map( ( o ) => ( { participant: o.participant, error: o.error } ) );
		const allDone = [ ...done, ...handled ];

		inFlight.current = false;
		if ( remaining.length === 0 ) {
			const added = allDone.filter( ( e ) => e.outcome === 'added' );
			onClose( {
				groupName: group.name,
				added: added.length,
				skipped: allDone.length - added.length,
				failed: 0,
			} );
			return;
		}

		setDone( allDone );
		setItems( remaining );
		setIsSubmitting( false );
	};

	const close = () => {
		if ( inFlight.current ) {
			return;
		}
		onClose( {
			groupName: target?.name || '',
			added: addedCount,
			skipped: skippedCount,
			failed: done.length > 0 ? items.length : 0,
		} );
	};

	const outcomeSentences = describeOutcome( addedCount, skippedCount );
	const isTargetLocked = Boolean( target ) || isSubmitting;

	let submitLabel = __( 'Add to group', 'fair-form' );
	if ( isSubmitting ) {
		submitLabel = __( 'Adding…', 'fair-form' );
	} else if ( failedPeople.length > 0 ) {
		submitLabel = sprintf(
			/* translators: %d: number of participants */
			_n(
				'Try again for %d participant',
				'Try again for %d participants',
				failedPeople.length,
				'fair-form'
			),
			failedPeople.length
		);
	} else if ( ! target && groupMode === 'new' ) {
		submitLabel = __( 'Create group and add', 'fair-form' );
	}

	return (
		<Modal
			title={ __( 'Add participants to group', 'fair-form' ) }
			onRequestClose={ close }
			isDismissible={ ! isSubmitting }
			shouldCloseOnEsc={ ! isSubmitting }
			shouldCloseOnClickOutside={ ! isSubmitting }
			className="fair-form-group-modal"
			style={ MODAL_STYLE }
		>
			<div className="fair-form-group-modal__body">
				{ outcomeSentences.length > 0 && (
					<Notice status="success" isDismissible={ false }>
						{ outcomeSentences.map( ( sentence ) => (
							<p key={ sentence }>{ sentence }</p>
						) ) }
						<ParticipantList
							label={ __(
								'Participants already handled',
								'fair-form'
							) }
							people={ donePeople }
						/>
					</Notice>
				) }

				{ failedPeople.length > 0 && (
					<Notice status="error" isDismissible={ false }>
						<p>
							{ sprintf(
								/* translators: %d: number of participants */
								_n(
									'%d participant could not be added. Try again:',
									'%d participants could not be added. Try again:',
									failedPeople.length,
									'fair-form'
								),
								failedPeople.length
							) }
						</p>
						<ParticipantList
							label={ __(
								'Participants that could not be added',
								'fair-form'
							) }
							people={ failedPeople }
						/>
					</Notice>
				) }

				{ groupError && (
					<Notice status="error" isDismissible={ false }>
						{ groupError }
					</Notice>
				) }

				{ failedPeople.length === 0 && (
					<>
						<p>
							{ sprintf(
								/* translators: %d: number of participants */
								_n(
									'%d participant will be added:',
									'%d participants will be added:',
									people.length,
									'fair-form'
								),
								people.length
							) }
						</p>
						<ParticipantList
							label={ __( 'Participants to add', 'fair-form' ) }
							people={ people }
						/>
					</>
				) }

				<p>
					{ __(
						'Everyone who answered this questionnaire is included, regardless of the table’s filters and pages.',
						'fair-form'
					) }{ ' ' }
					{ __(
						'Participants who are already in the group are skipped.',
						'fair-form'
					) }
				</p>
				{ unlinkedCount > 0 && (
					<p>
						{ sprintf(
							/* translators: %d: number of responses */
							_n(
								'%d response is not linked to a participant and is left out.',
								'%d responses are not linked to a participant and are left out.',
								unlinkedCount,
								'fair-form'
							),
							unlinkedCount
						) }
					</p>
				) }
				{ duplicateCount > 0 && (
					<p>
						{ sprintf(
							/* translators: %d: number of responses */
							_n(
								'%d more response comes from a participant listed above; each participant is added once.',
								'%d more responses come from participants listed above; each participant is added once.',
								duplicateCount,
								'fair-form'
							),
							duplicateCount
						) }
					</p>
				) }

				{ target ? (
					<p>
						{ sprintf(
							/* translators: %s: group name */
							__( 'Target group: %s', 'fair-form' ),
							target.name
						) }
					</p>
				) : (
					<>
						<RadioControl
							label={ __( 'Target group', 'fair-form' ) }
							selected={ groupMode }
							options={ [
								{
									label: __(
										'Use existing group',
										'fair-form'
									),
									value: 'existing',
								},
								{
									label: __(
										'Create new group',
										'fair-form'
									),
									value: 'new',
								},
							] }
							onChange={ setGroupMode }
							disabled={ isTargetLocked }
						/>

						{ groupMode === 'existing' &&
							groupsStatus === 'error' && (
								<Notice
									status="error"
									isDismissible={ false }
									actions={ [
										{
											label: __(
												'Try again',
												'fair-form'
											),
											onClick: loadGroups,
										},
									] }
								>
									{ __(
										'The groups could not be loaded.',
										'fair-form'
									) }
								</Notice>
							) }

						{ groupMode === 'existing' &&
							groupsStatus !== 'error' && (
								<SelectControl
									label={ __( 'Group', 'fair-form' ) }
									value={ selectedGroupId }
									onChange={ setSelectedGroupId }
									options={ [
										{
											label:
												groupsStatus === 'loading'
													? __(
															'Loading…',
															'fair-form'
														)
													: __(
															'— Select a group —',
															'fair-form'
														),
											value: '',
										},
										...groups.map( ( group ) => ( {
											label: sprintf(
												/* translators: 1: group name, 2: number of members */
												__(
													'%1$s (%2$d)',
													'fair-form'
												),
												group.name,
												group.member_count
											),
											value: String( group.id ),
										} ) ),
									] }
									disabled={
										groupsStatus === 'loading' ||
										isTargetLocked
									}
								/>
							) }

						{ groupMode === 'new' && (
							<>
								<TextControl
									label={ __( 'Name', 'fair-form' ) }
									value={ newGroupName }
									onChange={ setNewGroupName }
									disabled={ isTargetLocked }
								/>
								<TextareaControl
									label={ __(
										'Description (optional)',
										'fair-form'
									) }
									value={ newGroupDescription }
									onChange={ setNewGroupDescription }
									disabled={ isTargetLocked }
								/>
							</>
						) }
					</>
				) }

				{ blockedReason && (
					<p
						className="fair-form-group-modal__hint"
						id="fair-form-group-modal-hint"
					>
						{ blockedReason }
					</p>
				) }

				<div className="fair-form-group-modal__buttons">
					<Button
						variant="secondary"
						onClick={ close }
						disabled={ isSubmitting }
					>
						{ __( 'Cancel', 'fair-form' ) }
					</Button>
					<Button
						variant="primary"
						onClick={ submit }
						isBusy={ isSubmitting }
						disabled={ isSubmitting || Boolean( blockedReason ) }
						accessibleWhenDisabled
						aria-describedby={
							blockedReason
								? 'fair-form-group-modal-hint'
								: undefined
						}
					>
						{ submitLabel }
					</Button>
				</div>
			</div>
		</Modal>
	);
}
