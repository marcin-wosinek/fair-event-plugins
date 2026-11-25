/**
 * Event Finance Component
 *
 * Finance tab of Manage Event (#2398). The event result comes first: total
 * sales, total costs including fees and the net result, with how each was
 * reached. Individual payments, expenses, cash sales and purchase attempts
 * follow, collapsed on arrival, then the budget settings.
 *
 * @package FairEvents
 */

import { useState, useEffect, useCallback } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Notice,
	SelectControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import FinanceSummary from './FinanceSummary.js';
import OnlinePayments from './OnlinePayments.js';
import PurchasePayments from './PurchasePayments.js';
import EventCashOperations from './EventCashOperations.js';

// Name the section that failed, then add the server's own explanation.
const loadErrorMessage = ( err, summary ) =>
	err?.message ? `${ summary } ${ err.message }` : summary;

/**
 * Finance tab of Manage Event.
 *
 * Every figure comes from one finance-summary request, which counts each
 * payment once over all of the event's payments and says which sources are
 * missing, so a missing or failing plugin never reads as a zero total.
 *
 * @param {Object}  props
 * @param {number}  props.eventDateId               Event date being managed.
 * @param {boolean} props.connectorActive           Fair Payments Connector is active.
 * @param {boolean} props.financeActive             Fair Finance is active.
 * @param {string}  props.entriesUrl                Fair Finance entries screen URL.
 * @param {boolean} props.purchasePaymentsAvailable Purchase payments can be listed.
 * @param {boolean} props.financeManageable         The user may read and change Fair
 *                                                  Finance entries (administrators).
 * @param {string}  props.defaultEntryDate          The event's date (Y-m-d), or ''.
 */
export default function EventFinance( {
	eventDateId,
	connectorActive,
	financeActive,
	entriesUrl,
	purchasePaymentsAvailable = false,
	financeManageable = false,
	defaultEntryDate = '',
} ) {
	const cashEnabled = !! ( financeActive && financeManageable );

	const [ summary, setSummary ] = useState( null );
	const [ summaryLoading, setSummaryLoading ] = useState( !! eventDateId );
	const [ summaryError, setSummaryError ] = useState( null );

	// Budget link (#1608): which fair-finance budget this event's payments
	// should preselect during reconciliation. '' means "no budget".
	const [ budgets, setBudgets ] = useState( [] );
	const [ budgetId, setBudgetId ] = useState( '' );
	const [ savedBudgetId, setSavedBudgetId ] = useState( '' );
	const [ budgetLoading, setBudgetLoading ] = useState(
		!! ( financeActive && eventDateId )
	);
	const [ budgetLoadError, setBudgetLoadError ] = useState( null );
	const [ budgetSaving, setBudgetSaving ] = useState( false );
	const [ budgetError, setBudgetError ] = useState( null );
	const [ budgetSuccess, setBudgetSuccess ] = useState( null );

	const loadSummary = useCallback( async () => {
		setSummaryLoading( true );
		setSummaryError( null );
		try {
			const data = await apiFetch( {
				path: `/fair-events/v1/event-dates/${ eventDateId }/finance-summary`,
			} );
			setSummary( data );
		} catch ( err ) {
			setSummary( null );
			setSummaryError(
				loadErrorMessage(
					err,
					__( 'The event result could not be loaded.', 'fair-events' )
				)
			);
		} finally {
			setSummaryLoading( false );
		}
	}, [ eventDateId ] );

	useEffect( () => {
		if ( ! eventDateId ) {
			return;
		}
		loadSummary();
		if ( financeActive ) {
			loadBudget();
		}
	}, [ eventDateId, financeActive, loadSummary ] );

	const loadBudget = async () => {
		setBudgetLoading( true );
		setBudgetLoadError( null );

		try {
			const [ budgetsData, eventBudgetData ] = await Promise.all( [
				apiFetch( { path: '/fair-finance/v1/budgets' } ),
				apiFetch( {
					path: `/fair-events/v1/event-dates/${ eventDateId }/budget`,
				} ),
			] );

			setBudgets( budgetsData || [] );
			const currentBudgetId = eventBudgetData?.budget_id
				? String( eventBudgetData.budget_id )
				: '';
			setBudgetId( currentBudgetId );
			setSavedBudgetId( currentBudgetId );
		} catch ( err ) {
			setBudgetLoadError(
				loadErrorMessage(
					err,
					__( 'Budgets could not be loaded.', 'fair-events' )
				)
			);
		} finally {
			setBudgetLoading( false );
		}
	};

	const handleSaveBudget = async () => {
		setBudgetSaving( true );
		setBudgetError( null );
		setBudgetSuccess( null );

		try {
			const updated = await apiFetch( {
				path: `/fair-events/v1/event-dates/${ eventDateId }/budget`,
				method: 'PUT',
				data: {
					budget_id: budgetId
						? Number.parseInt( budgetId, 10 )
						: null,
				},
			} );
			const newBudgetId = updated.budget_id
				? String( updated.budget_id )
				: '';
			setBudgetId( newBudgetId );
			setSavedBudgetId( newBudgetId );
			setBudgetSuccess( __( 'Budget updated.', 'fair-events' ) );
		} catch ( err ) {
			setBudgetError(
				err.message || __( 'Failed to update budget.', 'fair-events' )
			);
		} finally {
			setBudgetSaving( false );
		}
	};

	return (
		<div className="fair-events-finance">
			<FinanceSummary
				summary={ summary }
				loading={ summaryLoading }
				error={ summaryError }
				onRetry={ loadSummary }
			/>

			{ connectorActive && eventDateId && (
				<OnlinePayments
					eventDateId={ eventDateId }
					financeActive={ financeActive }
					entriesUrl={ entriesUrl }
				/>
			) }

			{ cashEnabled && eventDateId && (
				<EventCashOperations
					eventDateId={ eventDateId }
					defaultDate={ defaultEntryDate }
					entriesUrl={ entriesUrl }
					summary={ summary }
					onChanged={ loadSummary }
				/>
			) }

			{ purchasePaymentsAvailable && eventDateId && (
				<PurchasePayments eventDateId={ eventDateId } />
			) }

			{ financeActive && (
				<Card style={ { marginTop: '16px' } }>
					<CardHeader>
						<h2>{ __( 'Budget', 'fair-events' ) }</h2>
					</CardHeader>
					<CardBody>
						{ budgetLoadError && (
							<Notice status="error" isDismissible={ false }>
								{ budgetLoadError }
							</Notice>
						) }

						{ budgetError && (
							<Notice
								status="error"
								isDismissible
								onRemove={ () => setBudgetError( null ) }
							>
								{ budgetError }
							</Notice>
						) }

						{ budgetSuccess && (
							<Notice
								status="success"
								isDismissible
								onRemove={ () => setBudgetSuccess( null ) }
							>
								{ budgetSuccess }
							</Notice>
						) }

						<VStack spacing={ 4 } style={ { maxWidth: '600px' } }>
							<SelectControl
								label={ __( 'Budget', 'fair-events' ) }
								help={ __(
									'Reconciliation splits preselect this budget for payments linked to this event.',
									'fair-events'
								) }
								value={ budgetId }
								options={ [
									{
										label: __( 'No budget', 'fair-events' ),
										value: '',
									},
									...budgets.map( ( budget ) => ( {
										label: budget.name,
										value: String( budget.id ),
									} ) ),
								] }
								onChange={ setBudgetId }
								disabled={ budgetLoading || !! budgetLoadError }
							/>
							<HStack justify="flex-start">
								<Button
									variant="primary"
									onClick={ handleSaveBudget }
									isBusy={ budgetSaving }
									disabled={
										budgetSaving ||
										budgetLoading ||
										!! budgetLoadError ||
										budgetId === savedBudgetId
									}
								>
									{ __( 'Save budget', 'fair-events' ) }
								</Button>
							</HStack>
						</VStack>
					</CardBody>
				</Card>
			) }
		</div>
	);
}
