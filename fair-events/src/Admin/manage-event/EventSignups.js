/**
 * Event Signups Component
 *
 * List the confirmed tickets that are on an event date, one row per ticket,
 * with the extras each ticket holds: the tickets of registrations made for
 * the date, and tickets of other registrations moved to it on their own.
 * Email addresses and amounts stay out of the table but remain available in
 * exports.
 *
 * @package FairEvents
 */

import { useState, useEffect, useCallback, useRef } from '@wordpress/element';
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
} from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import SignupExportModal from './SignupExportModal.js';
import { buildSignupPrintHtml, openPrintWindow } from './signup-print.js';
import {
	buildSignupSummary,
	formatSignupSummary,
	signupSummaryErrorMessage,
} from './signup-summary.js';
import {
	TicketEditModal,
	ticketReferenceLabel,
	getEventDisplayTitle,
} from 'fair-events-shared';
import SignupEditModal, {
	ACTION_MOVE,
	ACTION_CHANGE_TYPE,
} from './SignupEditModal.js';
import ConfirmActionModal from '../components/ConfirmActionModal.js';

// Override recorded when an administrator added an activity to a ticket
// past its limit (fair-audience's Audience tab).
const ACTION_ACTIVITY = 'activity';

/**
 * How the organizer recognizes a registration: the registrant's name with
 * the reference of its first ticket listed here, as the List shows them in
 * the registration's first row. Email addresses stay out of view (#1464).
 *
 * @param {Object} signup Registration row.
 * @return {string} Name and ticket reference, or the name alone.
 */
export function signupIdentity( signup ) {
	const reference = listedTickets( signup )[ 0 ]?.reference;
	if ( ! reference ) {
		return signup.name;
	}
	return sprintf(
		/* translators: 1: registrant name, 2: short ticket reference */
		__( '%1$s (%2$s)', 'fair-events' ),
		signup.name,
		reference
	);
}

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
 * Whether a ticket admits its holder: its payment succeeded (or it was free)
 * and it was not cancelled or refunded since.
 *
 * @param {Object} ticket Ticket returned by the API.
 * @return {boolean} Whether the ticket is confirmed
 */
export function isConfirmedTicket( ticket ) {
	return ticket.status === 'confirmed';
}

/**
 * Tickets of a purchase the List of the selected date shows: the confirmed
 * tickets the API names as being on that date. A purchase can hold tickets
 * on other dates too, moved there on their own.
 *
 * @param {Object} signup Registration returned by the API.
 * @return {Array} Listed tickets, in purchase order
 */
export function listedTickets( signup ) {
	const tickets = Array.isArray( signup.tickets ) ? signup.tickets : [];
	if ( ! Array.isArray( signup.listed_ticket_ids ) ) {
		return tickets.filter( isConfirmedTicket );
	}
	const listedIds = signup.listed_ticket_ids.map( Number );
	return tickets.filter( ( ticket ) =>
		listedIds.includes( Number( ticket.id ) )
	);
}

/**
 * How the confirmed tickets of a purchase are spread over dates. Tickets
 * that stopped admitting anyone are counted apart: they are not attendance,
 * but purchase-wide actions can still concern them.
 *
 * @param {Object} signup Registration returned by the API.
 * @return {{confirmed: number, onThisDate: number, onOtherDates: number, onRegistrationDate: number, inactive: number}} Counts
 */
export function purchaseTicketCounts( signup ) {
	const counts = signup.ticket_counts;
	if ( counts ) {
		return {
			confirmed: Number( counts.confirmed ) || 0,
			onThisDate: Number( counts.on_this_date ) || 0,
			onOtherDates: Number( counts.on_other_dates ) || 0,
			onRegistrationDate: Number( counts.on_registration_date ) || 0,
			inactive: Number( counts.inactive ) || 0,
		};
	}
	const tickets = Array.isArray( signup.tickets ) ? signup.tickets : [];
	const confirmed = tickets.filter( isConfirmedTicket ).length;
	const onThisDate = listedTickets( signup ).length;
	return {
		confirmed,
		onThisDate,
		onOtherDates: confirmed - onThisDate,
		onRegistrationDate: confirmed,
		inactive: tickets.length - confirmed,
	};
}

/**
 * Expand registrations into the List's rows: one per confirmed ticket on the
 * selected date, numbered in order. A registration whose tickets were not
 * created yet (an older registration still being converted) keeps a single
 * row without a ticket, so it is never dropped. One with tickets, none of
 * them listed on this date, has no row.
 *
 * `isFirstTicket` places the purchase-wide actions; `isAccountingAnchor`
 * marks the one row, across all dates, that carries the purchase total.
 *
 * @param {Array} signups Registrations returned by the API.
 * @return {Array<{signup: Object, ticket: Object|null, isFirstTicket: boolean, isAccountingAnchor: boolean, ticketCount: number}>} Rows
 */
export function expandTicketRows( signups ) {
	return signups.flatMap( ( signup ) => {
		const tickets = Array.isArray( signup.tickets ) ? signup.tickets : [];
		if ( tickets.length === 0 ) {
			return [
				{
					signup,
					ticket: null,
					isFirstTicket: true,
					isAccountingAnchor: true,
					ticketCount: 1,
				},
			];
		}
		const listed = listedTickets( signup );
		const anchorId = signup.accounting_anchor_ticket_id;
		const hasAnchor = anchorId !== null && anchorId !== undefined;
		return listed.map( ( ticket, index ) => ( {
			signup,
			ticket,
			isFirstTicket: index === 0,
			isAccountingAnchor: hasAnchor
				? Number( ticket.id ) === Number( anchorId )
				: index === 0,
			ticketCount: listed.length,
		} ) );
	} );
}

/**
 * Whether a purchase is listed on a date other than the one it is
 * registered for: the ticket shown was moved here on its own.
 *
 * @param {Object} signup      Registration returned by the API.
 * @param {number} eventDateId Date the List is showing.
 * @return {boolean} Whether the registration belongs to another date
 */
export function isRegisteredElsewhere( signup, eventDateId ) {
	return (
		!! signup.event_date_id &&
		!! eventDateId &&
		Number( signup.event_date_id ) !== Number( eventDateId )
	);
}

/**
 * "1 ticket on this date; 1 on another date" for a purchase split over dates.
 *
 * @param {{onThisDate: number, onOtherDates: number}} counts Purchase counts.
 * @return {string} Distribution, empty when every ticket is on this date
 */
export function ticketDistributionLabel( { onThisDate, onOtherDates } ) {
	if ( ! onOtherDates ) {
		return '';
	}
	return sprintf(
		/* translators: 1: e.g. "1 ticket on this date", 2: e.g. "1 on another date" */
		__( '%1$s; %2$s', 'fair-events' ),
		sprintf(
			/* translators: %d: number of tickets of the purchase on the date shown */
			_n(
				'%d ticket on this date',
				'%d tickets on this date',
				onThisDate,
				'fair-events'
			),
			onThisDate
		),
		sprintf(
			/* translators: %d: number of tickets of the purchase on other dates */
			_n(
				'%d on another date',
				'%d on other dates',
				onOtherDates,
				'fair-events'
			),
			onOtherDates
		)
	);
}

/**
 * Label naming a ticket within its purchase, e.g. "Ticket 2 (AE2671B5)", for
 * the ticket's actions and exports.
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
 * What the List shows in its Ticket column: the ticket's short reference,
 * e.g. "AE2671B5".
 *
 * @param {Object|null} ticket Ticket of the row, null when not created yet.
 * @return {string} Reference
 */
export function ticketRowReference( ticket ) {
	return ticket?.reference || ticketRowLabel( ticket );
}

/**
 * Whether a registration was paid in test mode, as its transaction recorded
 * it. Only a confirmed classification counts: an unresolved transaction is
 * not flagged.
 *
 * @param {Object} signup Registration returned by the API.
 * @return {boolean} Whether the purchase was a test payment
 */
export function isTestPayment( signup ) {
	return signup?.is_test_payment === true;
}

/**
 * Warning shown beside every ticket of a test-mode purchase, on the List and
 * its printout.
 *
 * @return {string} Warning
 */
export function testPaymentLabel() {
	return __( 'Test payment', 'fair-events' );
}

/**
 * Warning beside a ticket reference of a test-mode purchase: bold, bordered
 * text, so it does not rely on color.
 *
 * @return {Element} Warning
 */
function TestPaymentWarning() {
	return (
		<span
			className="fair-events-signups__test-payment"
			style={ {
				display: 'block',
				width: 'fit-content',
				marginTop: '4px',
				padding: '0 6px',
				border: '2px solid #996800',
				borderRadius: '2px',
				background: '#fcf9e8',
				color: '#1e1e1e',
				fontSize: '12px',
				fontWeight: 700,
				lineHeight: '18px',
				whiteSpace: 'nowrap',
			} }
		>
			{ testPaymentLabel() }
		</span>
	);
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
 * Status of a confirmed signup, as the List and its printout word it.
 *
 * @param {Object} signup Signup row returned by the API.
 * @return {string} Status
 */
export function signupStatusLabel( signup ) {
	return isOverCapacity( signup.over_capacity )
		? __( 'Confirmed — over capacity', 'fair-events' )
		: __( 'Confirmed', 'fair-events' );
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
		return signupStatusLabel( signup );
	}

	const overrides = Array.isArray( signup.overrides ) ? signup.overrides : [];

	return (
		<>
			<span>{ signupStatusLabel( signup ) }</span>{ ' ' }
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
 * State of one extra on one ticket.
 *
 * @param {Object|null} ticket Ticket of the row.
 * @param {Object}      option Extra, as the tickets response lists it.
 * @return {string} One of the EXTRA_* states
 */
export function extraState( ticket, option ) {
	const selected = ticketConfirmedOptionIds( ticket );
	if ( ! selected ) {
		return EXTRA_UNAVAILABLE;
	}
	return selected.includes( Number( option.id ) )
		? EXTRA_SELECTED
		: EXTRA_NOT_SELECTED;
}

/**
 * Mark shown for an extra state. Unselected extras stay empty.
 *
 * @param {string} state One of the EXTRA_* states.
 * @return {string} Mark
 */
export function extraStateSymbol( state ) {
	if ( state === EXTRA_SELECTED ) {
		return '✓';
	}
	return state === EXTRA_NOT_SELECTED ? '' : '?';
}

/**
 * Name of an extra state.
 *
 * @param {string} state One of the EXTRA_* states.
 * @return {string} Label
 */
export function extraStateLabel( state ) {
	if ( state === EXTRA_SELECTED ) {
		return __( 'Selected', 'fair-events' );
	}
	return state === EXTRA_NOT_SELECTED
		? __( 'Not selected', 'fair-events' )
		: __( 'Selection unavailable', 'fair-events' );
}

/**
 * Read-only indicator for one extra on one ticket.
 *
 * @param {Object} props       Component props.
 * @param {string} props.state One of the EXTRA_* states.
 * @return {Element} Indicator
 */
function ExtraIndicator( { state } ) {
	const label = extraStateLabel( state );
	if ( state === EXTRA_SELECTED ) {
		return (
			<span
				role="img"
				aria-label={ label }
				title={ label }
				style={ { fontSize: '1.25em', fontWeight: 600 } }
			>
				{ extraStateSymbol( state ) }
			</span>
		);
	}
	if ( state === EXTRA_NOT_SELECTED ) {
		return (
			<span
				role="img"
				aria-label={ label }
				title={ label }
				// Visually empty, but keeps a hover target for the title.
				style={ { display: 'inline-block', width: '1em' } }
			/>
		);
	}
	return (
		<span
			role="img"
			aria-label={ label }
			title={ label }
			style={ { color: '#757575' } }
		>
			{ extraStateSymbol( state ) }
		</span>
	);
}

/**
 * Data columns of the List, in order. The screen adds its Actions column;
 * the printout uses these as they are.
 *
 * @param {Array} ticketOptions Extras of the event date.
 * @return {Array<{key: string, label: string, isExtra: boolean|undefined}>} Columns
 */
export function listDataColumns( ticketOptions ) {
	return [
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
		{ key: 'mailing', label: __( 'Mailing', 'fair-events' ) },
	];
}

/**
 * Note under the name of a purchase registered for another date than the one
 * listed.
 *
 * @param {Object} signup      Registration returned by the API.
 * @param {number} eventDateId Date the List is showing.
 * @return {string} Note, empty when the purchase is registered for this date
 */
export function registeredForNote( signup, eventDateId ) {
	if (
		! isRegisteredElsewhere( signup, eventDateId ) ||
		! signup.event_date_label
	) {
		return '';
	}
	return sprintf(
		/* translators: %s: event date, e.g. "19:00—22:00, 10 June" */
		__( 'Purchase registered for %s', 'fair-events' ),
		signup.event_date_label
	);
}

/**
 * Mailing consent of a signup, as the List words it.
 *
 * @param {Object} signup Signup row returned by the API.
 * @return {string} "Yes" or "No"
 */
export function mailingLabel( signup ) {
	return isMailingOptIn( signup.mailing_opt_in )
		? __( 'Yes', 'fair-events' )
		: __( 'No', 'fair-events' );
}

/**
 * Mark printed for the mailing consent of a signup. The linked participant's
 * current consent decides, as on the Audience printout; without one, only an
 * explicit opt-in at registration counts, and nothing is read as a refusal.
 *
 * @param {Object} signup Signup row returned by the API.
 * @return {string} "✓" consented, "✗" declined, empty when unspecified
 */
export function printedMailingSymbol( signup ) {
	const consent = signup.newsletter_consent;
	if ( consent === 'granted' ) {
		return '✓';
	}
	if ( consent === 'declined' ) {
		return '✗';
	}
	if ( consent ) {
		return '';
	}
	return isMailingOptIn( signup.mailing_opt_in ) ? '✓' : '';
}

/**
 * Rows of the printed List: the text of every data column of each List row,
 * numbered from 1 in the order given. The mailing column prints the current
 * consent as a mark, not the List's Yes/No.
 *
 * @param {Array}  rows          Rows from expandTicketRows().
 * @param {Array}  ticketOptions Extras of the event date.
 * @param {number} eventDateId   Date the List is showing.
 * @return {Array<{cells: Object, isGroupStart: boolean}>} Printed rows
 */
export function printableListRows( rows, ticketOptions, eventDateId ) {
	return rows.map( ( row, index ) => {
		const { signup, ticket, isFirstTicket } = row;
		const cells = {
			number: { text: index + 1 },
			name: {
				text: signup.name,
				note: registeredForNote( signup, eventDateId ),
			},
			ticket: {
				text: ticketRowReference( ticket ),
				warning: isTestPayment( signup ) ? testPaymentLabel() : '',
			},
			ticket_type: { text: ticketRowTypeName( row ) },
			status: { text: signupStatusLabel( signup ) },
			mailing: { text: printedMailingSymbol( signup ) },
		};
		ticketOptions.forEach( ( opt ) => {
			cells[ `option-${ opt.id }` ] = {
				text: extraStateSymbol( extraState( ticket, opt ) ),
			};
		} );
		return { cells, isGroupStart: isFirstTicket && index > 0 };
	} );
}

/**
 * @param {Object} props
 * @param {number} props.eventDateId       Date the List is showing.
 * @param {number} props.configEventDateId Date holding the ticket types and
 *                                         extras: the series for one of its
 *                                         dates, otherwise the date itself.
 * @param {string} props.eventTitle        Event title, for the printout.
 * @param {string} props.eventDateLabel    Event date, for the printout.
 * @return {Element} List
 */
export default function EventSignups( {
	eventDateId,
	configEventDateId = eventDateId,
	eventTitle = '',
	eventDateLabel = '',
} ) {
	const audienceActive = !! window.fairEventsManageEventData?.audienceUrl;
	const [ signups, setSignups ] = useState( [] );
	// Ticket types and extras of the date; `status` is 'loading', 'ready' or
	// 'error'.
	const [ ticketConfig, setTicketConfig ] = useState( {
		status: 'loading',
		ticketTypes: [],
		options: [],
	} );
	const ticketOptions = ticketConfig.options;
	const [ summaryFeedback, setSummaryFeedback ] = useState( null );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ mailingOnly, setMailingOnly ] = useState( false );
	// Registration awaiting confirmation (null = dialog closed), whether its
	// deletion runs, the last failure and the last success.
	const [ selectedSignup, setSelectedSignup ] = useState( null );
	const [ isDeleting, setIsDeleting ] = useState( false );
	const [ deleteError, setDeleteError ] = useState( null );
	const [ deleteNotice, setDeleteNotice ] = useState( null );
	// Refuses a second confirmation before the first one re-rendered.
	const deleteInFlight = useRef( false );
	// The deleted row took its Delete button along, so focus moves here.
	const listHeadingRef = useRef( null );
	const [ isExportModalOpen, setIsExportModalOpen ] = useState( false );
	const [ printError, setPrintError ] = useState( null );
	// { signup, action } while the move / change-type modal is open.
	const [ editing, setEditing ] = useState( null );
	// Ticket ID while the ticket editor is open.
	const [ editingTicketId, setEditingTicketId ] = useState( null );
	// The last move, type change or ticket edit that went through:
	// { message, leftList } where leftList says the edited row is gone.
	const [ editNotice, setEditNotice ] = useState( null );

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
		if ( deleteNotice || editNotice?.leftList ) {
			listHeadingRef.current?.focus();
		}
	}, [ deleteNotice, editNotice ] );

	const showEditNotice = ( message, leftList = false ) => {
		setDeleteNotice( null );
		setEditNotice( { message, leftList } );
	};

	useEffect( () => {
		setTicketConfig( { status: 'loading', ticketTypes: [], options: [] } );
		setSummaryFeedback( null );
		if ( ! configEventDateId ) {
			return;
		}
		// A response for a date no longer shown must not overwrite this one.
		let current = true;
		// Same source, order and labels as the Audience tab's extra columns.
		apiFetch( {
			path: `/fair-events/v1/event-dates/${ configEventDateId }/tickets`,
		} )
			.then( ( data ) => {
				if ( current ) {
					setTicketConfig( {
						status: 'ready',
						ticketTypes: Array.isArray( data?.ticket_types )
							? data.ticket_types
							: [],
						options: Array.isArray( data?.options )
							? data.options
							: [],
					} );
				}
			} )
			.catch( () => {
				if ( current ) {
					setTicketConfig( {
						status: 'error',
						ticketTypes: [],
						options: [],
					} );
				}
			} );
		return () => {
			current = false;
		};
	}, [ configEventDateId ] );

	if ( loading ) {
		return <Spinner />;
	}

	if ( error ) {
		return <Notice status="error">{ error }</Notice>;
	}

	const headers = [
		...listDataColumns( ticketOptions ),
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
	// The printout is the complete List: screen filters never narrow it.
	const completeRows = expandTicketRows( confirmedSignups );

	const handlePrint = () => {
		const html = buildSignupPrintHtml( {
			title: getEventDisplayTitle( eventTitle ),
			dateLabel: eventDateLabel,
			columns: listDataColumns( ticketOptions ),
			rows: printableListRows( completeRows, ticketOptions, eventDateId ),
			legend: ticketOptions.length
				? [ EXTRA_SELECTED, EXTRA_NOT_SELECTED, EXTRA_UNAVAILABLE ].map(
						( state ) => ( {
							symbol: extraStateSymbol( state ),
							label: extraStateLabel( state ),
						} )
					)
				: [],
			warning: completeRows.some( ( row ) => ! row.ticket )
				? __(
						'Some older registrations are still being split into individual tickets. They are listed as one row for now.',
						'fair-events'
					)
				: '',
			lang: document.documentElement.lang || 'en',
		} );
		setPrintError(
			openPrintWindow( html )
				? null
				: __(
						'Could not open the print window. Allow pop-ups for this site and try again.',
						'fair-events'
					)
		);
	};

	// Copies from the click itself: browsers grant clipboard access only
	// during a user gesture.
	const handleSummary = () => {
		if ( ticketConfig.status !== 'ready' ) {
			setSummaryFeedback( {
				status: 'error',
				message: __(
					'The summary is unavailable because the ticket types and add-ons of this event could not be loaded. Reload this page and try again.',
					'fair-events'
				),
			} );
			return;
		}
		// Every confirmed ticket counts, whatever the screen filters show.
		const summary = buildSignupSummary( {
			rows: completeRows,
			ticketTypes: ticketConfig.ticketTypes,
			options: ticketConfig.options,
		} );
		if ( summary.error ) {
			setSummaryFeedback( {
				status: 'error',
				message: signupSummaryErrorMessage( summary.error ),
			} );
			return;
		}
		const clipboardError = __(
			'Could not copy the summary. Allow this site to use the clipboard and try again.',
			'fair-events'
		);
		if ( ! window.navigator.clipboard?.writeText ) {
			setSummaryFeedback( { status: 'error', message: clipboardError } );
			return;
		}
		setSummaryFeedback( null );
		window.navigator.clipboard
			.writeText( formatSignupSummary( summary ) )
			.then( () =>
				setSummaryFeedback( {
					status: 'success',
					message: __(
						'Summary copied to clipboard.',
						'fair-events'
					),
				} )
			)
			.catch( () =>
				setSummaryFeedback( {
					status: 'error',
					message: clipboardError,
				} )
			);
	};

	const renderRegistrationActions = ( signup ) => {
		const counts = purchaseTicketCounts( signup );
		const distribution = ticketDistributionLabel( counts );
		return (
			<>
				{ counts.confirmed > 1 && (
					<div
						className="fair-events-signups__purchase-scope"
						style={ {
							color: '#757575',
							marginBottom: '4px',
							whiteSpace: 'nowrap',
						} }
					>
						<div>
							{ sprintf(
								/* translators: %d: number of confirmed tickets in the purchase, on every date */
								_n(
									'Entire purchase — %d ticket',
									'Entire purchase — %d tickets',
									counts.confirmed,
									'fair-events'
								),
								counts.confirmed
							) }
						</div>
						{ distribution && <div>{ distribution }</div> }
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
						onClick={ () => openDelete( signup ) }
					>
						{ __( 'Delete', 'fair-events' ) }
					</Button>
				</Flex>
			</>
		);
	};

	const renderRow = ( row, index ) => {
		const { signup, ticket, isFirstTicket } = row;
		const registeredNote = registeredForNote( signup, eventDateId );
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
				<td style={ cellStyle }>
					{ signup.name }
					{ registeredNote && (
						<div
							className="fair-events-signups__registered-for"
							style={ {
								color: '#757575',
								fontSize: '12px',
								whiteSpace: 'nowrap',
							} }
						>
							{ registeredNote }
						</div>
					) }
				</td>
				<td style={ { ...cellStyle, whiteSpace: 'nowrap' } }>
					{ ticketRowReference( ticket ) }
					{ isTestPayment( signup ) && <TestPaymentWarning /> }
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
				<td style={ cellStyle }>
					<SignupStatus signup={ signup } />
				</td>
				<td style={ cellStyle }>{ mailingLabel( signup ) }</td>
				<td style={ cellStyle }>
					{ isFirstTicket && renderRegistrationActions( signup ) }
					{ audienceActive && ticket && (
						<div
							style={
								isFirstTicket ? { marginTop: '4px' } : undefined
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
									ticketRowLabel( ticket )
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

	const deleteCounts = selectedSignup
		? purchaseTicketCounts( selectedSignup )
		: null;

	const openDelete = ( signup ) => {
		setDeleteError( null );
		setSelectedSignup( signup );
	};

	const closeDelete = () => {
		if ( deleteInFlight.current ) {
			return;
		}
		setSelectedSignup( null );
		setDeleteError( null );
	};

	const handleDelete = async () => {
		if ( ! selectedSignup || deleteInFlight.current ) {
			return;
		}

		const signup = selectedSignup;
		deleteInFlight.current = true;
		setIsDeleting( true );
		setDeleteError( null );
		setDeleteNotice( null );
		setEditNotice( null );
		try {
			await apiFetch( {
				path: `/fair-events/v1/get-tickets/${ signup.id }`,
				method: 'DELETE',
			} );
			setSignups( ( current ) =>
				current.filter( ( row ) => row.id !== signup.id )
			);
			setSelectedSignup( null );
			setDeleteNotice(
				sprintf(
					/* translators: %s: registrant name and ticket reference */
					__( 'Registration for %s deleted.', 'fair-events' ),
					signupIdentity( signup )
				)
			);
		} catch ( err ) {
			setDeleteError(
				err?.message ||
					__(
						'The registration could not be deleted. Try again.',
						'fair-events'
					)
			);
		} finally {
			deleteInFlight.current = false;
			setIsDeleting( false );
		}
	};

	return (
		<Card className="fair-events-signups" style={ { marginTop: '16px' } }>
			<CardHeader style={ { flexWrap: 'wrap', gap: '8px' } }>
				<h2 ref={ listHeadingRef } tabIndex={ -1 }>
					{ __( 'List', 'fair-events' ) }
				</h2>
				<Flex
					justify="flex-end"
					gap={ 2 }
					wrap
					style={ { width: 'auto', flex: '1 1 auto' } }
				>
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
							onClick={ handleSummary }
							isBusy={ ticketConfig.status === 'loading' }
							disabled={ ticketConfig.status === 'loading' }
							accessibleWhenDisabled
							description={ __(
								'Copy the number of tickets per ticket type and add-on, without participant details',
								'fair-events'
							) }
						>
							{ __( 'Summary', 'fair-events' ) }
						</Button>
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
					<FlexItem>
						<Button
							variant="secondary"
							onClick={ handlePrint }
							disabled={ completeRows.length === 0 }
						>
							{ __( 'Print list', 'fair-events' ) }
						</Button>
					</FlexItem>
				</Flex>
			</CardHeader>
			<CardBody>
				{ summaryFeedback && (
					<Notice
						status={ summaryFeedback.status }
						onRemove={ () => setSummaryFeedback( null ) }
					>
						{ summaryFeedback.message }
					</Notice>
				) }
				{ printError && (
					<Notice
						status="error"
						onRemove={ () => setPrintError( null ) }
					>
						{ printError }
					</Notice>
				) }
				{ deleteNotice && (
					<Notice
						status="success"
						onRemove={ () => setDeleteNotice( null ) }
					>
						{ deleteNotice }
					</Notice>
				) }
				{ editNotice && (
					<Notice
						status="success"
						onRemove={ () => setEditNotice( null ) }
					>
						{ editNotice.message }
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
						{ completeRows.length === 0
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
			{ selectedSignup && (
				<ConfirmActionModal
					title={ sprintf(
						/* translators: %s: registrant name and ticket reference */
						__( 'Delete registration — %s', 'fair-events' ),
						signupIdentity( selectedSignup )
					) }
					confirmLabel={ __( 'Delete registration', 'fair-events' ) }
					busyLabel={ __( 'Deleting registration…', 'fair-events' ) }
					isDestructive
					isBusy={ isDeleting }
					error={ deleteError }
					onConfirm={ handleDelete }
					onCancel={ closeDelete }
				>
					<>
						<p>
							{ sprintf(
								/* translators: 1: signup name, 2: number of tickets, 3: payment status */
								_n(
									'Delete the registration for %1$s, with its %2$d ticket? Its current payment status is %3$s.',
									'Delete the registration for %1$s, with all %2$d of its tickets? Its current payment status is %3$s.',
									Math.max( deleteCounts.confirmed, 1 ),
									'fair-events'
								),
								selectedSignup.name,
								Math.max( deleteCounts.confirmed, 1 ),
								selectedSignup.status
							) }
						</p>
						{ deleteCounts.onOtherDates > 0 && (
							<p>
								{ sprintf(
									/* translators: 1: number of tickets on the date shown, 2: number of tickets on other dates */
									_n(
										'This deletes the entire purchase on every date: %1$d on this date and %2$d ticket on another date.',
										'This deletes the entire purchase on every date: %1$d on this date and %2$d tickets on other dates.',
										deleteCounts.onOtherDates,
										'fair-events'
									),
									deleteCounts.onThisDate,
									deleteCounts.onOtherDates
								) }
							</p>
						) }
						{ deleteCounts.inactive > 0 && (
							<p>
								{ sprintf(
									/* translators: %d: number of cancelled or otherwise inactive tickets */
									_n(
										'It also removes %d cancelled or otherwise inactive ticket of this purchase.',
										'It also removes %d cancelled or otherwise inactive tickets of this purchase.',
										deleteCounts.inactive,
										'fair-events'
									),
									deleteCounts.inactive
								) }
							</p>
						) }
						<p>
							{ __(
								'This deletion is permanent. It removes only the local signup record and does not refund or cancel any payment-provider transaction.',
								'fair-events'
							) }
						</p>
					</>
				</ConfirmActionModal>
			) }
			{ editing && (
				<SignupEditModal
					signup={ editing.signup }
					action={ editing.action }
					counts={ purchaseTicketCounts( editing.signup ) }
					onClose={ () => setEditing( null ) }
					onSaved={ () => {
						const { signup, action } = editing;
						setEditing( null );
						// A moved registration leaves this date's list.
						showEditNotice(
							action === ACTION_MOVE
								? sprintf(
										/* translators: %s: registrant name and ticket reference */
										__(
											'Registration for %s moved to another date.',
											'fair-events'
										),
										signupIdentity( signup )
									)
								: sprintf(
										/* translators: %s: registrant name and ticket reference */
										__(
											'Ticket type changed for %s.',
											'fair-events'
										),
										signupIdentity( signup )
									),
							action === ACTION_MOVE
						);
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
						showEditNotice( __( 'Ticket saved.', 'fair-events' ) );
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
