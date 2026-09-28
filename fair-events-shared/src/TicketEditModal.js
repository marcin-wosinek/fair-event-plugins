/**
 * Ticket Edit Modal
 *
 * Edit one ticket's type, activities and check-in together (#1709). Both the
 * List tab (fair-events) and the Audience tab (fair-audience) open it; the
 * data and the save go through Fair Audience's ticket endpoint.
 *
 * Strings use the fair-events text domain: both tabs live on fair-events'
 * Manage Event page, which loads that domain's translations.
 *
 * @package FairEventsShared
 */

import { useState, useEffect } from '@wordpress/element';
import {
	Modal,
	Button,
	CheckboxControl,
	Flex,
	FlexItem,
	Notice,
	SelectControl,
	Spinner,
	TextareaControl,
} from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

/**
 * Label naming one ticket of a purchase: its number within the purchase and
 * its short reference, e.g. "Ticket 2 (AE2671B5)".
 *
 * @param {number} position  1-based number of the ticket within its purchase.
 * @param {string} reference Short ticket reference.
 * @return {string} Label
 */
export function ticketReferenceLabel( position, reference ) {
	return sprintf(
		/* translators: 1: number of the ticket within its purchase, 2: short ticket reference */
		__( 'Ticket %1$d (%2$s)', 'fair-events' ),
		Number( position ),
		reference
	);
}

/**
 * Display name of a ticket's status.
 *
 * @param {string} status Ticket status.
 * @return {string} Label
 */
export function ticketStatusName( status ) {
	if ( status === 'confirmed' ) {
		return __( 'Confirmed', 'fair-events' );
	}
	if ( status === 'pending_payment' ) {
		return __( 'Awaiting payment', 'fair-events' );
	}
	return status;
}

/**
 * Option label for a target, naming the places it has left.
 *
 * @param {Object}      target           Ticket type or event date choice.
 * @param {string}      target.label     Date or ticket type name.
 * @param {number|null} target.remaining Places left, or null for no limit.
 * @return {string} Option label
 */
export function targetOptionLabel( { label, remaining } ) {
	if ( remaining === null || remaining === undefined ) {
		return label;
	}
	if ( Number( remaining ) <= 0 ) {
		/* translators: %s: event date or ticket type name */
		return sprintf( __( '%s — Full', 'fair-events' ), label );
	}
	return sprintf(
		/* translators: 1: event date or ticket type name, 2: number of places left */
		_n(
			'%1$s — %2$d place left',
			'%1$s — %2$d places left',
			Number( remaining ),
			'fair-events'
		),
		label,
		Number( remaining )
	);
}

/**
 * Sentence describing a capacity projection that goes over its limit.
 *
 * @param {Object} projection Projection from a 409 capacity_exceeded response.
 * @return {string} Sentence
 */
export function projectionMessage( projection ) {
	return sprintf(
		/* translators: 1: event date, ticket type or activity name, 2: places taken after the change, 3: capacity */
		_n(
			'%1$s would have %2$d of %3$d place taken.',
			'%1$s would have %2$d of %3$d places taken.',
			Number( projection.capacity ),
			'fair-events'
		),
		projection.label,
		Number( projection.after ),
		Number( projection.capacity )
	);
}

/**
 * Why the chosen activities break the chosen ticket type's rules, or null
 * when they keep them.
 *
 * @param {Object|undefined} ticketType Chosen ticket type choice, if any.
 * @param {number}           count      Activities chosen.
 * @return {string|null} Reason
 */
export function activityRuleProblem( ticketType, count ) {
	if ( ! ticketType ) {
		return null;
	}
	if ( ! ticketType.activities_enabled ) {
		return count > 0
			? __(
					'The chosen ticket type does not include activities. Clear them to save.',
					'fair-events'
			  )
			: null;
	}
	const maximum = ticketType.maximum_activities;
	if ( maximum !== null && maximum !== undefined && count > maximum ) {
		return sprintf(
			/* translators: %d: maximum number of activities */
			_n(
				'Choose at most %d activity for this ticket type.',
				'Choose at most %d activities for this ticket type.',
				Number( maximum ),
				'fair-events'
			),
			Number( maximum )
		);
	}
	const minimum = Number( ticketType.minimum_activities || 0 );
	if ( count < minimum ) {
		return sprintf(
			/* translators: %d: minimum number of activities */
			_n(
				'Choose at least %d activity for this ticket type.',
				'Choose at least %d activities for this ticket type.',
				minimum,
				'fair-events'
			),
			minimum
		);
	}
	return null;
}

/**
 * Display text of one Fair Form answer. Multiselect answers are stored as a
 * JSON list.
 *
 * @param {Object} answer Answer from the REST response.
 * @return {string} Text
 */
export function formatAnswerValue( answer ) {
	if ( answer.question_type === 'multiselect' ) {
		try {
			const values = JSON.parse( answer.answer_value );
			if ( Array.isArray( values ) ) {
				return values.join( ', ' );
			}
		} catch ( e ) {
			// Fall through to the raw value.
		}
	}
	return answer.answer_value || '';
}

/**
 * The Fair Form answers collected for a ticket at signup, read-only.
 *
 * @param {Object}  props
 * @param {Array}   props.answers     Answers attached to the ticket.
 * @param {boolean} props.needsReview Whether the answers were attached automatically.
 * @return {Element|null} Answer list, or null when there are none.
 */
export function TicketAnswers( { answers, needsReview } ) {
	if ( ! answers || answers.length === 0 ) {
		return null;
	}
	return (
		<section
			className="fair-events-ticket-edit__answers"
			style={ { marginTop: 16 } }
		>
			<h3 style={ { fontSize: 13, margin: '0 0 8px' } }>
				{ __( 'Signup answers', 'fair-events' ) }
			</h3>
			{ needsReview && (
				<Notice status="warning" isDismissible={ false }>
					{ __(
						'These answers were collected before answers were recorded per ticket, so they were attached to this ticket automatically. Check that they belong to this attendee.',
						'fair-events'
					) }
				</Notice>
			) }
			<dl style={ { margin: 0 } }>
				{ answers.map( ( answer, index ) => (
					<div
						key={ answer.question_key || index }
						style={ { marginBottom: 4 } }
					>
						<dt style={ { fontWeight: 600 } }>
							{ answer.question_text }
						</dt>
						<dd style={ { margin: 0 } }>
							{ answer.file_url ? (
								<a
									href={ answer.file_url }
									target="_blank"
									rel="noreferrer"
								>
									{ __( 'View file', 'fair-events' ) }
								</a>
							) : (
								formatAnswerValue( answer ) || '—'
							) }
						</dd>
					</div>
				) ) }
			</dl>
		</section>
	);
}

const sameIds = ( a, b ) =>
	a.length === b.length && a.every( ( id ) => b.includes( id ) );

const mutedStyle = { margin: 0, color: '#646970' };

/**
 * Edit one ticket's type, activities and check-in, saved together. Saving
 * changes only this ticket: the purchase, its payment and the other tickets
 * stay as they are.
 *
 * @param {Object}   props
 * @param {number}   props.eventDateId Event date the ticket is on.
 * @param {number}   props.ticketId    Ticket to edit.
 * @param {Function} props.onClose     Called to close without saving.
 * @param {Function} props.onSaved     Called with the saved ticket.
 * @return {Element} Modal
 */
export default function TicketEditModal( {
	eventDateId,
	ticketId,
	onClose,
	onSaved,
} ) {
	const [ data, setData ] = useState( null );
	const [ loadError, setLoadError ] = useState( null );
	const [ typeId, setTypeId ] = useState( null );
	const [ activityIds, setActivityIds ] = useState( [] );
	const [ attended, setAttended ] = useState( false );
	// Set when saving would go past a limit: the administrator can then
	// save anyway by giving a reason.
	const [ projections, setProjections ] = useState( null );
	const [ reason, setReason ] = useState( '' );
	const [ saving, setSaving ] = useState( false );
	const [ saveError, setSaveError ] = useState( null );

	useEffect( () => {
		apiFetch( {
			path: `/fair-audience/v1/event-dates/${ eventDateId }/tickets/${ ticketId }`,
		} )
			.then( ( response ) => {
				setData( response );
				setTypeId( response.ticket.ticket_type_id );
				setActivityIds( response.ticket.activity_ids || [] );
				setAttended( !! response.ticket.attended_at );
			} )
			.catch( ( err ) =>
				setLoadError(
					err.message ||
						__( 'Failed to load the ticket.', 'fair-events' )
				)
			);
	}, [ eventDateId, ticketId ] );

	const edited = ( apply ) => ( value ) => {
		apply( value );
		setProjections( null );
		setSaveError( null );
	};

	const renderBody = () => {
		if ( loadError ) {
			return (
				<>
					<Notice status="error" isDismissible={ false }>
						{ loadError }
					</Notice>
					<Flex justify="flex-end" style={ { marginTop: 16 } }>
						<Button variant="tertiary" onClick={ onClose }>
							{ __( 'Close', 'fair-events' ) }
						</Button>
					</Flex>
				</>
			);
		}
		if ( ! data ) {
			return <Spinner />;
		}

		const {
			ticket,
			ticket_types: ticketTypes = [],
			activities = [],
		} = data;
		const savedIds = ticket.activity_ids || [];
		const chosenType = ticketTypes.find( ( type ) => type.id === typeId );
		const typeChanged = typeId !== ticket.ticket_type_id;
		const activitiesChanged = ! sameIds( activityIds, savedIds );
		const attendedChanged = attended !== !! ticket.attended_at;
		const isDirty = typeChanged || activitiesChanged || attendedChanged;
		const activitiesAllowed = chosenType
			? chosenType.activities_enabled
			: true;
		const overCapacityIds = ticket.over_capacity_activity_ids || [];
		const answers = (
			<TicketAnswers
				answers={ ticket.answers }
				needsReview={ ticket.answers_need_review }
			/>
		);

		const header = (
			<div style={ { marginBottom: 16 } }>
				<p style={ { margin: 0, fontWeight: 600 } }>
					{ ticketReferenceLabel(
						ticket.position,
						ticket.reference
					) }
				</p>
				<p style={ mutedStyle }>
					{ sprintf(
						/* translators: %s: ticket status, e.g. "Confirmed" */
						__( 'Status: %s', 'fair-events' ),
						ticketStatusName( ticket.status )
					) }
				</p>
			</div>
		);

		if ( ! ticket.editable ) {
			const names = activities
				.filter( ( option ) => savedIds.includes( option.id ) )
				.map( ( option ) => option.name );
			return (
				<>
					{ header }
					<Notice status="warning" isDismissible={ false }>
						{ __(
							'This ticket is awaiting payment. It can be edited once the payment is complete.',
							'fair-events'
						) }
					</Notice>
					<dl className="fair-events-ticket-edit__summary">
						<dt>{ __( 'Ticket type', 'fair-events' ) }</dt>
						<dd>{ ticket.ticket_type_name || '—' }</dd>
						<dt>{ __( 'Activities', 'fair-events' ) }</dt>
						<dd>
							{ names.length
								? names.join( ', ' )
								: __( 'None', 'fair-events' ) }
						</dd>
						<dt>{ __( 'Checked in', 'fair-events' ) }</dt>
						<dd>
							{ ticket.attended_at
								? __( 'Yes', 'fair-events' )
								: __( 'No', 'fair-events' ) }
						</dd>
					</dl>
					{ answers }
					<Flex justify="flex-end" style={ { marginTop: 16 } }>
						<Button variant="tertiary" onClick={ onClose }>
							{ __( 'Close', 'fair-events' ) }
						</Button>
					</Flex>
				</>
			);
		}

		const ruleProblem =
			typeChanged || activitiesChanged
				? activityRuleProblem( chosenType, activityIds.length )
				: null;
		const reasonMissing = !! projections && reason.trim() === '';
		let blockedBy = null;
		if ( ! isDirty ) {
			blockedBy = __( 'No unsaved changes.', 'fair-events' );
		} else if ( ruleProblem ) {
			blockedBy = ruleProblem;
		} else if ( reasonMissing ) {
			blockedBy = __(
				'Enter a reason to go over capacity.',
				'fair-events'
			);
		}

		const toggleActivity = ( id ) =>
			edited( setActivityIds )(
				activityIds.includes( id )
					? activityIds.filter( ( n ) => n !== id )
					: [ ...activityIds, id ]
			);

		const activityLabel = ( option ) => {
			if ( overCapacityIds.includes( option.id ) ) {
				return sprintf(
					/* translators: %s: activity name */
					__( '%s — over capacity', 'fair-events' ),
					option.name
				);
			}
			// Places left matter only for an activity the ticket would add.
			return savedIds.includes( option.id )
				? option.name
				: targetOptionLabel( {
						label: option.name,
						remaining: option.remaining,
				  } );
		};

		const save = async () => {
			setSaving( true );
			setSaveError( null );
			const payload = {};
			if ( typeChanged ) {
				payload.ticket_type_id = typeId;
			}
			if ( activitiesChanged ) {
				payload.activity_ids = activityIds;
			}
			if ( attendedChanged ) {
				payload.attended = attended;
			}
			if ( projections ) {
				payload.override_reason = reason.trim();
			}
			try {
				const saved = await apiFetch( {
					path: `/fair-audience/v1/event-dates/${ eventDateId }/tickets/${ ticketId }`,
					method: 'PUT',
					data: payload,
				} );
				onSaved( saved );
			} catch ( err ) {
				if (
					err.code === 'capacity_exceeded' &&
					err.data?.projection
				) {
					setProjections(
						err.data.projections || [ err.data.projection ]
					);
				} else {
					setSaveError(
						err.message ||
							__( 'Failed to save the ticket.', 'fair-events' )
					);
				}
			} finally {
				setSaving( false );
			}
		};

		return (
			<>
				{ header }
				{ ticketTypes.length > 0 ? (
					<>
						<SelectControl
							__nextHasNoMarginBottom
							__next40pxDefaultSize
							label={ __( 'Ticket type', 'fair-events' ) }
							value={ String( typeId ) }
							options={ ticketTypes.map( ( type ) => ( {
								label: type.current
									? sprintf(
											/* translators: %s: ticket type name */
											__( '%s (current)', 'fair-events' ),
											type.label
									  )
									: targetOptionLabel( type ),
								value: String( type.id ),
							} ) ) }
							onChange={ edited( ( value ) =>
								setTypeId( Number( value ) )
							) }
							disabled={ ticketTypes.length < 2 }
						/>
						<p className="description" style={ mutedStyle }>
							{ ticketTypes.length < 2
								? __(
										'No other ticket type with the same dates is available for this ticket.',
										'fair-events'
								  )
								: __(
										'The amount paid stays the same: no charge or refund is made for a price difference.',
										'fair-events'
								  ) }
						</p>
					</>
				) : (
					<p style={ mutedStyle }>
						{ sprintf(
							/* translators: %s: ticket type name, or a dash */
							__( 'Ticket type: %s', 'fair-events' ),
							ticket.ticket_type_name || '—'
						) }
					</p>
				) }
				{ activities.length > 0 && (
					<fieldset style={ { margin: '16px 0 0' } }>
						<legend style={ { fontWeight: 600, marginBottom: 8 } }>
							{ __( 'Activities', 'fair-events' ) }
						</legend>
						{ ! activitiesAllowed && (
							<p style={ mutedStyle }>
								{ __(
									'This ticket type does not include activities.',
									'fair-events'
								) }
							</p>
						) }
						<div style={ { display: 'grid', gap: 8 } }>
							{ activities.map( ( option ) => (
								<CheckboxControl
									key={ option.id }
									__nextHasNoMarginBottom
									label={ activityLabel( option ) }
									checked={ activityIds.includes(
										option.id
									) }
									disabled={
										! activitiesAllowed &&
										! activityIds.includes( option.id )
									}
									onChange={ () =>
										toggleActivity( option.id )
									}
								/>
							) ) }
						</div>
					</fieldset>
				) }
				<div style={ { marginTop: 16 } }>
					<CheckboxControl
						__nextHasNoMarginBottom
						label={ __( 'Checked in', 'fair-events' ) }
						checked={ attended }
						onChange={ edited( setAttended ) }
					/>
				</div>
				{ answers }
				{ saveError && (
					<Notice status="error" isDismissible={ false }>
						{ saveError }
					</Notice>
				) }
				{ projections && (
					<>
						<Notice status="warning" isDismissible={ false }>
							{ projections.map( ( projection ) => (
								<p
									key={ `${ projection.scope }-${ projection.id }-${ projection.event_date_id }` }
									style={ { margin: '0 0 4px' } }
								>
									{ projectionMessage( projection ) }
								</p>
							) ) }
						</Notice>
						<TextareaControl
							__nextHasNoMarginBottom
							label={ __(
								'Reason for going over capacity',
								'fair-events'
							) }
							help={ __(
								'Required to go over capacity. It is kept with the signup.',
								'fair-events'
							) }
							value={ reason }
							onChange={ setReason }
						/>
					</>
				) }
				<Flex
					justify="flex-end"
					align="center"
					gap={ 2 }
					wrap
					style={ { marginTop: 16 } }
				>
					{ blockedBy && ! saving && (
						<FlexItem>
							<span style={ mutedStyle }>{ blockedBy }</span>
						</FlexItem>
					) }
					<FlexItem>
						<Button
							variant="tertiary"
							onClick={ onClose }
							disabled={ saving }
						>
							{ __( 'Cancel', 'fair-events' ) }
						</Button>
					</FlexItem>
					<FlexItem>
						<Button
							variant="primary"
							isDestructive={ !! projections }
							isBusy={ saving }
							disabled={ saving || !! blockedBy }
							onClick={ save }
						>
							{ projections
								? __( 'Save over capacity', 'fair-events' )
								: __( 'Save ticket', 'fair-events' ) }
						</Button>
					</FlexItem>
				</Flex>
			</>
		);
	};

	return (
		<Modal
			title={
				data
					? sprintf(
							/* translators: %s: participant name */
							__( 'Edit ticket — %s', 'fair-events' ),
							data.ticket.participant_name ||
								__( '(no name)', 'fair-events' )
					  )
					: __( 'Edit ticket', 'fair-events' )
			}
			onRequestClose={ onClose }
			size="medium"
		>
			{ renderBody() }
		</Modal>
	);
}
