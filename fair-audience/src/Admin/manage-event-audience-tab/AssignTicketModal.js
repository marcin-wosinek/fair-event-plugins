/**
 * Change one ticket's holder, from the Audience tab (#1535, #2133).
 *
 * The purchaser keeps the purchase and its payment; only who holds the
 * ticket changes. The new holder is an existing participant or one created
 * here in the same step. The change is reviewed before it is saved, and the
 * holder seen at review is sent along, so a change someone else made
 * meanwhile is refused instead of overwritten.
 *
 * @package FairAudience
 */

import { useState, useEffect, useMemo, useRef } from '@wordpress/element';
import {
	Button,
	Modal,
	Notice,
	RadioControl,
	Spinner,
	TextControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { ticketLabel } from './ticketLabels.js';

// Matches shown at once; searching narrows a longer list.
const MAX_MATCHES = 50;

/**
 * A purchaser's or holder's name with their email, as text.
 *
 * @param {Object} person Purchaser or holder from a ticket response.
 * @return {string} Label.
 */
export const personLabel = ( person ) => {
	const name = person?.name || '';
	const email = person?.email || '';
	if ( name && email ) {
		return sprintf(
			/* translators: 1: person's name, 2: their email address */
			__( '%1$s (%2$s)', 'fair-audience' ),
			name,
			email
		);
	}
	return name || email || __( '—', 'fair-audience' );
};

/**
 * A participant from the directory, shaped like a ticket's person.
 *
 * @param {Object} participant Participant from the participants endpoint.
 * @return {Object} participant_id, name, email.
 */
const directoryPerson = ( participant ) => ( {
	participant_id: participant.id,
	name: `${ participant.name || '' } ${ participant.surname || '' }`.trim(),
	email: participant.email || '',
} );

export default function AssignTicketModal( {
	eventDateId,
	ticket: initialTicket,
	position,
	audienceParticipantIds = [],
	onClose,
	onAssigned,
	onRefresh = () => {},
} ) {
	// Replaced by the ticket as it is now when someone else changed it.
	const [ ticket, setTicket ] = useState( initialTicket );
	const purchaserId = ticket.purchaser?.participant_id ?? null;
	const holderId = ticket.assignee?.participant_id ?? null;
	const isCheckedIn = !! ticket.attended_at;

	const [ step, setStep ] = useState( 'choose' );
	const [ mode, setMode ] = useState( 'existing' );
	const [ participants, setParticipants ] = useState( [] );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ search, setSearch ] = useState( '' );
	// The chosen existing participant, as a ticket person.
	const [ selected, setSelected ] = useState( null );
	const [ name, setName ] = useState( '' );
	const [ surname, setSurname ] = useState( '' );
	const [ email, setEmail ] = useState( '' );
	const [ isSaving, setIsSaving ] = useState( false );
	// { message, participant? }: participant is the existing identity an
	// email conflict names.
	const [ error, setError ] = useState( null );
	// Refuses a second submission before the first one re-rendered.
	const inFlight = useRef( false );

	useEffect( () => {
		apiFetch( { path: '/fair-audience/v1/participants?per_page=0' } )
			.then( ( data ) =>
				setParticipants( Array.isArray( data ) ? data : [] )
			)
			.catch( () => setParticipants( [] ) )
			.finally( () => setIsLoading( false ) );
	}, [] );

	// Everyone but the current holder: the purchaser first, then people
	// already in this event's audience, then everyone else.
	const matches = useMemo( () => {
		const term = search.trim().toLowerCase();
		const rank = ( p ) => {
			if ( p.id === purchaserId ) return 0;
			return audienceParticipantIds.includes( p.id ) ? 1 : 2;
		};
		return participants
			.filter( ( p ) => p.id !== holderId )
			.filter(
				( p ) =>
					! term ||
					`${ p.name || '' } ${ p.surname || '' }`
						.toLowerCase()
						.includes( term ) ||
					( p.email || '' ).toLowerCase().includes( term )
			)
			.sort(
				( a, b ) =>
					rank( a ) - rank( b ) ||
					`${ a.name || '' } ${ a.surname || '' }`.localeCompare(
						`${ b.name || '' } ${ b.surname || '' }`
					)
			);
	}, [
		participants,
		search,
		holderId,
		purchaserId,
		audienceParticipantIds,
	] );

	const shownMatches = matches.slice( 0, MAX_MATCHES );

	// An existing participant already using the email typed for a new one:
	// they are offered instead, and their profile is never changed.
	const emailOwner = useMemo( () => {
		const typed = email.trim().toLowerCase();
		if ( mode !== 'new' || ! typed ) {
			return null;
		}
		const owner = participants.find(
			( p ) => ( p.email || '' ).toLowerCase() === typed
		);
		return owner ? directoryPerson( owner ) : null;
	}, [ mode, email, participants ] );

	const newHolder =
		mode === 'existing'
			? selected
			: {
					participant_id: null,
					name: `${ name.trim() } ${ surname.trim() }`.trim(),
					email: email.trim(),
				};

	let disabledReason = null;
	if ( isCheckedIn ) {
		disabledReason = __(
			'Clear the check-in to change this ticket’s holder.',
			'fair-audience'
		);
	} else if ( mode === 'existing' && ! selected ) {
		disabledReason = __( 'Choose a participant.', 'fair-audience' );
	} else if ( mode === 'existing' && selected.participant_id === holderId ) {
		disabledReason = __(
			'They already hold this ticket.',
			'fair-audience'
		);
	} else if ( mode === 'new' && ! name.trim() ) {
		disabledReason = __( 'Enter a name.', 'fair-audience' );
	} else if ( mode === 'new' && ! email.trim() ) {
		disabledReason = __( 'Enter an email address.', 'fair-audience' );
	} else if ( mode === 'new' && emailOwner ) {
		disabledReason = __(
			'Select the existing participant or enter another email.',
			'fair-audience'
		);
	}

	const handleSelectExisting = ( person ) => {
		setMode( 'existing' );
		setSearch( person.email || person.name || '' );
		setSelected( person );
		setError( null );
	};

	const close = () => {
		if ( ! isSaving ) {
			onClose();
		}
	};

	const handleConfirm = async () => {
		if ( disabledReason || inFlight.current ) return;
		inFlight.current = true;
		setIsSaving( true );
		setError( null );
		try {
			const updated = await apiFetch( {
				path: `/fair-audience/v1/event-dates/${ eventDateId }/tickets/${ ticket.id }/assign`,
				method: 'POST',
				data: {
					...( mode === 'existing'
						? { participant_id: selected.participant_id }
						: {
								participant: {
									name: name.trim(),
									surname: surname.trim(),
									email: email.trim(),
								},
							} ),
					expected_holder_participant_id: holderId ?? 0,
				},
			} );
			onAssigned( updated );
		} catch ( err ) {
			if ( err.code === 'ticket_holder_changed' && err.data?.ticket ) {
				// Review again against the holder it has now.
				setTicket( { ...ticket, ...err.data.ticket } );
				onRefresh();
			}
			if ( err.code === 'email_exists' ) {
				setStep( 'choose' );
			}
			setError( {
				message:
					err.message ||
					__(
						'Failed to change the ticket holder. Try again.',
						'fair-audience'
					),
				participant: err.data?.participant || null,
			} );
		} finally {
			inFlight.current = false;
			setIsSaving( false );
		}
	};

	const people = (
		<dl className="fair-audience-assign-ticket__people">
			<dt>{ __( 'Ticket holder', 'fair-audience' ) }</dt>
			<dd>{ personLabel( ticket.assignee ) }</dd>
			<dt>{ __( 'Purchased by', 'fair-audience' ) }</dt>
			<dd>{ personLabel( ticket.purchaser ) }</dd>
		</dl>
	);

	const errorNotice = error && (
		<Notice status="error" isDismissible={ false }>
			{ error.message }
			{ error.participant && (
				<>
					{ ' ' }
					<Button
						variant="link"
						onClick={ () =>
							handleSelectExisting( error.participant )
						}
					>
						{ sprintf(
							/* translators: %s: existing participant's name and email */
							__( 'Select %s', 'fair-audience' ),
							personLabel( error.participant )
						) }
					</Button>
				</>
			) }
		</Notice>
	);

	const renderChoose = () => (
		<VStack spacing={ 4 }>
			{ people }

			{ isCheckedIn && (
				<Notice status="warning" isDismissible={ false }>
					{ __(
						'This ticket is checked in. Clear the check-in before giving the ticket to someone else.',
						'fair-audience'
					) }
				</Notice>
			) }

			{ errorNotice }

			<RadioControl
				label={ __( 'New ticket holder', 'fair-audience' ) }
				selected={ mode }
				options={ [
					{
						label: __( 'An existing participant', 'fair-audience' ),
						value: 'existing',
					},
					{
						label: __( 'A new participant', 'fair-audience' ),
						value: 'new',
					},
				] }
				onChange={ ( value ) => {
					setMode( value );
					setError( null );
				} }
			/>

			{ mode === 'existing' && (
				<VStack spacing={ 2 }>
					<TextControl
						label={ __(
							'Search by name or email',
							'fair-audience'
						) }
						value={ search }
						onChange={ setSearch }
						__nextHasNoMarginBottom
						__next40pxDefaultSize
					/>
					{ isLoading && <Spinner /> }
					{ ! isLoading && shownMatches.length === 0 && (
						<p className="fair-audience-assign-ticket__note">
							{ __(
								'No participants match your search.',
								'fair-audience'
							) }
						</p>
					) }
					{ ! isLoading && shownMatches.length > 0 && (
						<ul
							className="fair-audience-assign-ticket__matches"
							aria-label={ __( 'Participants', 'fair-audience' ) }
						>
							{ shownMatches.map( ( p ) => (
								<li key={ p.id }>
									<label>
										<input
											type="radio"
											name="fair-audience-assign-ticket"
											checked={
												selected?.participant_id ===
												p.id
											}
											onChange={ () =>
												setSelected(
													directoryPerson( p )
												)
											}
										/>
										<span>
											{ personLabel(
												directoryPerson( p )
											) }
											{ p.id === purchaserId && (
												<span className="fair-audience-audience-table__badge">
													{ __(
														'Purchaser',
														'fair-audience'
													) }
												</span>
											) }
										</span>
									</label>
								</li>
							) ) }
						</ul>
					) }
					{ matches.length > MAX_MATCHES && (
						<p className="fair-audience-assign-ticket__note">
							{ sprintf(
								/* translators: 1: number of participants shown, 2: number of participants matching */
								__(
									'Showing %1$d of %2$d. Search to narrow the list.',
									'fair-audience'
								),
								MAX_MATCHES,
								matches.length
							) }
						</p>
					) }
				</VStack>
			) }

			{ mode === 'new' && (
				<VStack spacing={ 3 }>
					<TextControl
						label={ __( 'Name', 'fair-audience' ) }
						value={ name }
						onChange={ setName }
						__nextHasNoMarginBottom
						__next40pxDefaultSize
					/>
					<TextControl
						label={ __( 'Surname', 'fair-audience' ) }
						value={ surname }
						onChange={ setSurname }
						__nextHasNoMarginBottom
						__next40pxDefaultSize
					/>
					<TextControl
						label={ __( 'Email', 'fair-audience' ) }
						type="email"
						value={ email }
						onChange={ setEmail }
						help={ __(
							'They are added to the audience without a marketing subscription.',
							'fair-audience'
						) }
						__nextHasNoMarginBottom
						__next40pxDefaultSize
					/>
					{ emailOwner && (
						<Notice status="warning" isDismissible={ false }>
							{ emailOwner.participant_id === holderId
								? sprintf(
										/* translators: %s: existing participant's name and email */
										__(
											'This email belongs to %s, who already holds this ticket.',
											'fair-audience'
										),
										personLabel( emailOwner )
									)
								: sprintf(
										/* translators: %s: existing participant's name and email */
										__(
											'This email belongs to %s. Select them instead: their details stay as they are.',
											'fair-audience'
										),
										personLabel( emailOwner )
									) }
							{ emailOwner.participant_id !== holderId && (
								<>
									{ ' ' }
									<Button
										variant="link"
										onClick={ () =>
											handleSelectExisting( emailOwner )
										}
									>
										{ sprintf(
											/* translators: %s: existing participant's name and email */
											__( 'Select %s', 'fair-audience' ),
											personLabel( emailOwner )
										) }
									</Button>
								</>
							) }
						</Notice>
					) }
				</VStack>
			) }

			<HStack spacing={ 3 } justify="flex-end" wrap>
				{ disabledReason && (
					<span className="fair-audience-assign-ticket__note">
						{ disabledReason }
					</span>
				) }
				<Button variant="secondary" onClick={ close }>
					{ __( 'Cancel', 'fair-audience' ) }
				</Button>
				<Button
					variant="primary"
					onClick={ () => {
						setError( null );
						setStep( 'review' );
					} }
					disabled={ !! disabledReason }
				>
					{ __( 'Review change', 'fair-audience' ) }
				</Button>
			</HStack>
		</VStack>
	);

	const renderReview = () => (
		<VStack spacing={ 4 }>
			<dl className="fair-audience-assign-ticket__people">
				<dt>{ __( 'Ticket', 'fair-audience' ) }</dt>
				<dd>{ ticketLabel( ticket, position ) }</dd>
				<dt>{ __( 'Current holder', 'fair-audience' ) }</dt>
				<dd>{ personLabel( ticket.assignee ) }</dd>
				<dt>{ __( 'New holder', 'fair-audience' ) }</dt>
				<dd>
					{ mode === 'new'
						? sprintf(
								/* translators: %s: new participant's name and email */
								__( '%s — new participant', 'fair-audience' ),
								personLabel( newHolder )
							)
						: personLabel( newHolder ) }
				</dd>
				<dt>{ __( 'Purchased by', 'fair-audience' ) }</dt>
				<dd>{ personLabel( ticket.purchaser ) }</dd>
			</dl>

			<p className="fair-audience-assign-ticket__note">
				{ __(
					'The payment stays with the purchaser. Only this ticket and its activities go to the new holder: the purchase, its payment and its other tickets don’t change, and the purchaser keeps receiving the confirmation and refund messages.',
					'fair-audience'
				) }
			</p>

			{ errorNotice }

			<HStack spacing={ 3 } justify="flex-end" wrap>
				{ disabledReason && ! isSaving && (
					<span className="fair-audience-assign-ticket__note">
						{ disabledReason }
					</span>
				) }
				<Button
					variant="tertiary"
					onClick={ () => {
						setError( null );
						setStep( 'choose' );
					} }
					disabled={ isSaving }
				>
					{ __( 'Back', 'fair-audience' ) }
				</Button>
				<Button
					variant="secondary"
					onClick={ close }
					disabled={ isSaving }
				>
					{ __( 'Cancel', 'fair-audience' ) }
				</Button>
				<Button
					variant="primary"
					onClick={ handleConfirm }
					isBusy={ isSaving }
					disabled={ !! disabledReason || isSaving }
					accessibleWhenDisabled={ isSaving }
				>
					{ isSaving
						? __( 'Changing…', 'fair-audience' )
						: __( 'Change ticket holder', 'fair-audience' ) }
				</Button>
			</HStack>
		</VStack>
	);

	return (
		<Modal
			title={ sprintf(
				/* translators: %s: ticket label, e.g. "Ticket 1 — Regular (AB12CD34)" */
				__( 'Change ticket holder — %s', 'fair-audience' ),
				ticketLabel( ticket, position )
			) }
			onRequestClose={ close }
			isDismissible={ ! isSaving }
			shouldCloseOnEsc={ ! isSaving }
			shouldCloseOnClickOutside={ ! isSaving }
			style={ { maxWidth: '560px', width: '100%' } }
		>
			{ step === 'review' ? renderReview() : renderChoose() }
		</Modal>
	);
}
