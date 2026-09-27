import { useState } from '@wordpress/element';
import {
	Button,
	CheckboxControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

const TICKET_STATUS_DISPLAY = {
	confirmed: __( 'Confirmed', 'fair-audience' ),
	pending_payment: __( 'Awaiting payment', 'fair-audience' ),
};

/**
 * Short, human-readable name for one of a participant's tickets.
 *
 * @param {Object} ticket   Ticket from the participants endpoint.
 * @param {number} position 1-based position among the participant's tickets.
 * @return {string} Label.
 */
export const ticketLabel = ( ticket, position ) =>
	ticket.ticket_type_name
		? sprintf(
				/* translators: 1: ticket number among the participant's tickets, 2: ticket type name, 3: short ticket reference */
				__( 'Ticket %1$d — %2$s (%3$s)', 'fair-audience' ),
				position,
				ticket.ticket_type_name,
				ticket.reference
		  )
		: sprintf(
				/* translators: 1: ticket number among the participant's tickets, 2: short ticket reference */
				__( 'Ticket %1$d (%2$s)', 'fair-audience' ),
				position,
				ticket.reference
		  );

/**
 * Edit one ticket's activities and check-in. Saving affects only this
 * ticket; the holder's other tickets keep their own state.
 *
 * @param {Object}   props
 * @param {Object}   props.ticket        Ticket from the participants endpoint.
 * @param {number}   props.position      1-based position among the participant's tickets.
 * @param {Object[]} props.ticketOptions Activities configured for the event.
 * @param {number}   props.eventDateId   Event date the ticket belongs to.
 * @param {Function} props.onSaved       Called with the updated ticket.
 * @param {Function} props.onError       Called with an error message.
 * @return {Element} Ticket editor.
 */
export default function TicketEditor( {
	ticket,
	position,
	ticketOptions,
	eventDateId,
	onSaved,
	onError,
} ) {
	const [ activityIds, setActivityIds ] = useState(
		ticket.activity_ids || []
	);
	const [ attended, setAttended ] = useState( !! ticket.attended_at );
	const [ isSaving, setIsSaving ] = useState( false );

	const savedIds = ticket.activity_ids || [];
	const isDirty =
		attended !== !! ticket.attended_at ||
		activityIds.length !== savedIds.length ||
		activityIds.some( ( id ) => ! savedIds.includes( id ) );

	const label = ticketLabel( ticket, position );

	const toggleActivity = ( id ) => {
		setActivityIds( ( current ) =>
			current.includes( id )
				? current.filter( ( n ) => n !== id )
				: [ ...current, id ]
		);
	};

	const handleSave = async () => {
		setIsSaving( true );
		try {
			const updated = await apiFetch( {
				path: `/fair-audience/v1/event-dates/${ eventDateId }/tickets/${ ticket.id }`,
				method: 'PUT',
				data: { activity_ids: activityIds, attended },
			} );
			onSaved( updated );
		} catch ( err ) {
			onError( err.message || '' );
		} finally {
			setIsSaving( false );
		}
	};

	return (
		<div
			className="fair-audience-ticket-editor"
			data-ticket-id={ ticket.id }
			style={ {
				border: '1px solid #dcdcde',
				borderRadius: '4px',
				padding: '12px',
			} }
		>
			<VStack spacing={ 2 }>
				<p style={ { margin: 0, fontWeight: 600 } }>{ label }</p>
				<p style={ { margin: 0, color: '#666', fontSize: '12px' } }>
					{ TICKET_STATUS_DISPLAY[ ticket.status ] || ticket.status }
				</p>
				{ ticketOptions.map( ( opt ) => (
					<CheckboxControl
						key={ opt.id }
						label={ opt.name }
						checked={ activityIds.includes( opt.id ) }
						onChange={ () => toggleActivity( opt.id ) }
						__nextHasNoMarginBottom
					/>
				) ) }
				<CheckboxControl
					label={ __( 'Checked in', 'fair-audience' ) }
					checked={ attended }
					onChange={ setAttended }
					__nextHasNoMarginBottom
				/>
				<HStack style={ { justifyContent: 'flex-end' } }>
					<Button
						variant="secondary"
						onClick={ handleSave }
						disabled={ isSaving || ! isDirty }
						label={ sprintf(
							/* translators: %s: ticket label, e.g. "Ticket 1 — Regular (AB12CD34)" */
							__( 'Save %s', 'fair-audience' ),
							label
						) }
						showTooltip={ false }
					>
						{ isSaving
							? __( 'Saving…', 'fair-audience' )
							: __( 'Save ticket', 'fair-audience' ) }
					</Button>
				</HStack>
				{ ! isDirty && ! isSaving && (
					<p
						style={ {
							margin: 0,
							color: '#666',
							fontSize: '12px',
							textAlign: 'right',
						} }
					>
						{ __( 'No unsaved changes.', 'fair-audience' ) }
					</p>
				) }
			</VStack>
		</div>
	);
}
