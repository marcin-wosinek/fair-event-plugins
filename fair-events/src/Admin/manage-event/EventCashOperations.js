/**
 * Event Cash Operations
 *
 * "Expenses and cash sales" section of the Finance tab: every expense of the
 * event and the cash sales recorded for it, as Fair Finance accounting
 * entries linked to the event date. Both lists are collapsed on arrival;
 * their totals are in the event result above.
 *
 * Each expense appears once, however it was paid. Operations recorded here
 * (cash income, expenses paid from event cash or personal funds) can be
 * edited and deleted; other entries, such as bank imports, open in Fair
 * Finance.
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
	Panel,
	PanelBody,
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
	SOURCE_EVENT_CASH,
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
 * Whether the entry was recorded on this tab, so it can be edited here.
 *
 * @param {Object} entry Financial entry.
 * @return {boolean} Recorded as a cash operation.
 */
export const isCashOperation = ( entry ) => !! entry.payment_source;

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
	if ( SOURCE_EVENT_CASH === entry.payment_source ) {
		return __( 'Expense, event cash', 'fair-events' );
	}
	return __( 'Expense', 'fair-events' );
}

/**
 * How an expense was paid.
 *
 * @param {Object} entry Financial entry.
 * @return {string} Label.
 */
export function paidFromLabel( entry ) {
	if ( SOURCE_EVENT_CASH === entry.payment_source ) {
		return __( 'Event cash', 'fair-events' );
	}
	if ( SOURCE_PERSONAL_FUNDS === entry.payment_source ) {
		return __( 'Personal funds', 'fair-events' );
	}
	if ( entry.bank_origin ) {
		return entry.bank_origin.account?.name
			? sprintf(
					/* translators: %s: bank account name */
					__( 'Bank (%s)', 'fair-events' ),
					entry.bank_origin.account.name
				)
			: __( 'Bank', 'fair-events' );
	}
	return __( 'Not recorded', 'fair-events' );
}

/**
 * One collapsed, paginated list of entries. Loads when first opened and
 * again whenever `refreshKey` changes after that.
 *
 * @param {Object}   props
 * @param {number}   props.eventDateId Event date.
 * @param {string}   props.title       Panel title.
 * @param {string}   props.query       Extra query string for the entries route.
 * @param {string}   props.caption     Table caption.
 * @param {string}   props.emptyText   Text for an empty list.
 * @param {boolean}  props.expenses    List of expenses (adds paid-from columns).
 * @param {number}   props.refreshKey  Changes after every change.
 * @param {string}   props.entriesUrl  Fair Finance entries screen URL.
 * @param {Function} props.onEdit      Edit a cash operation.
 * @param {Function} props.onDelete    Delete a cash operation.
 * @param {Function} props.describe    Describe an entry for menus.
 * @return {Element} The panel.
 */
function EntryList( {
	eventDateId,
	title,
	query,
	caption,
	emptyText,
	expenses = false,
	refreshKey,
	entriesUrl,
	onEdit,
	onDelete,
	describe,
} ) {
	const [ opened, setOpened ] = useState( false );
	const [ entries, setEntries ] = useState( [] );
	const [ page, setPage ] = useState( 1 );
	const [ pages, setPages ] = useState( 1 );
	const [ total, setTotal ] = useState( 0 );
	const [ loading, setLoading ] = useState( false );
	const [ loaded, setLoaded ] = useState( false );
	const [ error, setError ] = useState( null );

	const load = useCallback(
		async ( targetPage ) => {
			setLoading( true );
			setError( null );
			try {
				const data = await apiFetch( {
					path: `/fair-finance/v1/financial-entries?event_date_id=${ eventDateId }&${ query }&per_page=${ PER_PAGE }&page=${ targetPage }&orderby=entry_date&order=desc`,
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
				setLoaded( true );
			} catch ( err ) {
				setError(
					err?.message
						? sprintf(
								/* translators: 1: list name, e.g. "Expenses", 2: error message */
								__(
									'%1$s could not be loaded. %2$s',
									'fair-events'
								),
								caption,
								err.message
							)
						: sprintf(
								/* translators: %s: list name, e.g. "Expenses" */
								__( '%s could not be loaded.', 'fair-events' ),
								caption
							)
				);
			} finally {
				setLoading( false );
			}
		},
		[ eventDateId, query, caption ]
	);

	useEffect( () => {
		if ( opened ) {
			load( page );
		}
	}, [ opened, load, page, refreshKey ] );

	const entryLink = ( entry ) =>
		entriesUrl ? `${ entriesUrl }&entry_id=${ entry.id }` : undefined;

	return (
		<PanelBody
			title={ title }
			initialOpen={ false }
			onToggle={ ( next ) => {
				if ( next ) {
					setOpened( true );
				}
			} }
		>
			<VStack spacing={ 4 }>
				{ error && (
					<TableMessage
						status="error"
						onRetry={ () => load( page ) }
						retryLabel={ __( 'Try again', 'fair-events' ) }
					>
						{ error }
					</TableMessage>
				) }

				{ ! loaded && loading && (
					<TableMessage status="loading">
						{ __( 'Loading…', 'fair-events' ) }
					</TableMessage>
				) }

				{ loaded && 0 === entries.length && ! error && (
					<TableMessage status="empty">{ emptyText }</TableMessage>
				) }

				{ entries.length > 0 && (
					<AdminTable caption={ caption }>
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
								{ expenses && (
									<AdminTableHeaderCell>
										{ __( 'Paid from', 'fair-events' ) }
									</AdminTableHeaderCell>
								) }
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
											title={ operationLabel( entry ) }
											meta={
												entry.description ||
												__( '(no note)', 'fair-events' )
											}
										/>
									</AdminTableCell>
									<AdminTableCell
										label={ __( 'Date', 'fair-events' ) }
									>
										{ entryLink( entry ) ? (
											<a
												href={ entryLink( entry ) }
												aria-label={ sprintf(
													/* translators: 1: financial entry ID, 2: entry date */
													__(
														'Entry #%1$d, %2$s',
														'fair-events'
													),
													entry.id,
													entry.entry_date
												) }
											>
												{ entry.entry_date }
											</a>
										) : (
											entry.entry_date
										) }
									</AdminTableCell>
									<AdminTableCell
										label={ __( 'Amount', 'fair-events' ) }
										variant="amount"
									>
										{ 'cost' === entry.entry_type
											? `−${ formatEuro( entry.amount ) }`
											: formatEuro( entry.amount ) }
									</AdminTableCell>
									{ expenses && (
										<AdminTableCell
											label={ __(
												'Paid from',
												'fair-events'
											) }
										>
											{ paidFromLabel( entry ) }
										</AdminTableCell>
									) }
									<AdminTableCell
										label={ __( 'Paid by', 'fair-events' ) }
									>
										{ SOURCE_PERSONAL_FUNDS ===
										entry.payment_source
											? entry.payer_name || '—'
											: '—' }
									</AdminTableCell>
									<AdminTableCell variant="actions">
										{ isCashOperation( entry ) ? (
											<RowActions
												primary={ {
													label: __(
														'Edit',
														'fair-events'
													),
													onClick: () =>
														onEdit( entry ),
												} }
												secondary={ [
													{
														label: __(
															'Delete',
															'fair-events'
														),
														isDestructive: true,
														onClick: () =>
															onDelete( entry ),
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
										) : (
											entryLink( entry ) && (
												<a href={ entryLink( entry ) }>
													{ __(
														'Open in Fair Finance',
														'fair-events'
													) }
												</a>
											)
										) }
									</AdminTableCell>
								</tr>
							) ) }
						</tbody>
					</AdminTable>
				) }

				{ pages > 1 && (
					<nav
						aria-label={ sprintf(
							/* translators: %s: list name, e.g. "Expenses" */
							__( '%s pages', 'fair-events' ),
							caption
						) }
					>
						<HStack justify="center" spacing={ 3 } wrap>
							<Button
								variant="tertiary"
								onClick={ () => setPage( page - 1 ) }
								disabled={ page <= 1 || loading }
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
								disabled={ page >= pages || loading }
							>
								{ __( 'Next page', 'fair-events' ) }
							</Button>
						</HStack>
					</nav>
				) }
			</VStack>
		</PanelBody>
	);
}

/**
 * "Expenses and cash sales" section.
 *
 * Calls `onChanged` after every successful change so the parent reloads
 * the event result.
 *
 * @param {Object}      props
 * @param {number}      props.eventDateId Event date being managed.
 * @param {string}      props.defaultDate The event's date (Y-m-d), or ''.
 * @param {string}      props.entriesUrl  Fair Finance entries screen URL.
 * @param {Object|null} props.summary     Finance summary, once loaded.
 * @param {Function}    props.onChanged   Called after a save or deletion.
 * @return {Element} The section.
 */
export default function EventCashOperations( {
	eventDateId,
	defaultDate = '',
	entriesUrl = '',
	summary = null,
	onChanged,
} ) {
	const [ refreshKey, setRefreshKey ] = useState( 0 );

	// Form: { entry, entryType } while open.
	const [ form, setForm ] = useState( null );
	const [ notice, setNotice ] = useState( null );

	// Deletion.
	const [ deleting, setDeleting ] = useState( null );
	const [ deletePending, setDeletePending ] = useState( false );
	const [ deleteError, setDeleteError ] = useState( null );
	const deleteBusy = useRef( false );
	const headingRef = useRef( null );

	const refresh = () => {
		setRefreshKey( ( key ) => key + 1 );
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

	const expensesTotal = summary?.costs?.expenses?.total;
	const cashTotal = summary?.sales?.cash;
	const cashExpenses = summary?.costs?.expenses?.event_cash;
	const cashKnown =
		null !== cashTotal &&
		undefined !== cashTotal &&
		null !== cashExpenses &&
		undefined !== cashExpenses;

	return (
		<Card style={ { marginTop: '16px' } }>
			<CardHeader>
				<HStack justify="space-between" wrap>
					<h2 ref={ headingRef } tabIndex={ -1 }>
						{ __( 'Expenses and cash sales', 'fair-events' ) }
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
			<CardBody style={ { padding: 0 } }>
				{ notice && (
					<div style={ { padding: '16px 16px 0' } }>
						<Notice
							status="success"
							isDismissible
							onRemove={ () => setNotice( null ) }
						>
							{ notice }
						</Notice>
					</div>
				) }
				{ cashKnown && (
					<p
						style={ { margin: 0, padding: '16px' } }
						data-testid="event-cash-movement"
					>
						{ sprintf(
							/* translators: 1: cash received, 2: expenses paid from event cash, 3: difference */
							__(
								'Event cash: %1$s received, %2$s paid out, %3$s net cash movement. Not a counted cash balance; no opening float is included.',
								'fair-events'
							),
							formatEuro( cashTotal ),
							formatEuro( cashExpenses ),
							formatEuro(
								Math.round(
									( cashTotal - cashExpenses ) * 100
								) / 100
							)
						) }
					</p>
				) }
				<Panel>
					<EntryList
						eventDateId={ eventDateId }
						title={
							null === expensesTotal ||
							undefined === expensesTotal
								? __( 'Expenses', 'fair-events' )
								: sprintf(
										/* translators: %s: total of the expenses */
										__( 'Expenses (%s)', 'fair-events' ),
										formatEuro( expensesTotal )
									)
						}
						query="entry_type=cost"
						caption={ __( 'Expenses', 'fair-events' ) }
						emptyText={ __(
							'No expenses recorded for this event yet. Use “Add expense” for costs paid from event cash or personal funds.',
							'fair-events'
						) }
						expenses
						refreshKey={ refreshKey }
						entriesUrl={ entriesUrl }
						onEdit={ ( entry ) =>
							setForm( { entry, entryType: entry.entry_type } )
						}
						onDelete={ openDelete }
						describe={ describe }
					/>
					<EntryList
						eventDateId={ eventDateId }
						title={
							null === cashTotal || undefined === cashTotal
								? __( 'Cash sales', 'fair-events' )
								: sprintf(
										/* translators: %s: total of the cash sales */
										__( 'Cash sales (%s)', 'fair-events' ),
										formatEuro( cashTotal )
									)
						}
						query="entry_type=income&classified=1"
						caption={ __( 'Cash sales', 'fair-events' ) }
						emptyText={ __(
							'No cash sales recorded for this event yet. Use “Add income” for cash received, such as a day’s gate sales.',
							'fair-events'
						) }
						refreshKey={ refreshKey }
						entriesUrl={ entriesUrl }
						onEdit={ ( entry ) =>
							setForm( { entry, entryType: entry.entry_type } )
						}
						onDelete={ openDelete }
						describe={ describe }
					/>
				</Panel>
				{ entriesUrl && (
					<div style={ { padding: '16px' } }>
						<Button
							variant="secondary"
							href={ `${ entriesUrl }&event_date_id=${ eventDateId }` }
						>
							{ __( 'View All Entries', 'fair-events' ) }
						</Button>
					</div>
				) }
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
