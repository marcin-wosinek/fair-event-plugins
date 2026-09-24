/**
 * Event Signups Component
 *
 * List confirmed get-tickets registrations for an event date, with the
 * extras each participant holds. Email addresses and amounts stay out of the
 * table but remain available in exports.
 *
 * @package FairEvents
 */

import { useState, useEffect } from '@wordpress/element';
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
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import SignupExportModal from './SignupExportModal.js';

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
 * Index Fair Audience roster rows by participant: each participant maps to the
 * set of extras they currently hold with a confirmed payment.
 *
 * @param {Array} participants Rows from the Audience participants endpoint.
 * @return {Map<number, Set<number>>} Confirmed option IDs by participant ID
 */
export function buildConfirmedOptionsByParticipant( participants ) {
	const map = new Map();
	( Array.isArray( participants ) ? participants : [] ).forEach( ( p ) => {
		const participantId = Number( p.participant_id );
		if ( ! participantId ) {
			return;
		}
		if ( ! map.has( participantId ) ) {
			map.set( participantId, new Set() );
		}
		( p.confirmed_ticket_option_ids || [] ).forEach( ( id ) =>
			map.get( participantId ).add( Number( id ) )
		);
	} );
	return map;
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

const EXTRA_SELECTED = 'selected';
const EXTRA_NOT_SELECTED = 'not_selected';
const EXTRA_UNAVAILABLE = 'unavailable';

/**
 * Read-only indicator for one extra on one registration.
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
			>
				☑
			</span>
		);
	}
	if ( state === EXTRA_NOT_SELECTED ) {
		return (
			<span
				role="img"
				aria-label={ __( 'Not selected', 'fair-events' ) }
				title={ __( 'Not selected', 'fair-events' ) }
				style={ { color: '#757575' } }
			>
				☐
			</span>
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
	// Null until loaded, and whenever Fair Audience cannot supply selections.
	const [ confirmedOptionsByParticipant, setConfirmedOptionsByParticipant ] =
		useState( null );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ mailingOnly, setMailingOnly ] = useState( false );
	const [ selectedSignup, setSelectedSignup ] = useState( null );
	const [ deleteError, setDeleteError ] = useState( null );
	const [ isExportModalOpen, setIsExportModalOpen ] = useState( false );

	useEffect( () => {
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

	useEffect( () => {
		if ( ! eventDateId || ! audienceActive ) {
			return;
		}
		apiFetch( {
			path: `/fair-audience/v1/event-dates/${ eventDateId }/participants`,
		} )
			.then( ( data ) =>
				setConfirmedOptionsByParticipant(
					buildConfirmedOptionsByParticipant( data )
				)
			)
			.catch( () => setConfirmedOptionsByParticipant( null ) );
	}, [ eventDateId, audienceActive ] );

	if ( loading ) {
		return <Spinner />;
	}

	if ( error ) {
		return <Notice status="error">{ error }</Notice>;
	}

	const headers = [
		{ key: 'number', label: '#' },
		{ key: 'name', label: __( 'Name', 'fair-events' ) },
		{ key: 'ticket_type', label: __( 'Ticket Type', 'fair-events' ) },
		{ key: 'quantity', label: __( 'Qty', 'fair-events' ) },
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

	const confirmedSignups = signups.filter( isConfirmedSignup );
	const visibleSignups = mailingOnly
		? confirmedSignups.filter( ( s ) => isMailingOptIn( s.mailing_opt_in ) )
		: confirmedSignups;

	const extraState = ( signup, option ) => {
		const selected =
			confirmedOptionsByParticipant &&
			confirmedOptionsByParticipant.get(
				Number( signup.participant_id )
			);
		if ( ! selected ) {
			return EXTRA_UNAVAILABLE;
		}
		return selected.has( Number( option.id ) )
			? EXTRA_SELECTED
			: EXTRA_NOT_SELECTED;
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
							disabled={ visibleSignups.length === 0 }
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
				{ ticketOptions.length > 0 && ! audienceActive && (
					<Notice status="info" isDismissible={ false }>
						{ __(
							'Selected extras are shown only when Fair Audience is active.',
							'fair-events'
						) }
					</Notice>
				) }
				{ visibleSignups.length === 0 ? (
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
							<tbody>
								{ visibleSignups.map( ( s, index ) => (
									<tr key={ s.id }>
										<td
											style={ {
												...cellStyle,
												textAlign: 'right',
											} }
										>
											{ index + 1 }
										</td>
										<td style={ cellStyle }>{ s.name }</td>
										<td style={ cellStyle }>
											{ s.ticket_type_name || '—' }
										</td>
										<td style={ cellStyle }>
											{ s.quantity }
										</td>
										{ ticketOptions.map( ( opt ) => (
											<td
												key={ opt.id }
												style={ {
													...cellStyle,
													textAlign: 'center',
												} }
											>
												<ExtraIndicator
													state={ extraState(
														s,
														opt
													) }
												/>
											</td>
										) ) }
										<td style={ cellStyle }>
											{ isOverCapacity( s.over_capacity )
												? __(
														'Confirmed — over capacity',
														'fair-events'
												  )
												: __(
														'Confirmed',
														'fair-events'
												  ) }
										</td>
										<td style={ cellStyle }>
											{ s.transaction_id &&
											connectorActive ? (
												<a
													href={ `admin.php?page=fair-payments-connector-transaction&transaction_id=${ s.transaction_id }` }
												>
													{ s.transaction_id }
												</a>
											) : (
												s.transaction_id || '—'
											) }
										</td>
										<td style={ cellStyle }>
											{ isMailingOptIn( s.mailing_opt_in )
												? __( 'Yes', 'fair-events' )
												: __( 'No', 'fair-events' ) }
										</td>
										<td style={ cellStyle }>
											{ s.created_at }
										</td>
										<td style={ cellStyle }>
											<Button
												variant="link"
												isDestructive
												onClick={ () =>
													setSelectedSignup( s )
												}
											>
												{ __(
													'Delete',
													'fair-events'
												) }
											</Button>
										</td>
									</tr>
								) ) }
							</tbody>
						</table>
					</div>
				) }
			</CardBody>
			<ConfirmDialog
				isOpen={ !! selectedSignup }
				onConfirm={ handleDelete }
				onCancel={ () => setSelectedSignup( null ) }
				confirmButtonText={ __( 'Delete signup', 'fair-events' ) }
				cancelButtonText={ __( 'Cancel', 'fair-events' ) }
			>
				{ selectedSignup && (
					<>
						<p>
							{ sprintf(
								/* translators: 1: signup name, 2: payment status */
								__(
									'Delete the signup for %1$s? Its current payment status is %2$s.',
									'fair-events'
								),
								selectedSignup.name,
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
			{ isExportModalOpen && (
				<SignupExportModal
					eventDateId={ eventDateId }
					rows={ visibleSignups }
					onClose={ () => setIsExportModalOpen( false ) }
				/>
			) }
		</Card>
	);
}
