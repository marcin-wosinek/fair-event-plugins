/**
 * Assign one ticket to another participant, from the Audience tab.
 *
 * The purchaser keeps the purchase and its payment; only who holds the
 * ticket changes. The new holder is an existing participant or one created
 * here in the same step.
 *
 * @package FairAudience
 */

import { useState, useEffect, useMemo } from '@wordpress/element';
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
 * A purchaser's or assignee's name with their email, as text.
 *
 * @param {Object} person Purchaser or assignee from a ticket response.
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

export default function AssignTicketModal( {
	eventDateId,
	ticket,
	position,
	audienceParticipantIds = [],
	onClose,
	onAssigned,
} ) {
	const purchaserId = ticket.purchaser?.participant_id ?? null;
	const assigneeId = ticket.assignee?.participant_id ?? null;
	const isCheckedIn = !! ticket.attended_at;

	const [ mode, setMode ] = useState( 'existing' );
	const [ participants, setParticipants ] = useState( [] );
	const [ isLoading, setIsLoading ] = useState( true );
	const [ search, setSearch ] = useState( '' );
	const [ selectedId, setSelectedId ] = useState( null );
	const [ name, setName ] = useState( '' );
	const [ surname, setSurname ] = useState( '' );
	const [ email, setEmail ] = useState( '' );
	const [ isSaving, setIsSaving ] = useState( false );
	// { message, participant? }: participant is the existing identity an
	// email conflict names.
	const [ error, setError ] = useState( null );

	useEffect( () => {
		apiFetch( { path: '/fair-audience/v1/participants?per_page=0' } )
			.then( ( data ) =>
				setParticipants( Array.isArray( data ) ? data : [] )
			)
			.catch( () => setParticipants( [] ) )
			.finally( () => setIsLoading( false ) );
	}, [] );

	// Everyone but the current assignee: the purchaser first, then people
	// already in this event's audience, then everyone else.
	const matches = useMemo( () => {
		const term = search.trim().toLowerCase();
		const rank = ( p ) => {
			if ( p.id === purchaserId ) return 0;
			return audienceParticipantIds.includes( p.id ) ? 1 : 2;
		};
		return participants
			.filter( ( p ) => p.id !== assigneeId )
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
		assigneeId,
		purchaserId,
		audienceParticipantIds,
	] );

	const shownMatches = matches.slice( 0, MAX_MATCHES );

	let disabledReason = null;
	if ( isCheckedIn ) {
		disabledReason = __(
			'Clear the check-in to assign this ticket.',
			'fair-audience'
		);
	} else if ( mode === 'existing' && ! selectedId ) {
		disabledReason = __( 'Choose a participant.', 'fair-audience' );
	} else if ( mode === 'new' && ! name.trim() ) {
		disabledReason = __( 'Enter a name.', 'fair-audience' );
	}

	const handleSelectExisting = ( participant ) => {
		setMode( 'existing' );
		setSearch( participant.email || participant.name || '' );
		setSelectedId( participant.participant_id );
		setError( null );
	};

	const handleAssign = async () => {
		if ( disabledReason ) return;
		setIsSaving( true );
		setError( null );
		try {
			const updated = await apiFetch( {
				path: `/fair-audience/v1/event-dates/${ eventDateId }/tickets/${ ticket.id }/assign`,
				method: 'POST',
				data:
					mode === 'existing'
						? { participant_id: selectedId }
						: {
								participant: {
									name: name.trim(),
									surname: surname.trim(),
									email: email.trim(),
								},
						  },
			} );
			onAssigned( updated );
		} catch ( err ) {
			setError( {
				message:
					err.message ||
					__( 'Failed to assign the ticket.', 'fair-audience' ),
				participant: err.data?.participant || null,
			} );
			setIsSaving( false );
		}
	};

	return (
		<Modal
			title={ sprintf(
				/* translators: %s: ticket label, e.g. "Ticket 1 — Regular (AB12CD34)" */
				__( 'Assign ticket — %s', 'fair-audience' ),
				ticketLabel( ticket, position )
			) }
			onRequestClose={ onClose }
			style={ { maxWidth: '560px', width: '100%' } }
		>
			<VStack spacing={ 4 }>
				<dl className="fair-audience-assign-ticket__people">
					<dt>{ __( 'Purchaser', 'fair-audience' ) }</dt>
					<dd>{ personLabel( ticket.purchaser ) }</dd>
					<dt>{ __( 'Current assignee', 'fair-audience' ) }</dt>
					<dd>{ personLabel( ticket.assignee ) }</dd>
				</dl>

				<p className="fair-audience-assign-ticket__note">
					{ __(
						'Only this ticket changes hands. The purchase, its payment and its other tickets stay with the purchaser, who keeps receiving the confirmation and refund messages.',
						'fair-audience'
					) }
				</p>

				{ isCheckedIn && (
					<Notice status="warning" isDismissible={ false }>
						{ __(
							'This ticket is checked in. Clear the check-in before assigning the ticket to someone else.',
							'fair-audience'
						) }
					</Notice>
				) }

				{ error && (
					<Notice status="error" isDismissible={ false }>
						{ error.message }
						{ error.participant && (
							<>
								{ ' ' }
								<Button
									variant="link"
									onClick={ () =>
										handleSelectExisting(
											error.participant
										)
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
				) }

				<RadioControl
					label={ __( 'Assign to', 'fair-audience' ) }
					selected={ mode }
					options={ [
						{
							label: __(
								'An existing participant',
								'fair-audience'
							),
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
								aria-label={ __(
									'Participants',
									'fair-audience'
								) }
							>
								{ shownMatches.map( ( p ) => (
									<li key={ p.id }>
										<label>
											<input
												type="radio"
												name="fair-audience-assign-ticket"
												checked={ selectedId === p.id }
												onChange={ () =>
													setSelectedId( p.id )
												}
											/>
											<span>
												{ personLabel( {
													name: `${ p.name || '' } ${
														p.surname || ''
													}`.trim(),
													email: p.email,
												} ) }
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
							label={ __( 'Email (optional)', 'fair-audience' ) }
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
					</VStack>
				) }

				<HStack spacing={ 3 } justify="flex-end" wrap>
					{ disabledReason && (
						<span className="fair-audience-assign-ticket__note">
							{ disabledReason }
						</span>
					) }
					<Button
						variant="secondary"
						onClick={ onClose }
						disabled={ isSaving }
					>
						{ __( 'Cancel', 'fair-audience' ) }
					</Button>
					<Button
						variant="primary"
						onClick={ handleAssign }
						isBusy={ isSaving }
						disabled={ !! disabledReason || isSaving }
					>
						{ isSaving
							? __( 'Assigning…', 'fair-audience' )
							: __( 'Assign ticket', 'fair-audience' ) }
					</Button>
				</HStack>
			</VStack>
		</Modal>
	);
}
