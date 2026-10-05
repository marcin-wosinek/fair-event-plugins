/**
 * Move, cancel and delete one ticket, from the Audience tab.
 *
 * Each popup names the ticket, its purchaser and its assignee, and says what
 * the action does to the payment before anything is changed. Only the named
 * ticket is affected: the purchase, its payment and its other tickets stay.
 *
 * @package FairAudience
 */

import { useState } from '@wordpress/element';
import {
	Button,
	Modal,
	Notice,
	SelectControl,
	TextareaControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { ticketLabel } from './ticketLabels.js';
import { personLabel } from './AssignTicketModal.js';

/**
 * Who a ticket was bought by and who holds it.
 *
 * @param {Object} props
 * @param {Object} props.ticket Ticket from the participants endpoint.
 * @return {Element} Definition list.
 */
function TicketPeople( { ticket } ) {
	return (
		<dl className="fair-audience-assign-ticket__people">
			<dt>{ __( 'Purchaser', 'fair-audience' ) }</dt>
			<dd>{ personLabel( ticket.purchaser ) }</dd>
			<dt>{ __( 'Assignee', 'fair-audience' ) }</dt>
			<dd>{ personLabel( ticket.assignee ) }</dd>
		</dl>
	);
}

/**
 * Shared state of a popup that sends one request and reports its error.
 *
 * @param {Function} request Returns the request's promise.
 * @param {Function} onDone  Called with the response.
 * @return {Object} isSaving, error, submit.
 */
function useTicketRequest( request, onDone ) {
	const [ isSaving, setIsSaving ] = useState( false );
	const [ error, setError ] = useState( null );

	const submit = async () => {
		setIsSaving( true );
		setError( null );
		try {
			onDone( await request() );
		} catch ( err ) {
			setError( err );
			setIsSaving( false );
		}
	};

	return { isSaving, error, submit };
}

/**
 * Move one ticket to another date of the recurring event.
 *
 * @param {Object}   props
 * @param {number}   props.eventDateId Event date the ticket is on.
 * @param {Object}   props.ticket      Ticket from the participants endpoint.
 * @param {number}   props.position    Number of the ticket within its purchase.
 * @param {Array}    props.occurrences The other dates: `{ id, label }`.
 * @param {Function} props.onClose     Close without moving.
 * @param {Function} props.onMoved     Called with the moved ticket and its new date's label.
 * @return {Element} Popup.
 */
export function MoveTicketModal( {
	eventDateId,
	ticket,
	position,
	occurrences,
	onClose,
	onMoved,
} ) {
	const [ targetId, setTargetId ] = useState(
		occurrences.length > 0 ? String( occurrences[ 0 ].id ) : ''
	);
	const [ reason, setReason ] = useState( '' );
	// Set once the server refused the move for going over a limit: the
	// move then needs a reason.
	const [ overCapacity, setOverCapacity ] = useState( null );

	const { isSaving, error, submit } = useTicketRequest(
		() =>
			apiFetch( {
				path: `/fair-audience/v1/event-dates/${ eventDateId }/tickets/${ ticket.id }/move`,
				method: 'POST',
				data: {
					target_event_date_id: Number( targetId ),
					...( overCapacity
						? { override_reason: reason.trim() }
						: {} ),
				},
			} ).catch( ( err ) => {
				if ( err.code === 'capacity_exceeded' ) {
					setOverCapacity(
						err.data?.projections || [ err.data?.projection ]
					);
				}
				throw err;
			} ),
		( moved ) =>
			onMoved(
				moved,
				occurrences.find( ( o ) => String( o.id ) === targetId )
					?.label || ''
			)
	);

	const needsReason = !! overCapacity && reason.trim() === '';
	let disabledReason = null;
	if ( ! targetId ) {
		disabledReason = __( 'Choose a date to move to.', 'fair-audience' );
	} else if ( needsReason ) {
		disabledReason = __(
			'Enter a reason to move over capacity.',
			'fair-audience'
		);
	}

	let moveLabel = __( 'Move ticket', 'fair-audience' );
	if ( isSaving ) {
		moveLabel = __( 'Moving…', 'fair-audience' );
	} else if ( overCapacity ) {
		moveLabel = __( 'Move over capacity', 'fair-audience' );
	}

	return (
		<Modal
			title={ sprintf(
				/* translators: %s: ticket label, e.g. "Ticket 1 — Regular (AB12CD34)" */
				__( 'Move ticket — %s', 'fair-audience' ),
				ticketLabel( ticket, position )
			) }
			onRequestClose={ onClose }
			style={ { maxWidth: '560px', width: '100%' } }
		>
			<VStack spacing={ 4 }>
				<TicketPeople ticket={ ticket } />

				<p className="fair-audience-assign-ticket__note">
					{ __(
						'Only this ticket moves. It keeps its type, activities, answers, check-in, purchaser and assignee. The purchase, its payment and its other tickets stay on their dates: nothing is charged or refunded.',
						'fair-audience'
					) }
				</p>

				{ error && (
					<Notice status="error" isDismissible={ false }>
						{ error.message ||
							__(
								'Failed to move the ticket.',
								'fair-audience'
							) }
					</Notice>
				) }

				<SelectControl
					label={ __( 'Move to date', 'fair-audience' ) }
					value={ targetId }
					options={ occurrences.map( ( o ) => ( {
						label: o.label,
						value: String( o.id ),
					} ) ) }
					onChange={ ( value ) => {
						setTargetId( value );
						setOverCapacity( null );
					} }
					__nextHasNoMarginBottom
					__next40pxDefaultSize
				/>

				{ overCapacity && (
					<TextareaControl
						label={ __(
							'Reason for going over capacity',
							'fair-audience'
						) }
						help={ __(
							'Saved with the move in the capacity override record.',
							'fair-audience'
						) }
						value={ reason }
						onChange={ setReason }
						rows={ 2 }
						__nextHasNoMarginBottom
					/>
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
						{ __( 'Keep on this date', 'fair-audience' ) }
					</Button>
					<Button
						variant="primary"
						onClick={ submit }
						isBusy={ isSaving }
						disabled={ !! disabledReason || isSaving }
					>
						{ moveLabel }
					</Button>
				</HStack>
			</VStack>
		</Modal>
	);
}

/**
 * Cancel one ticket, after saying what happens to its payment.
 *
 * @param {Object}   props
 * @param {number}   props.eventDateId Event date the ticket is on.
 * @param {Object}   props.ticket      Ticket from the participants endpoint.
 * @param {number}   props.position    Number of the ticket within its purchase.
 * @param {Function} props.onClose     Close without cancelling.
 * @param {Function} props.onCancelled Called with the cancelled ticket.
 * @return {Element} Popup.
 */
export function CancelTicketModal( {
	eventDateId,
	ticket,
	position,
	onClose,
	onCancelled,
} ) {
	const { isSaving, error, submit } = useTicketRequest(
		() =>
			apiFetch( {
				path: `/fair-audience/v1/event-dates/${ eventDateId }/tickets/${ ticket.id }/cancel`,
				method: 'POST',
			} ),
		onCancelled
	);

	return (
		<Modal
			title={ sprintf(
				/* translators: %s: ticket label, e.g. "Ticket 1 — Regular (AB12CD34)" */
				__( 'Cancel ticket — %s', 'fair-audience' ),
				ticketLabel( ticket, position )
			) }
			onRequestClose={ onClose }
			style={ { maxWidth: '560px', width: '100%' } }
		>
			<VStack spacing={ 4 }>
				<TicketPeople ticket={ ticket } />

				<Notice status="warning" isDismissible={ false }>
					{ ticket.status === 'confirmed'
						? __(
								'Cancelling does not refund anything. The payment for this purchase stays as it is; if a refund is due, make it separately with your payment provider.',
								'fair-audience'
						  )
						: __(
								'This ticket is awaiting payment. Cancelling does not change the amount: if the purchaser completes the payment, they pay for the whole purchase and nothing is refunded automatically.',
								'fair-audience'
						  ) }
				</Notice>

				<p style={ { margin: 0 } }>
					{ __(
						'Only this ticket is cancelled. It no longer admits its assignee, and its place and activities become available again. The purchase’s other tickets are not changed, and the participant stays in the audience. A cancelled ticket cannot be reactivated.',
						'fair-audience'
					) }
				</p>

				{ error && (
					<Notice status="error" isDismissible={ false }>
						{ error.message ||
							__(
								'Failed to cancel the ticket.',
								'fair-audience'
							) }
					</Notice>
				) }

				<HStack spacing={ 3 } justify="flex-end" wrap>
					<Button
						variant="secondary"
						onClick={ onClose }
						disabled={ isSaving }
					>
						{ __( 'Keep ticket', 'fair-audience' ) }
					</Button>
					<Button
						variant="primary"
						isDestructive
						onClick={ submit }
						isBusy={ isSaving }
						disabled={ isSaving }
					>
						{ isSaving
							? __( 'Cancelling…', 'fair-audience' )
							: __( 'Cancel ticket', 'fair-audience' ) }
					</Button>
				</HStack>
			</VStack>
		</Modal>
	);
}

/**
 * Delete one cancelled ticket from the audience.
 *
 * @param {Object}   props
 * @param {number}   props.eventDateId Event date the ticket is on.
 * @param {Object}   props.ticket      Ticket from the participants endpoint.
 * @param {number}   props.position    Number of the ticket within its purchase.
 * @param {Function} props.onClose     Close without deleting.
 * @param {Function} props.onDeleted   Called once the ticket is deleted.
 * @return {Element} Popup.
 */
export function DeleteTicketModal( {
	eventDateId,
	ticket,
	position,
	onClose,
	onDeleted,
} ) {
	const { isSaving, error, submit } = useTicketRequest(
		() =>
			apiFetch( {
				path: `/fair-audience/v1/event-dates/${ eventDateId }/tickets/${ ticket.id }`,
				method: 'DELETE',
			} ),
		onDeleted
	);

	return (
		<Modal
			title={ sprintf(
				/* translators: %s: ticket label, e.g. "Ticket 1 — Regular (AB12CD34)" */
				__( 'Delete ticket — %s', 'fair-audience' ),
				ticketLabel( ticket, position )
			) }
			onRequestClose={ onClose }
			style={ { maxWidth: '560px', width: '100%' } }
		>
			<VStack spacing={ 4 }>
				<TicketPeople ticket={ ticket } />

				<Notice status="warning" isDismissible={ false }>
					{ __(
						'Deleting does not refund anything and does not change the payment. The purchase and its amounts are kept in the payment records.',
						'fair-audience'
					) }
				</Notice>

				<p style={ { margin: 0 } }>
					{ __(
						'Only this cancelled ticket is removed from the audience, its search and its exports. The purchase’s other tickets are not changed, and the participant stays in the audience. This cannot be undone.',
						'fair-audience'
					) }
				</p>

				{ error && (
					<Notice status="error" isDismissible={ false }>
						{ error.message ||
							__(
								'Failed to delete the ticket.',
								'fair-audience'
							) }
					</Notice>
				) }

				<HStack spacing={ 3 } justify="flex-end" wrap>
					<Button
						variant="secondary"
						onClick={ onClose }
						disabled={ isSaving }
					>
						{ __( 'Keep ticket', 'fair-audience' ) }
					</Button>
					<Button
						variant="primary"
						isDestructive
						onClick={ submit }
						isBusy={ isSaving }
						disabled={ isSaving }
					>
						{ isSaving
							? __( 'Deleting…', 'fair-audience' )
							: __( 'Delete ticket', 'fair-audience' ) }
					</Button>
				</HStack>
			</VStack>
		</Modal>
	);
}
