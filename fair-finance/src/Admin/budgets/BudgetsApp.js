/**
 * WordPress dependencies
 */
import { useState, useEffect } from '@wordpress/element';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	Notice,
	Modal,
	TextControl,
	TextareaControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';

const BudgetsApp = () => {
	const [ budgets, setBudgets ] = useState( [] );
	const [ stats, setStats ] = useState( {} );
	const [ loading, setLoading ] = useState( true );
	const [ error, setError ] = useState( null );
	const [ success, setSuccess ] = useState( null );
	const [ isFormOpen, setIsFormOpen ] = useState( false );
	const [ editingBudget, setEditingBudget ] = useState( null );
	const [ formData, setFormData ] = useState( {
		name: '',
		description: '',
	} );
	const [ isSaving, setIsSaving ] = useState( false );

	useEffect( () => {
		loadData();
	}, [] );

	const loadData = async () => {
		setLoading( true );
		setError( null );

		try {
			const [ budgetsData, statsData ] = await Promise.all( [
				apiFetch( { path: '/fair-finance/v1/budgets' } ),
				apiFetch( { path: '/fair-finance/v1/budgets/stats' } ),
			] );
			setBudgets( budgetsData );
			setStats( statsData );
		} catch ( err ) {
			setError(
				err.message || __( 'Failed to load budgets.', 'fair-finance' )
			);
		} finally {
			setLoading( false );
		}
	};

	const handleCreate = () => {
		setEditingBudget( null );
		setFormData( {
			name: '',
			description: '',
		} );
		setIsFormOpen( true );
	};

	const handleEdit = ( budget ) => {
		setEditingBudget( budget );
		setFormData( {
			name: budget.name,
			description: budget.description || '',
		} );
		setIsFormOpen( true );
	};

	const handleDelete = async ( id ) => {
		if (
			! window.confirm(
				__(
					'Are you sure you want to delete this budget? Financial entries will be unlinked but not deleted.',
					'fair-finance'
				)
			)
		) {
			return;
		}

		setError( null );
		setSuccess( null );

		try {
			await apiFetch( {
				path: `/fair-finance/v1/budgets/${ id }`,
				method: 'DELETE',
			} );
			setSuccess( __( 'Budget deleted successfully.', 'fair-finance' ) );
			loadData();
		} catch ( err ) {
			setError(
				err.message || __( 'Failed to delete budget.', 'fair-finance' )
			);
		}
	};

	const handleFormSubmit = async ( e ) => {
		e.preventDefault();
		setIsSaving( true );
		setError( null );

		try {
			if ( editingBudget ) {
				await apiFetch( {
					path: `/fair-finance/v1/budgets/${ editingBudget.id }`,
					method: 'PUT',
					data: formData,
				} );
				setSuccess(
					__( 'Budget updated successfully.', 'fair-finance' )
				);
			} else {
				await apiFetch( {
					path: '/fair-finance/v1/budgets',
					method: 'POST',
					data: formData,
				} );
				setSuccess(
					__( 'Budget created successfully.', 'fair-finance' )
				);
			}
			setIsFormOpen( false );
			setEditingBudget( null );
			loadData();
		} catch ( err ) {
			setError(
				err.message ||
					( editingBudget
						? __( 'Failed to update budget.', 'fair-finance' )
						: __( 'Failed to create budget.', 'fair-finance' ) )
			);
		} finally {
			setIsSaving( false );
		}
	};

	const handleFormCancel = () => {
		setIsFormOpen( false );
		setEditingBudget( null );
	};

	const formatAmount = ( amount ) => {
		return new Intl.NumberFormat( 'en-US', {
			style: 'currency',
			currency: 'EUR',
		} ).format( amount || 0 );
	};

	const getBudgetStats = ( budgetId ) => {
		return (
			stats[ budgetId ] || {
				total_cost: 0,
				total_income: 0,
				balance: 0,
				total_count: 0,
			}
		);
	};

	const unbudgeted = stats.unbudgeted || {
		total_cost: 0,
		total_income: 0,
		balance: 0,
		cost_count: 0,
		income_count: 0,
		total_count: 0,
	};

	const getTotalBalance = () => {
		let total = unbudgeted.balance || 0;
		budgets.forEach( ( budget ) => {
			const budgetStats = getBudgetStats( budget.id );
			total += budgetStats.balance || 0;
		} );
		return total;
	};

	return (
		<div className="wrap fair-finance-budgets-page">
			{ /*
			 * Anchor for WordPress admin notices. Core's common.js inserts
			 * .notice elements right after `.wp-header-end` (or, lacking it,
			 * after the first h1 — which here is buried in the card header,
			 * making notices overlap it). Keeping this marker at the top of
			 * the wrap pins notices to the top of the page.
			 */ }
			<hr className="wp-header-end" />
			<VStack spacing={ 4 }>
				{ /* Unbudgeted Summary */ }
				<Card>
					<CardBody>
						<HStack justify="space-around">
							<div style={ { textAlign: 'center' } }>
								<div
									style={ {
										fontSize: '24px',
										fontWeight: 'bold',
										color: '#d63638',
									} }
								>
									{ formatAmount( unbudgeted.total_cost ) }
								</div>
								<div style={ { color: '#666' } }>
									{ __( 'Unbudgeted Costs', 'fair-finance' ) }{ ' ' }
									({ unbudgeted.cost_count || 0 })
								</div>
							</div>
							<div style={ { textAlign: 'center' } }>
								<div
									style={ {
										fontSize: '24px',
										fontWeight: 'bold',
										color: '#007017',
									} }
								>
									{ formatAmount( unbudgeted.total_income ) }
								</div>
								<div style={ { color: '#666' } }>
									{ __(
										'Unbudgeted Income',
										'fair-finance'
									) }{ ' ' }
									({ unbudgeted.income_count || 0 })
								</div>
							</div>
						</HStack>
					</CardBody>
				</Card>

				{ /* Budgets List */ }
				<Card>
					<CardHeader>
						<HStack justify="space-between">
							<h1>
								{ __( 'Budget Categories', 'fair-finance' ) }
							</h1>
							<Button variant="primary" onClick={ handleCreate }>
								{ __( 'Add New Budget', 'fair-finance' ) }
							</Button>
						</HStack>
					</CardHeader>
					<CardBody>
						<VStack spacing={ 4 }>
							{ error && (
								<Notice
									status="error"
									isDismissible
									onRemove={ () => setError( null ) }
								>
									{ error }
								</Notice>
							) }

							{ success && (
								<Notice
									status="success"
									isDismissible
									onRemove={ () => setSuccess( null ) }
								>
									{ success }
								</Notice>
							) }

							{ loading && (
								<div className="budgets-loading">
									<Spinner />
									<p>
										{ __(
											'Loading budgets...',
											'fair-finance'
										) }
									</p>
								</div>
							) }

							{ ! loading && budgets.length === 0 && (
								<div className="budgets-empty">
									<p>
										{ __(
											'No budget categories found. Create your first budget category to organize your costs and income.',
											'fair-finance'
										) }
									</p>
								</div>
							) }

							{ ! loading && (
								<table className="wp-list-table widefat fixed striped">
									<thead>
										<tr>
											<th>
												{ __( 'Name', 'fair-finance' ) }
											</th>
											<th>
												{ __(
													'Description',
													'fair-finance'
												) }
											</th>
											<th style={ { width: '120px' } }>
												{ __(
													'Balance',
													'fair-finance'
												) }
											</th>
											<th style={ { width: '180px' } }>
												{ __(
													'Actions',
													'fair-finance'
												) }
											</th>
										</tr>
									</thead>
									<tbody>
										{ budgets.map( ( budget ) => {
											const budgetStats = getBudgetStats(
												budget.id
											);
											return (
												<tr key={ budget.id }>
													<td
														data-label={ __(
															'Name',
															'fair-finance'
														) }
													>
														<strong>
															{ budget.name }
														</strong>
													</td>
													<td
														data-label={ __(
															'Description',
															'fair-finance'
														) }
													>
														{ budget.description || (
															<em>
																{ __(
																	'No description',
																	'fair-finance'
																) }
															</em>
														) }
													</td>
													<td
														data-label={ __(
															'Balance',
															'fair-finance'
														) }
													>
														<span
															style={ {
																color:
																	budgetStats.balance >=
																	0
																		? '#007017'
																		: '#d63638',
																fontWeight:
																	'bold',
															} }
														>
															{ formatAmount(
																budgetStats.balance
															) }
														</span>
													</td>
													<td
														data-label={ __(
															'Actions',
															'fair-finance'
														) }
													>
														<HStack
															spacing={ 2 }
															className="fair-finance-budget-actions"
														>
															<Button
																variant="secondary"
																size="small"
																href={ `admin.php?page=fair-finance-entries&budget_id=${ budget.id }` }
															>
																{ __(
																	'View',
																	'fair-finance'
																) }
															</Button>
															<Button
																variant="secondary"
																size="small"
																onClick={ () =>
																	handleEdit(
																		budget
																	)
																}
															>
																{ __(
																	'Edit',
																	'fair-finance'
																) }
															</Button>
															<Button
																variant="tertiary"
																size="small"
																isDestructive
																onClick={ () =>
																	handleDelete(
																		budget.id
																	)
																}
															>
																{ __(
																	'Delete',
																	'fair-finance'
																) }
															</Button>
														</HStack>
													</td>
												</tr>
											);
										} ) }
										{ /* Unbudgeted row */ }
										<tr>
											<td
												data-label={ __(
													'Name',
													'fair-finance'
												) }
											>
												<em>
													{ __(
														'Unbudgeted',
														'fair-finance'
													) }
												</em>
											</td>
											<td
												data-label={ __(
													'Description',
													'fair-finance'
												) }
											>
												<em>
													{ __(
														'Entries without a budget category',
														'fair-finance'
													) }
												</em>
											</td>
											<td
												data-label={ __(
													'Balance',
													'fair-finance'
												) }
											>
												<span
													style={ {
														color:
															unbudgeted.balance >=
															0
																? '#007017'
																: '#d63638',
														fontWeight: 'bold',
													} }
												>
													{ formatAmount(
														unbudgeted.balance
													) }
												</span>
											</td>
											<td
												data-label={ __(
													'Actions',
													'fair-finance'
												) }
											>
												<Button
													variant="secondary"
													size="small"
													href="admin.php?page=fair-finance-entries&budget_id=none"
												>
													{ __(
														'View',
														'fair-finance'
													) }
												</Button>
											</td>
										</tr>
									</tbody>
									<tfoot>
										<tr
											style={ {
												backgroundColor: '#f0f0f1',
												fontWeight: 'bold',
											} }
										>
											<td colSpan={ 2 }>
												{ __(
													'Total',
													'fair-finance'
												) }
											</td>
											<td
												data-label={ __(
													'Total',
													'fair-finance'
												) }
											>
												<span
													style={ {
														color:
															getTotalBalance() >=
															0
																? '#007017'
																: '#d63638',
														fontWeight: 'bold',
													} }
												>
													{ formatAmount(
														getTotalBalance()
													) }
												</span>
											</td>
											<td></td>
										</tr>
									</tfoot>
								</table>
							) }
						</VStack>
					</CardBody>
				</Card>
			</VStack>

			{ isFormOpen && (
				<Modal
					title={
						editingBudget
							? __( 'Edit Budget', 'fair-finance' )
							: __( 'Add New Budget', 'fair-finance' )
					}
					onRequestClose={ handleFormCancel }
					style={ { maxWidth: '500px', width: '100%' } }
				>
					<form onSubmit={ handleFormSubmit }>
						<VStack spacing={ 4 }>
							<TextControl
								label={ __( 'Name', 'fair-finance' ) }
								value={ formData.name }
								onChange={ ( value ) =>
									setFormData( { ...formData, name: value } )
								}
								required
							/>
							<TextareaControl
								label={ __( 'Description', 'fair-finance' ) }
								value={ formData.description }
								onChange={ ( value ) =>
									setFormData( {
										...formData,
										description: value,
									} )
								}
								help={ __(
									'Optional description for this budget category',
									'fair-finance'
								) }
							/>
							<HStack justify="flex-end" spacing={ 2 }>
								<Button
									variant="tertiary"
									onClick={ handleFormCancel }
									disabled={ isSaving }
								>
									{ __( 'Cancel', 'fair-finance' ) }
								</Button>
								<Button
									variant="primary"
									type="submit"
									isBusy={ isSaving }
									disabled={ isSaving || ! formData.name }
								>
									{ editingBudget
										? __( 'Update Budget', 'fair-finance' )
										: __(
												'Create Budget',
												'fair-finance'
											) }
								</Button>
							</HStack>
						</VStack>
					</form>
				</Modal>
			) }
		</div>
	);
};

export default BudgetsApp;
