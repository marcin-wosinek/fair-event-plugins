/**
 * Event Signups Component
 *
 * List the tickets of confirmed get-tickets registrations for an event date,
 * one row per ticket, with the extras each ticket holds. Email addresses and
 * amounts stay out of the table but remain available in exports.
 *
 * @package FairEvents
 */

import { useState, useEffect, useCallback } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Spinner,
	Notice,
	Button,
	ToggleControl,
	Flex,
	FlexItem,
	__experimentalConfirmDialog as ConfirmDialog,
} from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import SignupExportModal from './SignupExportModal.js';
import {
	TicketEditModal,
	ticketReferenceLabel,
	ticketStatusName,
} from 'fair-events-shared';
import SignupEditModal, {
	ACTION_MOVE,
	ACTION_CHANGE_TYPE,
} from './SignupEditModal.js';

// Override recorded when an administrator added an activity to a ticket
// past its limit (fair-audience's Audience tab).
const ACTION_ACTIVITY = 'activity';

/**
 * Whether a signup contains an explicit mailing opt-in value.
 *
 * @param {*} value Consent value returned by the API.
 * @return {boolean} Whether the signup opted in
 */
export function isMailingOptIn( value ) {
	return value === true || value === 1 || value === '1';
}

/**
 * Whether a signup contains an explicit over-capacity flag.
 *
 * @param {*} value Flag value returned by the API.
 * @return {boolean} Whether the signup exceeds capacity
 */
function isOverCapacity( value ) {
	return value === true || value === 1 || value === '1';
}

/**
 * Whether a signup is a successful registration. Free registrations are
 * confirmed immediately; paid ones once their payment succeeds.
 *
 * @param {Object} signup Signup row returned by the API.
 * @return {boolean} Whether the signup is confirmed
 */
export function isConfirmedSignup( signup ) {
	return signup.status === 'confirmed';
}

/**
 * Expand registrations into the List's rows: one per ticket, numbered in
 * order. A registration whose tickets were not created yet (an older
 * registration still being converted) keeps a single row without a ticket,
 * so it is never dropped.
 *
 * @param {Array} signups Registrations returned by the API.
 * @return {Array<{signup: Object, ticket: Object|null, isFirstTicket: boolean}>} Rows
 */
export function expandTicketRows( signups ) {
	return signups.flatMap( ( signup ) => {
		const tickets = Array.isArray( signup.tickets ) ? signup.tickets : [];
		if ( tickets.length === 0 ) {
			return [ { signup, ticket: null, isFirstTicket: true } ];
		}
		return tickets.map( ( ticket, index ) => ( {
			signup,
			ticket,
			isFirstTicket: index === 0,
		} ) );
	} );
}

/**
 * Label identifying a ticket row, e.g. "Ticket 2 (AE2671B5)".
 *
 * @param {Object|null} ticket Ticket of the row, null when not created yet.
 * @return {string} Label
 */
export function ticketRowLabel( ticket ) {
	return ticket
		? ticketReferenceLabel( ticket.position, ticket.reference )
		: __( 'Ticket not created yet', 'fair-events' );
}

/**
 * Ticket type shown on a ticket row: the ticket's own type, falling back to
 * the type the registration was bought with.
 *
 * @param {Object}      row        Row from expandTicketRows().
 * @param {Object}      row.signup Registration of the row.
 * @param {Object|null} row.ticket Ticket of the row.
 * @return {string} Ticket type name
 */
export function ticketRowTypeName( { signup, ticket } ) {
	if ( ticket ) {
		return ticket.ticket_type_name || '—';
	}
	return signup.ticket_type_name || '—';
}

/**
 * Extras a ticket holds with a confirmed payment.
 *
 * @param {Object|null} ticket Ticket of the row.
 * @return {number[]|null} Option IDs, null when the ticket is not created yet
 */
export function ticketConfirmedOptionIds( ticket ) {
	if ( ! ticket ) {
		return null;
	}
	return ( ticket.confirmed_activity_ids || [] ).map( Number );
}

// Ticket statuses that no longer admit anyone; such tickets are not edited.
const INACTIVE_TICKET_STATUSES = [
	'failed',
	'expired',
	'cancelled',
	'refunded',
];

const cellStyle = {
	padding: '8px',
	borderBottom: '1px solid #eee',
};

/**
 * Horizontal alignment for a List column header.
 *
 * @param {Object} header Column descriptor.
 * @return {string} CSS text-align value
 */
function headerAlign( header ) {
	if ( header.key === 'number' ) {
		return 'right';
	}
	return header.isExtra ? 'center' : 'left';
}

/**
 * What an administrator did when a signup went over capacity.
 *
 * @param {Object} override Override row returned by the API.
 * @return {string} Label
 */
export function overrideActionLabel( override ) {
	if ( override.action === ACTION_ACTIVITY ) {
		return sprintf(
			/* translators: %s: activity name */
			__( 'Activity %s added', 'fair-events' ),
			override.activity_name
		);
	}
	if ( override.action === ACTION_MOVE ) {
		return override.activity_name
			? sprintf(
					/* translators: %s: activity name */
					__( 'Moved (activity %s over capacity)', 'fair-events' ),
					override.activity_name
			  )
			: __( 'Moved', 'fair-events' );
	}
	return __( 'Ticket type changed', 'fair-events' );
}

/**
 * Status cell of a confirmed signup: flags an over-capacity signup and lets
 * the administrator see why it went over.
 *
 * @param {Object} props        Component props.
 * @param {Object} props.signup Signup row returned by the API.
 * @return {Element} Status
 */
function SignupStatus( { signup } ) {
	const [ showDetails, setShowDetails ] = useState( false );

	if ( ! isOverCapacity( signup.over_capacity ) ) {
		return __( 'Confirmed', 'fair-events' );
	}

	const overrides = Array.isArray( signup.overrides ) ? signup.overrides : [];

	return (
		<>
			<span>{ __( 'Confirmed — over capacity', 'fair-events' ) }</span>{ ' ' }
			<Button
				variant="link"
				aria-expanded={ showDetails }
				onClick={ () => setShowDetails( ( shown ) => ! shown ) }
			>
				{ showDetails
					? __( 'Hide details', 'fair-events' )
					: __( 'Details', 'fair-events' ) }
			</Button>
			{ showDetails && (
				<ul style={ { margin: '4px 0 0' } }>
					{ overrides.length === 0 ? (
						<li>
							{ __(
								'Paid after its hold expired',
								'fair-events'
							) }
						</li>
					) : (
						overrides.map( ( override, index ) => (
							<li key={ index }>
								{ sprintf(
									/* translators: 1: what the administrator did, 2: administrator name, 3: date and time, 4: reason given */
									__(
										'%1$s by %2$s on %3$s: %4$s',
										'fair-events'
									),
									overrideActionLabel( override ),
									override.user_display_name ||
										__( 'unknown user', 'fair-events' ),
									override.created_at,
									override.reason
								) }
							</li>
						) )
					) }
				</ul>
			) }
		</>
	);
}

const EXTRA_SELECTED = 'selected';
const EXTRA_NOT_SELECTED = 'not_selected';
const EXTRA_UNAVAILABLE = 'unavailable';

/**
 * Read-only indicator for one extra on one ticket.
 *
 * @param {Object} props       Component props.
 * @param {string} props.state One of the EXTRA_* states.
 * @return {Element} Indicator
 */
function ExtraIndicator( { state } ) {
	if ( state === EXTRA_SELECTED ) {
		return (
			<span
				role="img"
				aria-label={ __( 'Selected', 'fair-events' ) }
				title={ __( 'Selected', 'fair-events' ) }
				style={ { fontSize: '1.25em', fontWeight: 600 } }
			>
				✓
			</span>
		);
	}
	if ( state === EXTRA_NOT_SELECTED ) {
		return (
			<span
				role="img"
				aria-label={ __( 'Not selected', 'fair-events' ) }
				title={ __( 'Not selected', 'fair-events' ) }
				// Visually empty, but keeps a hover target for the title.
				style={ { display: 'inline-block', width: '1em' } }
			/>
		);
	}
	return (
		<span
			role="img"
			aria-label={ __( 'Selection unavailable', 'fair-events' ) }
			title={ __( 'Selection unavailable', 'fair-events' ) }
			style={ { color: '#757575' } }
		>
			?
		</span>
	);
}

export default function EventSignups( { eventDateId } ) {
	const connectorActive = !! window.fairPaymentsConnector?.connectorActive;
	const audienceActive = !! window.fairEventsManageEventData?.audienceUrl;
	const [ signups, setSignups ] = useState( [] );
	const [ ticketOptions, setTicketOptions ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ mailingOnly, setMailingOnly ] = useState( false );
	const [ selectedSignup, setSelectedSignup ] = useState( null );
	const [ deleteError, setDeleteError ] = useState( null );
	const [ isExportModalOpen, setIsExportModalOpen ] = useState( false );
	// { signup, action } while the move / change-type modal is open.
	const [ editing, setEditing ] = useState( null );
	// Ticket ID while the ticket editor is open.
	const [ editingTicketId, setEditingTicketId ] = useState( null );

	const loadSignups = useCallback( () => {
		if ( ! eventDateId ) {
			setLoading( false );
			return;
		}
		apiFetch( {
			path: `/fair-events/v1/get-tickets?event_date=${ eventDateId }`,
		} )
			.then( ( data ) => {
				setSignups( data );
				setLoading( false );
			} )
			.catch( ( err ) => {
				setError(
					err.message ||
						__( 'Failed to load signups.', 'fair-events' )
				);
				setLoading( false );
			} );
	}, [ eventDateId ] );

	useEffect( () => {
		loadSignups();
	}, [ loadSignups ] );

	useEffect( () => {
		if ( ! eventDateId ) {
			return;
		}
		// Same source, order and labels as the Audience tab's extra columns.
		apiFetch( {
			path: `/fair-events/v1/event-dates/${ eventDateId }/tickets`,
		} )
			.then( ( data ) =>
				setTicketOptions(
					Array.isArray( data?.options ) ? data.options : []
				)
			)
			.catch( () => setTicketOptions( [] ) );
	}, [ eventDateId ] );

	if ( loading ) {
		return <Spinner />;
	}

	if ( error ) {
		return <Notice status="error">{ error }</Notice>;
	}

	const headers = [
		{ key: 'number', label: '#' },
		{ key: 'name', label: __( 'Name', 'fair-events' ) },
		{ key: 'ticket', label: __( 'Ticket', 'fair-events' ) },
		{ key: 'ticket_type', label: __( 'Ticket Type', 'fair-events' ) },
		...ticketOptions.map( ( opt ) => ( {
			key: `option-${ opt.id }`,
			label: opt.short_name || opt.name,
			isExtra: true,
		} ) ),
		{ key: 'status', label: __( 'Status', 'fair-events' ) },
		{ key: 'transaction', label: __( 'Transaction', 'fair-events' ) },
		{ key: 'mailing', label: __( 'Mailing', 'fair-events' ) },
		{ key: 'date', label: __( 'Date', 'fair-events' ) },
		{ key: 'actions', label: __( 'Actions', 'fair-events' ) },
	];

	// Filters apply to whole registrations, which are then expanded, so all
	// tickets of a registration are included or excluded together.
	const confirmedSignups = signups.filter( isConfirmedSignup );
	const visibleSignups = mailingOnly
		? confirmedSignups.filter( ( s ) => isMailingOptIn( s.mailing_opt_in ) )
		: confirmedSignups;
	const visibleRows = expandTicketRows( visibleSignups );
	const hasPendingTickets = visibleRows.some( ( row ) => ! row.ticket );

	const extraState = ( ticket, option ) => {
		const selected = ticketConfirmedOptionIds( ticket );
		if ( ! selected ) {
			return EXTRA_UNAVAILABLE;
		}
		return selected.includes( Number( option.id ) )
			? EXTRA_SELECTED
			: EXTRA_NOT_SELECTED;
	};

	const renderStatus = ( { signup, ticket } ) => {
		if ( ticket && ticket.status !== 'confirmed' ) {
			return ticketStatusName( ticket.status );
		}
		return <SignupStatus signup={ signup } />;
	};

	const renderRegistrationActions = ( signup ) => {
		const ticketCount = ( signup.tickets || [] ).length;
		return (
			<>
				{ ticketCount > 1 && (
					<div style={ { color: '#757575', marginBottom: '4px' } }>
						{ sprintf(
							/* translators: %d: number of tickets in the registration */
							_n(
								'Registration (%d ticket):',
								'Registration (%d tickets):',
								ticketCount,
								'fair-events'
							),
							ticketCount
						) }
					</div>
				) }
				<Flex justify="flex-start" gap={ 3 } wrap>
					{ signup.can_move && (
						<Button
							variant="link"
							onClick={ () =>
								setEditing( { signup, action: ACTION_MOVE } )
							}
						>
							{ __( 'Move', 'fair-events' ) }
						</Button>
					) }
					{ ! audienceActive && !! signup.ticket_type_id && (
						<Button
							variant="link"
							onClick={ () =>
								setEditing( {
									signup,
									action: ACTION_CHANGE_TYPE,
								} )
							}
						>
							{ __( 'Change ticket type', 'fair-events' ) }
						</Button>
					) }
					<Button
						variant="link"
						isDestructive
						onClick={ () => setSelectedSignup( signup ) }
					>
						{ __( 'Delete', 'fair-events' ) }
					</Button>
				</Flex>
			</>
		);
	};

	const renderRow = ( row, index ) => {
		const { signup, ticket, isFirstTicket } = row;
		const label = ticketRowLabel( ticket );
		return (
			<tr
				key={ `${ signup.id }-${ ticket ? ticket.id : 'pending' }` }
				className="fair-events-signups__ticket"
				data-ticket-id={ ticket ? ticket.id : undefined }
				data-signup-id={ signup.id }
				style={
					isFirstTicket && index > 0
						? { borderTop: '2px solid #ddd' }
						: undefined
				}
			>
				<td style={ { ...cellStyle, textAlign: 'right' } }>
					{ index + 1 }
				</td>
				<td style={ cellStyle }>{ signup.name }</td>
				<td style={ { ...cellStyle, whiteSpace: 'nowrap' } }>
					{ label }
				</td>
				<td style={ cellStyle }>{ ticketRowTypeName( row ) }</td>
				{ ticketOptions.map( ( opt ) => (
					<td
						key={ opt.id }
						style={ { ...cellStyle, textAlign: 'center' } }
					>
						<ExtraIndicator state={ extraState( ticket, opt ) } />
					</td>
				) ) }
				<td style={ cellStyle }>{ renderStatus( row ) }</td>
				<td style={ cellStyle }>
					{ signup.transaction_id && connectorActive ? (
						<a
							href={ `admin.php?page=fair-payments-connector-transaction&transaction_id=${ signup.transaction_id }` }
						>
							{ signup.transaction_id }
						</a>
					) : (
						signup.transaction_id || '—'
					) }
				</td>
				<td style={ cellStyle }>
					{ isMailingOptIn( signup.mailing_opt_in )
						? __( 'Yes', 'fair-events' )
						: __( 'No', 'fair-events' ) }
				</td>
				<td style={ cellStyle }>{ signup.created_at }</td>
				<td style={ cellStyle }>
					{ isFirstTicket && renderRegistrationActions( signup ) }
					{ audienceActive &&
						ticket &&
						! INACTIVE_TICKET_STATUSES.includes(
							ticket.status
						) && (
							<div
								style={
									isFirstTicket
										? { marginTop: '4px' }
										: undefined
								}
							>
								<Button
									variant="link"
									onClick={ () =>
										setEditingTicketId( ticket.id )
									}
									label={ sprintf(
										/* translators: %s: ticket label, e.g. "Ticket 2 (AE2671B5)" */
										__( 'Edit %s', 'fair-events' ),
										label
									) }
									showTooltip={ false }
								>
									{ __( 'Edit ticket', 'fair-events' ) }
								</Button>
							</div>
						) }
				</td>
			</tr>
		);
	};

	const handleDelete = async () => {
		if ( ! selectedSignup ) {
			return;
		}

		const signupId = selectedSignup.id;
		setDeleteError( null );
		try {
			await apiFetch( {
				path: `/fair-events/v1/get-tickets/${ signupId }`,
				method: 'DELETE',
			} );
			setSignups( ( current ) =>
				current.filter( ( signup ) => signup.id !== signupId )
			);
		} catch ( err ) {
			setDeleteError(
				err.message || __( 'Failed to delete signup.', 'fair-events' )
			);
		} finally {
			setSelectedSignup( null );
		}
	};

	return (
		<Card className="fair-events-signups" style={ { marginTop: '16px' } }>
			<CardHeader>
				<h2>{ __( 'List', 'fair-events' ) }</h2>
				<Flex justify="flex-end" gap={ 2 }>
					<FlexItem>
						<ToggleControl
							__nextHasNoMarginBottom
							label={ __(
								'Mailing opt-ins only',
								'fair-events'
							) }
							checked={ mailingOnly }
							onChange={ setMailingOnly }
						/>
					</FlexItem>
					<FlexItem>
						<Button
							variant="secondary"
							onClick={ () => setIsExportModalOpen( true ) }
							disabled={ visibleRows.length === 0 }
						>
							{ __( 'Export', 'fair-events' ) }
						</Button>
					</FlexItem>
				</Flex>
			</CardHeader>
			<CardBody>
				{ deleteError && (
					<Notice status="error" isDismissible={ false }>
						{ deleteError }
					</Notice>
				) }
				{ hasPendingTickets && (
					<Notice status="warning" isDismissible={ false }>
						{ __(
							'Some older registrations are still being split into individual tickets. They are listed as one row for now; reload this page in a few minutes to see their tickets.',
							'fair-events'
						) }
					</Notice>
				) }
				{ visibleRows.length === 0 ? (
					<p>
						{ confirmedSignups.length === 0
							? __(
									'No confirmed registrations yet.',
									'fair-events'
							  )
							: __(
									'Nothing to export — no registrations match the current filter.',
									'fair-events'
							  ) }
					</p>
				) : (
					<div style={ { overflowX: 'auto', width: '100%' } }>
						<table
							style={ {
								width: '100%',
								borderCollapse: 'collapse',
							} }
						>
							<thead>
								<tr>
									{ headers.map( ( h ) => (
										<th
											key={ h.key }
											style={ {
												textAlign: headerAlign( h ),
												padding: '8px',
												borderBottom: '1px solid #ddd',
												whiteSpace:
													h.key === 'number' ||
													h.isExtra
														? 'nowrap'
														: undefined,
											} }
										>
											{ h.label }
										</th>
									) ) }
								</tr>
							</thead>
							<tbody>{ visibleRows.map( renderRow ) }</tbody>
						</table>
					</div>
				) }
			</CardBody>
			<ConfirmDialog
				isOpen={ !! selectedSignup }
				onConfirm={ handleDelete }
				onCancel={ () => setSelectedSignup( null ) }
				confirmButtonText={ __( 'Delete registration', 'fair-events' ) }
				cancelButtonText={ __( 'Cancel', 'fair-events' ) }
			>
				{ selectedSignup && (
					<>
						<p>
							{ sprintf(
								/* translators: 1: signup name, 2: number of tickets, 3: payment status */
								_n(
									'Delete the registration for %1$s, with its %2$d ticket? Its current payment status is %3$s.',
									'Delete the registration for %1$s, with all %2$d of its tickets? Its current payment status is %3$s.',
									Math.max(
										( selectedSignup.tickets || [] ).length,
										1
									),
									'fair-events'
								),
								selectedSignup.name,
								Math.max(
									( selectedSignup.tickets || [] ).length,
									1
								),
								selectedSignup.status
							) }
						</p>
						<p>
							{ __(
								'This deletion is permanent. It removes only the local signup record and does not refund or cancel any payment-provider transaction.',
								'fair-events'
							) }
						</p>
					</>
				) }
			</ConfirmDialog>
			{ editing && (
				<SignupEditModal
					signup={ editing.signup }
					action={ editing.action }
					onClose={ () => setEditing( null ) }
					onSaved={ () => {
						setEditing( null );
						loadSignups();
					} }
				/>
			) }
			{ editingTicketId && (
				<TicketEditModal
					eventDateId={ eventDateId }
					ticketId={ editingTicketId }
					onClose={ () => setEditingTicketId( null ) }
					onSaved={ () => {
						setEditingTicketId( null );
						loadSignups();
					} }
				/>
			) }
			{ isExportModalOpen && (
				<SignupExportModal
					eventDateId={ eventDateId }
					rows={ visibleRows }
					ticketOptions={ ticketOptions }
					onClose={ () => setIsExportModalOpen( false ) }
				/>
			) }
		</Card>
	);
}
