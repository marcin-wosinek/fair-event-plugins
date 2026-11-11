/**
 * Event Cash Operations
 *
 * "Income and expenses" section of the Finance tab: aggregate cash income
 * and expenses paid from event cash or personal funds, stored as Fair
 * Finance accounting entries linked to the event date.
 *
 * @package FairEvents
 */

import { useCallback, useEffect, useRef, useState } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Notice,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	AdminTable,
	AdminTableHeaderCell,
	AdminTableCell,
	ItemIdentity,
	RowActions,
	TableMessage,
} from 'fair-events-shared/src/admin-table/index.js';
import 'fair-events-shared/src/admin-table/style.css';

import CashOperationForm, {
	SOURCE_PERSONAL_FUNDS,
} from './CashOperationForm.js';
import ConfirmActionModal from '../components/ConfirmActionModal.js';

const PER_PAGE = 10;

// Fair Finance records every entry in EUR.
export const formatEuro = ( amount ) =>
	new Intl.NumberFormat( 'en-US', {
		style: 'currency',
		currency: 'EUR',
	} ).format( amount || 0 );

/**
 * Label of the operation kind, e.g. "Cash income".
 *
 * @param {Object} entry Financial entry.
 * @return {string} Label.
 */
export function operationLabel( entry ) {
	if ( 'income' === entry.entry_type ) {
		return __( 'Cash income', 'fair-events' );
	}
	if ( SOURCE_PERSONAL_FUNDS === entry.payment_source ) {
		return __( 'Expense, personal funds', 'fair-events' );
	}
	return __( 'Expense, event cash', 'fair-events' );
}

/**
 * One figure in the summary row.
 *
 * @param {Object}  props
 * @param {string}  props.label    Caption.
 * @param {number}  props.amount   Amount.
 * @param {string}  props.help     Explanation below the caption.
 * @param {Element} props.children Extra content below the caption.
 */
function Figure( { label, amount, help, children } ) {
	return (
		<div
			style={ {
				flex: '1 1 140px',
				minWidth: '140px',
				padding: '8px',
			} }
		>
			<div style={ { fontSize: '20px', fontWeight: 600 } }>
				{ formatEuro( amount ) }
			</div>
			<div style={ { color: '#50575e' } }>{ label }</div>
			{ help && (
				<div
					style={ {
						color: '#757575',
						fontSize: '12px',
						marginTop: '4px',
					} }
				>
					{ help }
				</div>
			) }
			{ children }
		</div>
	);
}

/**
 * The cash and personally paid figures.
 *
 * @param {Object} props
 * @param {Object} props.summary Summary from the event-summary route.
 */
export function CashSummary( { summary } ) {
	const payers = summary.personally_paid_by_payer || [];
	return (
		<div
			style={ { display: 'flex', flexWrap: 'wrap', gap: '8px' } }
			data-testid="event-cash-summary"
		>
			<Figure
				label={ __( 'Cash income', 'fair-events' ) }
				amount={ summary.cash_income }
			/>
			<Figure
				label={ __( 'Cash expenses', 'fair-events' ) }
				amount={ summary.event_cash_expenses }
				help={ __( 'Paid from event cash.', 'fair-events' ) }
			/>
			<Figure
				label={ __( 'Net cash movement', 'fair-events' ) }
				amount={ summary.net_cash_movement }
				help={ __(
					'Cash income minus expenses paid from event cash. Not a counted cash balance; no opening float is included.',
					'fair-events'
				) }
			/>
			<Figure
				label={ __( 'Total expenses', 'fair-events' ) }
				amount={ summary.total_expenses }
				help={ __(
					'Every expense of this event in Fair Finance, however it was paid.',
					'fair-events'
				) }
			/>
			<Figure
				label={ __( 'Personally paid', 'fair-events' ) }
				amount={ summary.personally_paid }
			>
				{ payers.length > 0 && (
					<ul
						style={ {
							margin: '4px 0 0',
							paddingLeft: '16px',
							fontSize: '12px',
							overflowWrap: 'anywhere',
						} }
						aria-label={ __(
							'Personally paid by payer',
							'fair-events'
						) }
					>
						{ payers.map( ( payer ) => (
							<li key={ payer.payer_name }>
								{ sprintf(
									/* translators: 1: payer name, 2: amount */
									__( '%1$s: %2$s', 'fair-events' ),
									payer.payer_name,
									formatEuro( payer.amount )
								) }
							</li>
						) ) }
					</ul>
				) }
			</Figure>
		</div>
	);
}

/**
 * "Income and expenses" section.
 *
 * Summary figures come from the parent, which also uses them for the
 * event's headline income; this section owns the operation list, the form
 * and deletions, and calls `onChanged` after every successful change so the
 * parent reloads the summary and accounting totals.
 *
 * @param {Object}      props
 * @param {number}      props.eventDateId    Event date being managed.
 * @param {string}      props.defaultDate    The event's date (Y-m-d), or ''.
 * @param {Object|null} props.summary        Loaded summary, or null.
 * @param {boolean}     props.summaryLoading Summary is loading.
 * @param {string|null} props.summaryError   Summary load error.
 * @param {Function}    props.onRetrySummary Reload the summary.
 * @param {Function}    props.onChanged      Called after a save or deletion.
 * @return {Element} The section.
 */
export default function EventCashOperations( {
	eventDateId,
	defaultDate = '',
	summary,
	summaryLoading = false,
	summaryError = null,
	onRetrySummary,
	onChanged,
} ) {
	const [ entries, setEntries ] = useState( [] );
	const [ page, setPage ] = useState( 1 );
	const [ pages, setPages ] = useState( 1 );
	const [ total, setTotal ] = useState( 0 );
	const [ listLoading, setListLoading ] = useState( true );
	const [ listLoaded, setListLoaded ] = useState( false );
	const [ listError, setListError ] = useState( null );

	// Form: { entry, entryType } while open.
	const [ form, setForm ] = useState( null );
	const [ notice, setNotice ] = useState( null );

	// Deletion.
	const [ deleting, setDeleting ] = useState( null );
	const [ deletePending, setDeletePending ] = useState( false );
	const [ deleteError, setDeleteError ] = useState( null );
	const deleteBusy = useRef( false );
	const headingRef = useRef( null );

	const loadEntries = useCallback(
		async ( targetPage ) => {
			setListLoading( true );
			setListError( null );
			try {
				const data = await apiFetch( {
					path: `/fair-finance/v1/financial-entries?event_date_id=${ eventDateId }&classified=1&per_page=${ PER_PAGE }&page=${ targetPage }&orderby=entry_date&order=desc`,
				} );
				const loadedPages = Math.max( 1, data.pages || 1 );
				// A deletion can empty the last page: step back to the new last one.
				if ( targetPage > loadedPages && data.total > 0 ) {
					setPage( loadedPages );
					return;
				}
				setEntries( data.entries || [] );
				setPages( loadedPages );
				setTotal( data.total || 0 );
				setListLoaded( true );
			} catch ( err ) {
				setListError(
					err?.message
						? sprintf(
								/* translators: %s: error message */
								__(
									'Income and expenses could not be loaded. %s',
									'fair-events'
								),
								err.message
							)
						: __(
								'Income and expenses could not be loaded.',
								'fair-events'
							)
				);
			} finally {
				setListLoading( false );
			}
		},
		[ eventDateId ]
	);

	useEffect( () => {
		loadEntries( page );
	}, [ loadEntries, page ] );

	const refresh = () => {
		loadEntries( page );
		onChanged?.();
	};

	const handleSaved = ( saved ) => {
		const wasEdit = !! form?.entry;
		setForm( null );
		const isIncome = 'income' === saved?.entry_type;
		let message;
		if ( wasEdit ) {
			message = isIncome
				? __( 'Income updated.', 'fair-events' )
				: __( 'Expense updated.', 'fair-events' );
		} else {
			message = isIncome
				? __( 'Income added.', 'fair-events' )
				: __( 'Expense added.', 'fair-events' );
		}
		setNotice( message );
		if ( ! wasEdit && page !== 1 ) {
			// The newest operations are on the first page; changing the page
			// reloads the list.
			setPage( 1 );
			onChanged?.();
			return;
		}
		refresh();
	};

	const openDelete = ( entry ) => {
		setDeleteError( null );
		setDeleting( entry );
	};

	const closeDelete = () => {
		if ( deleteBusy.current ) {
			return;
		}
		setDeleteError( null );
		setDeleting( null );
	};

	const confirmDelete = async () => {
		if ( deleteBusy.current || ! deleting ) {
			return;
		}
		deleteBusy.current = true;
		setDeletePending( true );
		setDeleteError( null );
		try {
			await apiFetch( {
				path: `/fair-finance/v1/financial-entries/${ deleting.id }`,
				method: 'DELETE',
			} );
		} catch ( err ) {
			// Deleted already, e.g. by an earlier attempt whose answer was lost.
			if ( 'rest_entry_not_found' !== err?.code ) {
				deleteBusy.current = false;
				setDeletePending( false );
				setDeleteError(
					err?.message ||
						__(
							'The operation could not be deleted. Please try again.',
							'fair-events'
						)
				);
				return;
			}
		}
		deleteBusy.current = false;
		setDeletePending( false );
		setNotice(
			'income' === deleting.entry_type
				? __( 'Income deleted.', 'fair-events' )
				: __( 'Expense deleted.', 'fair-events' )
		);
		setDeleting( null );
		// The row's actions are gone: keep focus on a stable element.
		headingRef.current?.focus();
		refresh();
	};

	const describe = ( entry ) =>
		sprintf(
			/* translators: 1: operation kind, e.g. "Cash income", 2: amount, 3: date */
			__( '%1$s of %2$s on %3$s', 'fair-events' ),
			operationLabel( entry ),
			formatEuro( entry.amount ),
			entry.entry_date
		);

	return (
		<Card style={ { marginTop: '16px' } }>
			<CardHeader>
				<HStack justify="space-between" wrap>
					<h2 ref={ headingRef } tabIndex={ -1 }>
						{ __( 'Income and expenses', 'fair-events' ) }
					</h2>
					<HStack
						justify="flex-end"
						spacing={ 2 }
						wrap
						expanded={ false }
					>
						<Button
							variant="secondary"
							onClick={ () =>
								setForm( { entry: null, entryType: 'income' } )
							}
						>
							{ __( 'Add income', 'fair-events' ) }
						</Button>
						<Button
							variant="secondary"
							onClick={ () =>
								setForm( { entry: null, entryType: 'cost' } )
							}
						>
							{ __( 'Add expense', 'fair-events' ) }
						</Button>
					</HStack>
				</HStack>
			</CardHeader>
			<CardBody>
				<VStack spacing={ 4 }>
					{ notice && (
						<Notice
							status="success"
							isDismissible
							onRemove={ () => setNotice( null ) }
						>
							{ notice }
						</Notice>
					) }

					{ summaryError && (
						<TableMessage
							status="error"
							onRetry={ onRetrySummary }
							retryLabel={ __( 'Try again', 'fair-events' ) }
						>
							{ summaryError }
						</TableMessage>
					) }
					{ ! summaryError && summary && (
						<CashSummary summary={ summary } />
					) }
					{ ! summaryError && ! summary && summaryLoading && (
						<TableMessage status="loading">
							{ __( 'Loading totals…', 'fair-events' ) }
						</TableMessage>
					) }

					{ listError && (
						<TableMessage
							status="error"
							onRetry={ () => loadEntries( page ) }
							retryLabel={ __( 'Try again', 'fair-events' ) }
						>
							{ listError }
						</TableMessage>
					) }

					{ ! listLoaded && listLoading && (
						<TableMessage status="loading">
							{ __(
								'Loading income and expenses…',
								'fair-events'
							) }
						</TableMessage>
					) }

					{ listLoaded && 0 === entries.length && ! listError && (
						<TableMessage status="empty">
							{ __(
								'No income or expenses recorded for this event yet. Use “Add income” for cash received, such as a day’s gate sales, and “Add expense” for costs paid from event cash or personal funds.',
								'fair-events'
							) }
						</TableMessage>
					) }

					{ entries.length > 0 && (
						<AdminTable
							caption={ __(
								'Income and expenses',
								'fair-events'
							) }
						>
							<thead>
								<tr>
									<AdminTableHeaderCell variant="identity">
										{ __( 'Operation', 'fair-events' ) }
									</AdminTableHeaderCell>
									<AdminTableHeaderCell>
										{ __( 'Date', 'fair-events' ) }
									</AdminTableHeaderCell>
									<AdminTableHeaderCell variant="amount">
										{ __( 'Amount', 'fair-events' ) }
									</AdminTableHeaderCell>
									<AdminTableHeaderCell>
										{ __( 'Paid by', 'fair-events' ) }
									</AdminTableHeaderCell>
									<AdminTableHeaderCell variant="actions">
										{ __( 'Actions', 'fair-events' ) }
									</AdminTableHeaderCell>
								</tr>
							</thead>
							<tbody>
								{ entries.map( ( entry ) => (
									<tr key={ entry.id }>
										<AdminTableCell variant="identity">
											<ItemIdentity
												title={ operationLabel(
													entry
												) }
												meta={
													entry.description ||
													__(
														'(no note)',
														'fair-events'
													)
												}
											/>
										</AdminTableCell>
										<AdminTableCell
											label={ __(
												'Date',
												'fair-events'
											) }
										>
											{ entry.entry_date }
										</AdminTableCell>
										<AdminTableCell
											label={ __(
												'Amount',
												'fair-events'
											) }
											variant="amount"
										>
											{ 'cost' === entry.entry_type
												? `−${ formatEuro(
														entry.amount
													) }`
												: formatEuro( entry.amount ) }
										</AdminTableCell>
										<AdminTableCell
											label={ __(
												'Paid by',
												'fair-events'
											) }
										>
											{ SOURCE_PERSONAL_FUNDS ===
											entry.payment_source
												? entry.payer_name || '—'
												: '—' }
										</AdminTableCell>
										<AdminTableCell variant="actions">
											<RowActions
												primary={ {
													label: __(
														'Edit',
														'fair-events'
													),
													onClick: () =>
														setForm( {
															entry,
															entryType:
																entry.entry_type,
														} ),
												} }
												secondary={ [
													{
														label: __(
															'Delete',
															'fair-events'
														),
														isDestructive: true,
														onClick: () =>
															openDelete( entry ),
													},
												] }
												moreLabel={ sprintf(
													/* translators: %s: operation, e.g. "Cash income of €115.00 on 2026-11-13" */
													__(
														'More actions for “%s”',
														'fair-events'
													),
													describe( entry )
												) }
											/>
										</AdminTableCell>
									</tr>
								) ) }
							</tbody>
						</AdminTable>
					) }

					{ pages > 1 && (
						<nav
							aria-label={ __(
								'Income and expenses pages',
								'fair-events'
							) }
						>
							<HStack justify="center" spacing={ 3 } wrap>
								<Button
									variant="tertiary"
									onClick={ () => setPage( page - 1 ) }
									disabled={ page <= 1 || listLoading }
								>
									{ __( 'Previous page', 'fair-events' ) }
								</Button>
								<span role="status">
									{ sprintf(
										/* translators: 1: current page, 2: number of pages, 3: number of operations */
										__(
											'Page %1$d of %2$d (%3$d operations)',
											'fair-events'
										),
										page,
										pages,
										total
									) }
								</span>
								<Button
									variant="tertiary"
									onClick={ () => setPage( page + 1 ) }
									disabled={ page >= pages || listLoading }
								>
									{ __( 'Next page', 'fair-events' ) }
								</Button>
							</HStack>
						</nav>
					) }
				</VStack>
			</CardBody>

			{ form && (
				<CashOperationForm
					eventDateId={ eventDateId }
					entry={ form.entry }
					entryType={ form.entryType }
					defaultDate={ defaultDate }
					onSaved={ handleSaved }
					onCancel={ () => setForm( null ) }
				/>
			) }

			{ deleting && (
				<ConfirmActionModal
					title={
						'income' === deleting.entry_type
							? __( 'Delete income', 'fair-events' )
							: __( 'Delete expense', 'fair-events' )
					}
					confirmLabel={
						'income' === deleting.entry_type
							? __( 'Delete income', 'fair-events' )
							: __( 'Delete expense', 'fair-events' )
					}
					busyLabel={ __( 'Deleting…', 'fair-events' ) }
					isDestructive
					isBusy={ deletePending }
					error={ deleteError }
					onConfirm={ confirmDelete }
					onCancel={ closeDelete }
				>
					<p style={ { margin: 0 } }>
						<strong>{ describe( deleting ) }</strong>
					</p>
					{ deleting.description && (
						<p style={ { margin: 0 } }>{ deleting.description }</p>
					) }
					{ SOURCE_PERSONAL_FUNDS === deleting.payment_source &&
						deleting.payer_name && (
							<p style={ { margin: 0 } }>
								{ sprintf(
									/* translators: %s: payer name */
									__( 'Paid by %s.', 'fair-events' ),
									deleting.payer_name
								) }
							</p>
						) }
					<p style={ { margin: 0 } }>
						{ __(
							'It is removed from this event’s totals and from Fair Finance accounting. Tickets and participants are not affected. This cannot be undone.',
							'fair-events'
						) }
					</p>
				</ConfirmActionModal>
			) }
		</Card>
	);
}
