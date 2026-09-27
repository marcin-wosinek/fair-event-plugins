import { useState } from '@wordpress/element';
import {
	Button,
	CheckboxControl,
	Notice,
	TextareaControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

const TICKET_STATUS_DISPLAY = {
	confirmed: __( 'Confirmed', 'fair-audience' ),
	pending_payment: __( 'Awaiting payment', 'fair-audience' ),
};

/**
 * Display name of a ticket's status.
 *
 * @param {string} status Ticket status from the participants endpoint.
 * @return {string} Label.
 */
export const ticketStatusLabel = ( status ) =>
	TICKET_STATUS_DISPLAY[ status ] || status;

/**
 * Ticket number and reference, without the ticket type, for rows that
 * show the type in a column of its own.
 *
 * @param {Object} ticket   Ticket from the participants endpoint.
 * @param {number} position 1-based position among the participant's tickets.
 * @return {string} Label.
 */
export const ticketShortLabel = ( ticket, position ) =>
	sprintf(
		/* translators: 1: ticket number among the participant's tickets, 2: short ticket reference */
		__( 'Ticket %1$d (%2$s)', 'fair-audience' ),
		position,
		ticket.reference
	);

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
		: ticketShortLabel( ticket, position );

/**
 * Sentence describing an activity that a change would take past its limit.
 *
 * @param {Object} projection Projection from a 409 capacity_exceeded response.
 * @return {string} Sentence.
 */
export const activityProjectionMessage = ( projection ) =>
	sprintf(
		/* translators: 1: activity name, 2: places taken after the change, 3: capacity */
		_n(
			'%1$s would have %2$d of %3$d place taken.',
			'%1$s would have %2$d of %3$d places taken.',
			Number( projection.capacity ),
			'fair-audience'
		),
		projection.label,
		Number( projection.after ),
		Number( projection.capacity )
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
 * @param {Function} [props.onCancel]    Called to close without saving.
 * @return {Element} Ticket editor.
 */
export default function TicketEditor( {
	ticket,
	position,
	ticketOptions,
	eventDateId,
	onSaved,
	onError,
	onCancel,
} ) {
	const [ activityIds, setActivityIds ] = useState(
		ticket.activity_ids || []
	);
	const [ attended, setAttended ] = useState( !! ticket.attended_at );
	const [ isSaving, setIsSaving ] = useState( false );
	// Set when saving would take an activity past its limit: the
	// administrator can then save anyway by giving a reason.
	const [ projections, setProjections ] = useState( null );
	const [ reason, setReason ] = useState( '' );

	const savedIds = ticket.activity_ids || [];
	const isDirty =
		attended !== !! ticket.attended_at ||
		activityIds.length !== savedIds.length ||
		activityIds.some( ( id ) => ! savedIds.includes( id ) );

	const label = ticketLabel( ticket, position );

	const overCapacityIds = ticket.over_capacity_activity_ids || [];

	const toggleActivity = ( id ) => {
		setProjections( null );
		setActivityIds( ( current ) =>
			current.includes( id )
				? current.filter( ( n ) => n !== id )
				: [ ...current, id ]
		);
	};

	const handleSave = async () => {
		setIsSaving( true );
		try {
			const data = { activity_ids: activityIds, attended };
			if ( projections ) {
				data.override_reason = reason.trim();
			}
			const updated = await apiFetch( {
				path: `/fair-audience/v1/event-dates/${ eventDateId }/tickets/${ ticket.id }`,
				method: 'PUT',
				data,
			} );
			setProjections( null );
			setReason( '' );
			onSaved( updated );
		} catch ( err ) {
			if ( err.code === 'capacity_exceeded' && err.data?.projection ) {
				setProjections(
					err.data.projections || [ err.data.projection ]
				);
			} else {
				onError( err.message || '' );
			}
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
					{ ticketStatusLabel( ticket.status ) }
				</p>
				{ ticketOptions.map( ( opt ) => (
					<CheckboxControl
						key={ opt.id }
						label={
							overCapacityIds.includes( opt.id )
								? sprintf(
										/* translators: %s: activity name */
										__(
											'%s — over capacity',
											'fair-audience'
										),
										opt.name
								  )
								: opt.name
						}
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
				{ projections && (
					<Notice status="warning" isDismissible={ false }>
						{ projections.map( ( projection ) => (
							<p
								key={ `${ projection.id }-${ projection.event_date_id }` }
								style={ { margin: '0 0 4px' } }
							>
								{ activityProjectionMessage( projection ) }
							</p>
						) ) }
						<TextareaControl
							label={ __(
								'Reason for going over capacity',
								'fair-audience'
							) }
							value={ reason }
							onChange={ setReason }
							__nextHasNoMarginBottom
						/>
					</Notice>
				) }
				<HStack style={ { justifyContent: 'flex-end' } }>
					{ onCancel && (
						<Button
							variant="tertiary"
							onClick={ onCancel }
							disabled={ isSaving }
						>
							{ __( 'Cancel', 'fair-audience' ) }
						</Button>
					) }
					<Button
						variant="secondary"
						onClick={ handleSave }
						disabled={
							isSaving ||
							! isDirty ||
							( !! projections && reason.trim() === '' )
						}
						label={ sprintf(
							/* translators: %s: ticket label, e.g. "Ticket 1 — Regular (AB12CD34)" */
							__( 'Save %s', 'fair-audience' ),
							label
						) }
						showTooltip={ false }
					>
						{ isSaving && __( 'Saving…', 'fair-audience' ) }
						{ ! isSaving &&
							( projections
								? __( 'Save over capacity', 'fair-audience' )
								: __( 'Save ticket', 'fair-audience' ) ) }
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
