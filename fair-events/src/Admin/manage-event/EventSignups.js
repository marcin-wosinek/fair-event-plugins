/**
 * Event Signups Component
 *
 * List and manage get-tickets signups for an event date.
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

const CSV_COLUMNS = [
	'email',
	'name',
	'ticket_type',
	'quantity',
	'amount',
	'status',
	'transaction_id',
	'mailing_opt_in',
	'date',
];

/**
 * Escape a single CSV field per RFC 4180.
 *
 * @param {*} value
 * @return {string} Escaped field
 */
function escapeCsvField( value ) {
	const stringValue =
		value === null || value === undefined ? '' : String( value );
	if ( /[",\r\n]/.test( stringValue ) ) {
		return `"${ stringValue.replace( /"/g, '""' ) }"`;
	}
	return stringValue;
}

/**
 * Build the MailerLite-friendly CSV text for the given signups.
 *
 * @param {Array} rows
 * @return {string} CSV text
 */
function buildSignupsCsv( rows ) {
	const lines = [ CSV_COLUMNS.join( ',' ) ];
	rows.forEach( ( s ) => {
		const row = [
			s.email,
			s.name,
			s.ticket_type_name || '—',
			s.quantity,
			s.amount,
			s.status,
			s.transaction_id,
			s.mailing_opt_in ? 'yes' : 'no',
			s.created_at,
		];
		lines.push( row.map( escapeCsvField ).join( ',' ) );
	} );
	return lines.join( '\r\n' );
}

/**
 * Trigger a client-side download of the given text as a file.
 *
 * @param {string} text
 * @param {string} filename
 */
function downloadTextFile( text, filename ) {
	const blob = new Blob( [ text ], { type: 'text/csv;charset=utf-8' } );
	const url = URL.createObjectURL( blob );
	const link = document.createElement( 'a' );
	link.href = url;
	link.download = filename;
	link.click();
	URL.revokeObjectURL( url );
}

export default function EventSignups( { eventDateId } ) {
	const connectorActive = !! window.fairPaymentsConnector?.connectorActive;
	const [ signups, setSignups ] = useState( [] );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ mailingOnly, setMailingOnly ] = useState( false );
	const [ selectedSignup, setSelectedSignup ] = useState( null );
	const [ deleteError, setDeleteError ] = useState( null );

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

	if ( loading ) {
		return <Spinner />;
	}

	if ( error ) {
		return <Notice status="error">{ error }</Notice>;
	}

	const headers = [
		__( 'Name', 'fair-events' ),
		__( 'Email', 'fair-events' ),
		__( 'Ticket Type', 'fair-events' ),
		__( 'Qty', 'fair-events' ),
		__( 'Amount', 'fair-events' ),
		__( 'Status', 'fair-events' ),
		__( 'Transaction', 'fair-events' ),
		__( 'Mailing', 'fair-events' ),
		__( 'Date', 'fair-events' ),
		__( 'Actions', 'fair-events' ),
	];

	const visibleSignups = mailingOnly
		? signups.filter( ( s ) => s.mailing_opt_in )
		: signups;

	const handleDownloadCsv = () => {
		const csv = buildSignupsCsv( visibleSignups );
		downloadTextFile( csv, `signups-event-${ eventDateId }.csv` );
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
		<Card style={ { marginTop: '16px' } }>
			<CardHeader>
				<h2>{ __( 'Ticket Signups', 'fair-events' ) }</h2>
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
							onClick={ handleDownloadCsv }
							disabled={ visibleSignups.length === 0 }
						>
							{ __( 'Download CSV', 'fair-events' ) }
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
				{ visibleSignups.length === 0 ? (
					<p>
						{ signups.length === 0
							? __( 'No signups yet.', 'fair-events' )
							: __(
									'Nothing to export — no signups match the current filter.',
									'fair-events'
							  ) }
					</p>
				) : (
					<table
						style={ { width: '100%', borderCollapse: 'collapse' } }
					>
						<thead>
							<tr>
								{ headers.map( ( h ) => (
									<th
										key={ h }
										style={ {
											textAlign: 'left',
											padding: '8px',
											borderBottom: '1px solid #ddd',
										} }
									>
										{ h }
									</th>
								) ) }
							</tr>
						</thead>
						<tbody>
							{ visibleSignups.map( ( s ) => (
								<tr key={ s.id }>
									<td
										style={ {
											padding: '8px',
											borderBottom: '1px solid #eee',
										} }
									>
										{ s.name }
									</td>
									<td
										style={ {
											padding: '8px',
											borderBottom: '1px solid #eee',
										} }
									>
										{ s.email }
									</td>
									<td
										style={ {
											padding: '8px',
											borderBottom: '1px solid #eee',
										} }
									>
										{ s.ticket_type_name || '—' }
									</td>
									<td
										style={ {
											padding: '8px',
											borderBottom: '1px solid #eee',
										} }
									>
										{ s.quantity }
									</td>
									<td
										style={ {
											padding: '8px',
											borderBottom: '1px solid #eee',
										} }
									>
										{ s.amount }
									</td>
									<td
										style={ {
											padding: '8px',
											borderBottom: '1px solid #eee',
										} }
									>
										{ s.status === 'confirmed' &&
										s.over_capacity
											? __(
													'Confirmed — over capacity',
													'fair-events'
											  )
											: s.status === 'confirmed'
											? __( 'Confirmed', 'fair-events' )
											: s.status === 'expired'
											? __( 'Expired', 'fair-events' )
											: s.status }
									</td>
									<td
										style={ {
											padding: '8px',
											borderBottom: '1px solid #eee',
										} }
									>
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
									<td
										style={ {
											padding: '8px',
											borderBottom: '1px solid #eee',
										} }
									>
										{ s.mailing_opt_in
											? __( 'Yes', 'fair-events' )
											: __( 'No', 'fair-events' ) }
									</td>
									<td
										style={ {
											padding: '8px',
											borderBottom: '1px solid #eee',
										} }
									>
										{ s.created_at }
									</td>
									<td
										style={ {
											padding: '8px',
											borderBottom: '1px solid #eee',
										} }
									>
										<Button
											variant="link"
											isDestructive
											onClick={ () =>
												setSelectedSignup( s )
											}
										>
											{ __( 'Delete', 'fair-events' ) }
										</Button>
									</td>
								</tr>
							) ) }
						</tbody>
					</table>
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
								/* translators: 1: signup name, 2: signup email, 3: payment status */
								__(
									'Delete the signup for %1$s (%2$s)? Its current payment status is %3$s.',
									'fair-events'
								),
								selectedSignup.name,
								selectedSignup.email,
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
		</Card>
	);
}
