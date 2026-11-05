/**
 * Reconcile one reported record: link its payment to purchases, split a
 * shared payment, remove a link added here, or mark it as reviewed.
 *
 * Everything the decision depends on lives in this component's state: the
 * loaded context, the allocation rows, the note and the request phase. The
 * buttons and messages are derived from it.
 *
 * @package FairEvents
 */

import { __, sprintf } from '@wordpress/i18n';
import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	ComboboxControl,
	Modal,
	Notice,
	SelectControl,
	Spinner,
	TextControl,
	TextareaControl,
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import {
	attributionLabels,
	findingStatusLabels,
	purchaseStatusLabels,
	reasonLabels,
	roleLabels,
	transactionStatusLabels,
} from './labels.js';
import {
	formatAmount,
	formatEventDate,
	formatPurchase,
	formatUtcDateTime,
	toCents,
} from './format.js';

const LINK_ROLES = [ 'charge', 'additional_charge', 'upgrade' ];

let rowKey = 0;

/**
 * A new allocation row.
 *
 * @param {Object} values signupId, role, amount.
 * @return {Object} Row.
 */
function newRow( values = {} ) {
	rowKey += 1;
	return {
		key: rowKey,
		signupId: values.signupId ? String( values.signupId ) : '',
		role: values.role || 'charge',
		amount: values.amount !== undefined ? String( values.amount ) : '',
	};
}

/**
 * The rows a finding starts with: the purchases its evidence proposed, or
 * one row for the whole remaining balance.
 *
 * @param {Object} context Finding context.
 * @return {Object[]} Rows.
 */
export function initialRows( context ) {
	const { finding } = context;
	let role = 'charge';
	if ( finding.reason === 'ambiguous_activity_charge' ) {
		role = 'additional_charge';
	} else if ( finding.reason === 'ambiguous_upgrade' ) {
		role = 'upgrade';
	}
	const proposed = finding.detail?.proposed || [];
	if ( proposed.length ) {
		return proposed.map( ( link ) =>
			newRow( {
				signupId: link.signup_id,
				role: link.role || role,
				amount: link.allocated_amount,
			} )
		);
	}
	return [
		newRow( {
			role,
			amount:
				context.remaining !== null && context.remaining !== undefined
					? Number( context.remaining ).toFixed( 2 )
					: '',
		} ),
	];
}

/**
 * Why the allocation can't be saved yet, or null when it can.
 *
 * @param {Object[]} rows      Rows.
 * @param {number}   remaining Amount left on the payment.
 * @param {string}   currency  Currency.
 * @return {string|null} Reason.
 */
export function allocationProblem( rows, remaining, currency ) {
	if ( rows.length === 0 ) {
		return __( 'Add at least one purchase.', 'fair-events' );
	}
	const seen = new Set();
	let sum = 0;
	for ( const row of rows ) {
		if ( ! row.signupId ) {
			return __( 'Choose a purchase in every row.', 'fair-events' );
		}
		const cents = toCents( row.amount );
		if ( row.amount === '' || Number.isNaN( cents ) || cents < 0 ) {
			return __(
				'Enter an amount of zero or more in every row.',
				'fair-events'
			);
		}
		const key = `${ row.signupId }:${ row.role }`;
		if ( seen.has( key ) ) {
			return __(
				'The same purchase is listed twice with the same role.',
				'fair-events'
			);
		}
		seen.add( key );
		sum += cents;
	}
	if ( sum > toCents( remaining ) ) {
		return sprintf(
			/* translators: 1: total of the entered amounts, 2: amount left on the payment */
			__(
				'The amounts add up to %1$s, more than the %2$s left on this payment.',
				'fair-events'
			),
			formatAmount( sum / 100, currency ),
			formatAmount( remaining, currency )
		);
	}
	return null;
}

/**
 * Message of a failed request.
 *
 * @param {Object} e Error from apiFetch.
 * @return {string} Message.
 */
function errorMessage( e ) {
	return (
		e?.message ||
		__(
			'The decision couldn’t be saved. Check your connection and try again.',
			'fair-events'
		)
	);
}

/**
 * The payment the record is about.
 *
 * @param {Object} props
 * @param {Object} props.context Finding context.
 * @return {JSX.Element|null} Summary.
 */
function TransactionSummary( { context } ) {
	const { transaction } = context;
	if ( context.payment_information === 'unavailable' ) {
		return (
			<Notice status="warning" isDismissible={ false }>
				{ __(
					'Payment information can’t be read because Fair Payments Connector is inactive or not installed.',
					'fair-events'
				) }
			</Notice>
		);
	}
	if ( ! transaction ) {
		return null;
	}
	if ( transaction.missing ) {
		return (
			<Notice status="warning" isDismissible={ false }>
				{ sprintf(
					/* translators: %d: payment number */
					__(
						'Payment #%d no longer exists in Fair Payments Connector.',
						'fair-events'
					),
					transaction.id
				) }
			</Notice>
		);
	}
	const statuses = transactionStatusLabels();
	const hints = transaction.hints || {};
	return (
		<dl className="fair-events-payment-history__facts">
			<dt>{ __( 'Payment', 'fair-events' ) }</dt>
			<dd>
				{ sprintf(
					/* translators: 1: payment number, 2: amount, 3: payment status */
					__( '#%1$d — %2$s, %3$s', 'fair-events' ),
					transaction.id,
					formatAmount( transaction.amount, transaction.currency ),
					statuses[ transaction.status ] ?? transaction.status
				) }
			</dd>
			<dt>{ __( 'Created', 'fair-events' ) }</dt>
			<dd>{ formatUtcDateTime( transaction.created_at ) }</dd>
			{ transaction.description && (
				<>
					<dt>{ __( 'Description', 'fair-events' ) }</dt>
					<dd>{ transaction.description }</dd>
				</>
			) }
			{ transaction.line_items?.length > 0 && (
				<>
					<dt>{ __( 'Line items', 'fair-events' ) }</dt>
					<dd>
						<ul className="fair-events-payment-history__list">
							{ transaction.line_items.map( ( line, index ) => (
								<li key={ index }>
									{ sprintf(
										/* translators: 1: quantity, 2: item name, 3: line total */
										__(
											'%1$d × %2$s: %3$s',
											'fair-events'
										),
										line.quantity,
										line.name,
										formatAmount(
											line.total_amount,
											transaction.currency
										)
									) }
								</li>
							) ) }
						</ul>
					</dd>
				</>
			) }
			{ ( hints.signup_ids?.length > 0 ||
				hints.event_participant_ids?.length > 0 ||
				hints.retry_of ) && (
				<>
					<dt>{ __( 'Its records mention', 'fair-events' ) }</dt>
					<dd>
						{ [
							hints.signup_ids?.length
								? sprintf(
										/* translators: %s: comma-separated purchase numbers */
										__( 'purchases %s', 'fair-events' ),
										hints.signup_ids
											.map( ( id ) => `#${ id }` )
											.join( ', ' )
									)
								: null,
							hints.event_participant_ids?.length
								? sprintf(
										/* translators: %s: comma-separated registration numbers */
										__( 'registrations %s', 'fair-events' ),
										hints.event_participant_ids
											.map( ( id ) => `#${ id }` )
											.join( ', ' )
									)
								: null,
							hints.retry_of
								? sprintf(
										/* translators: %d: payment number */
										__(
											'a retry of payment #%d',
											'fair-events'
										),
										hints.retry_of
									)
								: null,
						]
							.filter( Boolean )
							.join( '; ' ) }
					</dd>
				</>
			) }
		</dl>
	);
}

/**
 * Dialog for one finding.
 *
 * @param {Object}   props
 * @param {number}   props.findingId Finding ID.
 * @param {Function} props.onClose   Close the dialog.
 * @param {Function} props.onDecided Called with a result message after a decision.
 * @return {JSX.Element} Dialog.
 */
export default function FindingModal( { findingId, onClose, onDecided } ) {
	const [ context, setContext ] = useState( null );
	const [ loadError, setLoadError ] = useState( null );
	const [ rows, setRows ] = useState( [] );
	const [ note, setNote ] = useState( '' );
	const [ pending, setPending ] = useState( null );
	const [ error, setError ] = useState( null );
	const [ stale, setStale ] = useState( false );
	const [ removing, setRemoving ] = useState( null );
	const [ removedMessage, setRemovedMessage ] = useState( null );
	const [ searchResults, setSearchResults ] = useState( [] );
	const busy = useRef( false );
	const searchTimer = useRef( null );

	const load = useCallback(
		( keepInputs = false ) =>
			apiFetch( {
				path: `/fair-events/v1/payment-history/findings/${ findingId }`,
			} )
				.then( ( data ) => {
					setContext( data );
					setLoadError( null );
					setStale( false );
					if ( ! keepInputs ) {
						setRows( initialRows( data ) );
					}
				} )
				.catch( ( e ) =>
					setLoadError(
						e?.message ||
							__(
								'This record couldn’t be loaded.',
								'fair-events'
							)
					)
				),
		[ findingId ]
	);

	useEffect( () => {
		load();
		return () => clearTimeout( searchTimer.current );
	}, [ load ] );

	const submit = async ( key, request, onSuccess ) => {
		if ( busy.current ) {
			return;
		}
		busy.current = true;
		setPending( key );
		setError( null );
		setRemovedMessage( null );
		try {
			const result = await apiFetch( request );
			await onSuccess( result );
		} catch ( e ) {
			setError( errorMessage( e ) );
			setStale( e?.code === 'reconciliation_stale' );
		} finally {
			busy.current = false;
			setPending( null );
		}
	};

	const close = () => {
		if ( ! pending ) {
			onClose();
		}
	};

	const reasons = reasonLabels();
	const statuses = findingStatusLabels();
	const roles = roleLabels();
	const attributions = attributionLabels();

	if ( ! context ) {
		return (
			<Modal
				title={ __( 'Review record', 'fair-events' ) }
				onRequestClose={ onClose }
				className="fair-events-payment-history__modal"
			>
				{ loadError ? (
					<Notice status="error" isDismissible={ false }>
						{ loadError }
					</Notice>
				) : (
					<Spinner />
				) }
			</Modal>
		);
	}

	const { finding, transaction } = context;
	const currency = transaction?.currency || '';
	const expectedLinkIds = context.links.map( ( link ) => link.id );
	const reason = reasons[ finding.reason ];
	const isOpen = finding.status === 'open';
	const problem = context.can_link
		? allocationProblem( rows, context.remaining ?? 0, currency )
		: null;
	const noteMissing = note.trim() === '';

	const purchases = new Map();
	[ ...context.candidates, ...searchResults ].forEach( ( purchase ) =>
		purchases.set( String( purchase.id ), purchase )
	);
	context.links.forEach( ( link ) => {
		if ( link.purchase ) {
			purchases.set( String( link.purchase.id ), link.purchase );
		}
	} );
	const options = [ ...purchases.values() ].map( ( purchase ) => ( {
		value: String( purchase.id ),
		label: `${ formatPurchase( purchase ) } · ${ formatEventDate(
			purchase.event_date
		) }`,
	} ) );

	const search = ( value ) => {
		clearTimeout( searchTimer.current );
		if ( ! value || value.length < 2 ) {
			return;
		}
		searchTimer.current = setTimeout( () => {
			apiFetch( {
				path: `/fair-events/v1/payment-history/purchases?${ new URLSearchParams(
					{ search: value }
				) }`,
			} )
				.then( ( results ) =>
					setSearchResults( Array.isArray( results ) ? results : [] )
				)
				.catch( () => setSearchResults( [] ) );
		}, 300 );
	};

	const updateRow = ( key, changes ) =>
		setRows( ( current ) =>
			current.map( ( row ) =>
				row.key === key ? { ...row, ...changes } : row
			)
		);

	const link = () =>
		submit(
			'link',
			{
				path: `/fair-events/v1/payment-history/findings/${ finding.id }/links`,
				method: 'POST',
				data: {
					note,
					expected_link_ids: expectedLinkIds,
					links: rows.map( ( row ) => ( {
						signup_id: Number( row.signupId ),
						role: row.role,
						allocated_amount: Number( row.amount ),
					} ) ),
				},
			},
			() => {
				onDecided(
					sprintf(
						/* translators: %d: payment number */
						__( 'Payment #%d was linked.', 'fair-events' ),
						transaction?.id ?? finding.source_id
					)
				);
			}
		);

	const review = () =>
		submit(
			'review',
			{
				path: `/fair-events/v1/payment-history/findings/${ finding.id }/review`,
				method: 'POST',
				data: { note },
			},
			() => {
				onDecided(
					sprintf(
						/* translators: %s: reason the record was reported */
						__(
							'“%s” was marked as reviewed. It won’t be reported again.',
							'fair-events'
						),
						reason?.label ?? finding.reason
					)
				);
			}
		);

	const removeLink = () =>
		submit(
			'remove',
			{
				path: `/fair-events/v1/payment-history/links/${ removing.id }`,
				method: 'DELETE',
				data: { note, expected_link_ids: expectedLinkIds },
			},
			async () => {
				const removed = removing;
				setRemoving( null );
				setNote( '' );
				await load();
				setRemovedMessage(
					sprintf(
						/* translators: 1: purchase, 2: amount */
						__(
							'The link to %1$s for %2$s was removed.',
							'fair-events'
						),
						formatPurchase( removed.purchase ),
						formatAmount(
							removed.allocated_amount,
							removed.currency
						)
					)
				);
				onDecided( null );
			}
		);

	const title = sprintf(
		/* translators: %s: reason the record was reported */
		__( 'Review record — %s', 'fair-events' ),
		reason?.label ?? finding.reason
	);

	return (
		<Modal
			title={ title }
			onRequestClose={ close }
			isDismissible={ ! pending }
			shouldCloseOnEsc={ ! pending }
			shouldCloseOnClickOutside={ ! pending }
			size="large"
			className="fair-events-payment-history__modal"
		>
			<VStack spacing={ 4 }>
				<p>{ reason?.description }</p>
				<dl className="fair-events-payment-history__facts">
					<dt>{ __( 'Event', 'fair-events' ) }</dt>
					<dd>{ formatEventDate( finding.event_date ) }</dd>
					<dt>{ __( 'Status', 'fair-events' ) }</dt>
					<dd>{ statuses[ finding.status ] ?? finding.status }</dd>
				</dl>

				<TransactionSummary context={ context } />

				{ context.transaction_id && (
					<div>
						<h3>{ __( 'Linked purchases', 'fair-events' ) }</h3>
						{ context.links.length === 0 ? (
							<p>
								{ __(
									'This payment isn’t linked to any purchase.',
									'fair-events'
								) }
							</p>
						) : (
							<ul className="fair-events-payment-history__links">
								{ context.links.map( ( item ) => (
									<li key={ item.id }>
										<span>
											{ sprintf(
												/* translators: 1: purchase, 2: event and date, 3: amount, 4: role, 5: who recorded the link */
												__(
													'%1$s · %2$s — %3$s (%4$s, %5$s)',
													'fair-events'
												),
												formatPurchase( item.purchase ),
												formatEventDate(
													item.purchase?.event_date
												),
												formatAmount(
													item.allocated_amount,
													item.currency
												),
												roles[ item.role ] ?? item.role,
												attributions[
													item.attribution
												] ?? item.attribution
											) }
										</span>
										{ item.removable && (
											<Button
												variant="link"
												isDestructive
												disabled={ !! pending }
												onClick={ () => {
													setRemoving( item );
													setError( null );
													setRemovedMessage( null );
												} }
											>
												{ __(
													'Remove link',
													'fair-events'
												) }
											</Button>
										) }
									</li>
								) ) }
							</ul>
						) }
						{ transaction && ! transaction.missing && (
							<p>
								{ sprintf(
									/* translators: 1: amount already linked, 2: payment total, 3: amount left */
									__(
										'Linked: %1$s of %2$s. Left: %3$s.',
										'fair-events'
									),
									formatAmount( context.allocated, currency ),
									formatAmount(
										transaction.amount,
										currency
									),
									formatAmount( context.remaining, currency )
								) }
							</p>
						) }
					</div>
				) }

				{ removedMessage && (
					<Notice status="success" isDismissible={ false }>
						{ removedMessage }
					</Notice>
				) }

				{ removing ? (
					<div
						className="fair-events-payment-history__decision"
						role="group"
						aria-label={ __( 'Remove link', 'fair-events' ) }
					>
						<h3>
							{ sprintf(
								/* translators: %s: purchase */
								__( 'Remove the link to %s?', 'fair-events' ),
								formatPurchase( removing.purchase )
							) }
						</h3>
						<p>
							{ sprintf(
								/* translators: 1: amount, 2: payment number */
								__(
									'%1$s of payment #%2$d will no longer count for this purchase. The payment itself isn’t changed or refunded. If no other link added here remains, the record needs a decision again.',
									'fair-events'
								),
								formatAmount(
									removing.allocated_amount,
									removing.currency
								),
								removing.transaction_id
							) }
						</p>
						<TextareaControl
							__nextHasNoMarginBottom
							label={ __(
								'Why are you removing it? (required)',
								'fair-events'
							) }
							value={ note }
							onChange={ setNote }
							disabled={ !! pending }
						/>
						{ error && (
							<Notice status="error" isDismissible={ false }>
								{ error }
							</Notice>
						) }
						<HStack justify="flex-end" spacing={ 3 } wrap>
							<Button
								variant="tertiary"
								disabled={ !! pending }
								onClick={ () => {
									setRemoving( null );
									setError( null );
								} }
							>
								{ __( 'Cancel', 'fair-events' ) }
							</Button>
							<Button
								variant="primary"
								isDestructive
								isBusy={ pending === 'remove' }
								disabled={ !! pending || noteMissing }
								accessibleWhenDisabled
								onClick={ removeLink }
							>
								{ pending === 'remove'
									? __( 'Removing…', 'fair-events' )
									: __( 'Remove link', 'fair-events' ) }
							</Button>
						</HStack>
					</div>
				) : (
					isOpen && (
						<div className="fair-events-payment-history__decision">
							{ context.can_link && (
								<>
									<h3>
										{ __(
											'Link this payment',
											'fair-events'
										) }
									</h3>
									<p className="fair-events-payment-history__hint">
										{ __(
											'Choose the purchase this payment was for. To split a shared payment, add a row per purchase. Only linked amounts count as revenue.',
											'fair-events'
										) }
									</p>
									{ rows.map( ( row, index ) => {
										const chosen = purchases.get(
											row.signupId
										);
										return (
											<div
												key={ row.key }
												className="fair-events-payment-history__row"
											>
												<ComboboxControl
													__nextHasNoMarginBottom
													__next40pxDefaultSize
													label={ sprintf(
														/* translators: %d: row number */
														__(
															'Purchase %d',
															'fair-events'
														),
														index + 1
													) }
													help={
														chosen
															? sprintf(
																	/* translators: 1: purchase amount, 2: purchase status */
																	__(
																		'Purchase amount: %1$s. Status: %2$s.',
																		'fair-events'
																	),
																	formatAmount(
																		chosen.amount,
																		currency
																	),
																	purchaseStatusLabels()[
																		chosen
																			.status
																	] ??
																		chosen.status
																)
															: __(
																	'Search by name, email or purchase number.',
																	'fair-events'
																)
													}
													value={ row.signupId }
													options={ options }
													onFilterValueChange={
														search
													}
													onChange={ ( value ) =>
														updateRow( row.key, {
															signupId:
																value || '',
														} )
													}
													disabled={ !! pending }
												/>
												<SelectControl
													__nextHasNoMarginBottom
													__next40pxDefaultSize
													label={ __(
														'For',
														'fair-events'
													) }
													value={ row.role }
													options={ LINK_ROLES.map(
														( value ) => ( {
															value,
															label: roles[
																value
															],
														} )
													) }
													onChange={ ( value ) =>
														updateRow( row.key, {
															role: value,
														} )
													}
													disabled={ !! pending }
												/>
												<TextControl
													__nextHasNoMarginBottom
													__next40pxDefaultSize
													type="number"
													min="0"
													step="0.01"
													label={ sprintf(
														/* translators: %s: currency code */
														__(
															'Amount (%s)',
															'fair-events'
														),
														currency
													) }
													value={ row.amount }
													onChange={ ( value ) =>
														updateRow( row.key, {
															amount: value,
														} )
													}
													disabled={ !! pending }
												/>
												{ rows.length > 1 && (
													<Button
														variant="link"
														isDestructive
														disabled={ !! pending }
														onClick={ () =>
															setRows(
																rows.filter(
																	( r ) =>
																		r.key !==
																		row.key
																)
															)
														}
													>
														{ __(
															'Remove row',
															'fair-events'
														) }
													</Button>
												) }
											</div>
										);
									} ) }
									<Button
										variant="secondary"
										disabled={ !! pending }
										onClick={ () =>
											setRows( [
												...rows,
												newRow( {
													role: rows[ 0 ]?.role,
												} ),
											] )
										}
									>
										{ __(
											'Add another purchase',
											'fair-events'
										) }
									</Button>
								</>
							) }
							{ ! context.can_link &&
								context.link_refusal ===
									'finding_not_linkable' && (
									<p>
										{ __(
											'There is no payment here to link. If you’ve checked the record, mark it as reviewed.',
											'fair-events'
										) }
									</p>
								) }
							{ ! context.can_link &&
								context.link_refusal ===
									'payment_information_unavailable' && (
									<p>
										{ __(
											'Linking needs Fair Payments Connector to be active. You can still mark the record as reviewed.',
											'fair-events'
										) }
									</p>
								) }
							<TextareaControl
								__nextHasNoMarginBottom
								label={ __(
									'Note for the audit log (required)',
									'fair-events'
								) }
								help={ __(
									'Say what you checked and why you decided this way. It’s kept with your name and the time.',
									'fair-events'
								) }
								value={ note }
								onChange={ setNote }
								disabled={ !! pending }
							/>
							{ error && (
								<Notice status="error" isDismissible={ false }>
									<p>{ error }</p>
									{ stale && (
										<Button
											variant="secondary"
											onClick={ () => load( true ) }
										>
											{ __(
												'Reload this record',
												'fair-events'
											) }
										</Button>
									) }
								</Notice>
							) }
							{ ( problem || noteMissing ) && (
								<p className="fair-events-payment-history__hint">
									{ problem ||
										__(
											'Enter a note to record your decision.',
											'fair-events'
										) }
								</p>
							) }
							<HStack justify="flex-end" spacing={ 3 } wrap>
								<Button
									variant="tertiary"
									disabled={ !! pending }
									onClick={ close }
								>
									{ __( 'Cancel', 'fair-events' ) }
								</Button>
								<Button
									variant="secondary"
									isBusy={ pending === 'review' }
									disabled={ !! pending || noteMissing }
									accessibleWhenDisabled
									onClick={ review }
								>
									{ pending === 'review'
										? __( 'Saving…', 'fair-events' )
										: __(
												'Mark as reviewed, no link',
												'fair-events'
											) }
								</Button>
								{ context.can_link && (
									<Button
										variant="primary"
										isBusy={ pending === 'link' }
										disabled={
											!! pending ||
											noteMissing ||
											!! problem
										}
										accessibleWhenDisabled
										onClick={ link }
									>
										{ pending === 'link'
											? __( 'Linking…', 'fair-events' )
											: __(
													'Link payment',
													'fair-events'
												) }
									</Button>
								) }
							</HStack>
						</div>
					)
				) }

				{ ! isOpen && ! removing && (
					<p>
						{ finding.status === 'reconciled' ||
						finding.status === 'reviewed'
							? __(
									'An administrator already decided this record. The audit log below shows who and why.',
									'fair-events'
								)
							: __(
									'A later pass of the migration resolved this record. Nothing needs deciding.',
									'fair-events'
								) }
					</p>
				) }

				{ context.audit.length > 0 && (
					<div>
						<h3>{ __( 'Audit log', 'fair-events' ) }</h3>
						<ul className="fair-events-payment-history__list">
							{ context.audit.map( ( entry ) => (
								<li key={ entry.id }>
									{ sprintf(
										/* translators: 1: date and time, 2: action, 3: user name, 4: note */
										__(
											'%1$s — %2$s by %3$s: “%4$s”',
											'fair-events'
										),
										formatUtcDateTime( entry.created_at ),
										{
											link: __( 'linked', 'fair-events' ),
											unlink: __(
												'removed a link',
												'fair-events'
											),
											review: __(
												'marked as reviewed',
												'fair-events'
											),
										}[ entry.action ] ?? entry.action,
										entry.user_name ||
											sprintf(
												/* translators: %d: user ID */
												__( 'user #%d', 'fair-events' ),
												entry.user_id
											),
										entry.note
									) }
								</li>
							) ) }
						</ul>
					</div>
				) }
			</VStack>
		</Modal>
	);
}
