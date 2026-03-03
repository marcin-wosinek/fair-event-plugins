/**
 * Group Pricing Rules Component
 *
 * Manages group-based pricing discounts for an event date.
 * Only rendered when fair-audience plugin is active.
 *
 * @package FairEvents
 */

import { useState, useEffect } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	Notice,
	SelectControl,
	TextControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

export default function GroupPricingRules({ eventDateId }) {
	const [rules, setRules] = useState([]);
	const [groups, setGroups] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);

	// Add form state
	const [selectedGroupId, setSelectedGroupId] = useState('');
	const [discountType, setDiscountType] = useState('percentage');
	const [discountValue, setDiscountValue] = useState('');
	const [adding, setAdding] = useState(false);

	// Edit state
	const [editingId, setEditingId] = useState(null);
	const [editDiscountType, setEditDiscountType] = useState('percentage');
	const [editDiscountValue, setEditDiscountValue] = useState('');
	const [saving, setSaving] = useState(false);

	useEffect(() => {
		if (!eventDateId) {
			setLoading(false);
			return;
		}
		loadData();
	}, [eventDateId]);

	const loadData = async () => {
		setLoading(true);
		setError(null);

		try {
			const [rulesData, groupsData] = await Promise.all([
				apiFetch({
					path: `/fair-events/v1/event-dates/${eventDateId}/group-pricing-rules`,
				}),
				apiFetch({
					path: '/fair-audience/v1/groups',
				}),
			]);

			setRules(rulesData);
			setGroups(groupsData);
		} catch (err) {
			setError(
				err.message ||
					__('Failed to load pricing rules.', 'fair-events')
			);
		} finally {
			setLoading(false);
		}
	};

	const availableGroups = groups.filter(
		(g) => !rules.some((r) => r.group_id === g.id)
	);

	const handleAdd = async () => {
		if (!selectedGroupId || !discountValue) return;

		setAdding(true);
		setError(null);
		setSuccess(null);

		try {
			const newRule = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}/group-pricing-rules`,
				method: 'POST',
				data: {
					group_id: parseInt(selectedGroupId, 10),
					discount_type: discountType,
					discount_value: parseFloat(discountValue),
				},
			});

			setRules([...rules, newRule]);
			setSelectedGroupId('');
			setDiscountValue('');
			setDiscountType('percentage');
			setSuccess(__('Pricing rule added.', 'fair-events'));
		} catch (err) {
			setError(
				err.message || __('Failed to add pricing rule.', 'fair-events')
			);
		} finally {
			setAdding(false);
		}
	};

	const handleStartEdit = (rule) => {
		setEditingId(rule.id);
		setEditDiscountType(rule.discount_type);
		setEditDiscountValue(String(rule.discount_value));
	};

	const handleCancelEdit = () => {
		setEditingId(null);
	};

	const handleSaveEdit = async (ruleId) => {
		setSaving(true);
		setError(null);
		setSuccess(null);

		try {
			const updated = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}/group-pricing-rules/${ruleId}`,
				method: 'PUT',
				data: {
					discount_type: editDiscountType,
					discount_value: parseFloat(editDiscountValue),
				},
			});

			setRules(rules.map((r) => (r.id === ruleId ? updated : r)));
			setEditingId(null);
			setSuccess(__('Pricing rule updated.', 'fair-events'));
		} catch (err) {
			setError(
				err.message ||
					__('Failed to update pricing rule.', 'fair-events')
			);
		} finally {
			setSaving(false);
		}
	};

	const handleDelete = async (ruleId) => {
		if (
			!window.confirm(
				__(
					'Are you sure you want to delete this pricing rule?',
					'fair-events'
				)
			)
		) {
			return;
		}

		setError(null);
		setSuccess(null);

		try {
			await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}/group-pricing-rules/${ruleId}`,
				method: 'DELETE',
			});

			setRules(rules.filter((r) => r.id !== ruleId));
			setSuccess(__('Pricing rule deleted.', 'fair-events'));
		} catch (err) {
			setError(
				err.message ||
					__('Failed to delete pricing rule.', 'fair-events')
			);
		}
	};

	const discountTypeOptions = [
		{
			label: __('Percentage (%)', 'fair-events'),
			value: 'percentage',
		},
		{
			label: __('Fixed amount', 'fair-events'),
			value: 'amount',
		},
	];

	const formatDiscount = (type, value) => {
		if (type === 'percentage') {
			return `${value}%`;
		}
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'EUR',
		}).format(value);
	};

	return (
		<VStack spacing={4}>
			{error && (
				<Notice
					status="error"
					isDismissible
					onRemove={() => setError(null)}
				>
					{error}
				</Notice>
			)}

			{success && (
				<Notice
					status="success"
					isDismissible
					onRemove={() => setSuccess(null)}
				>
					{success}
				</Notice>
			)}

			{loading && (
				<div style={{ textAlign: 'center', padding: '20px' }}>
					<Spinner />
				</div>
			)}

			{!loading && (
				<>
					{rules.length > 0 && (
						<Card>
							<CardHeader>
								<h3 style={{ margin: 0 }}>
									{__('Current Rules', 'fair-events')}
								</h3>
							</CardHeader>
							<CardBody>
								<div style={{ overflowX: 'auto' }}>
									<table className="wp-list-table widefat striped">
										<thead>
											<tr>
												<th>
													{__('Group', 'fair-events')}
												</th>
												<th>
													{__(
														'Discount Type',
														'fair-events'
													)}
												</th>
												<th>
													{__('Value', 'fair-events')}
												</th>
												<th>
													{__(
														'Actions',
														'fair-events'
													)}
												</th>
											</tr>
										</thead>
										<tbody>
											{rules.map((rule) => (
												<tr key={rule.id}>
													{editingId === rule.id ? (
														<>
															<td>
																<strong>
																	{
																		rule.group_name
																	}
																</strong>
															</td>
															<td>
																<SelectControl
																	value={
																		editDiscountType
																	}
																	options={
																		discountTypeOptions
																	}
																	onChange={
																		setEditDiscountType
																	}
																	__nextHasNoMarginBottom
																/>
															</td>
															<td>
																<TextControl
																	type="number"
																	value={
																		editDiscountValue
																	}
																	onChange={
																		setEditDiscountValue
																	}
																	min="0"
																	step="0.01"
																	__nextHasNoMarginBottom
																/>
															</td>
															<td>
																<HStack
																	spacing={2}
																>
																	<Button
																		variant="primary"
																		size="small"
																		onClick={() =>
																			handleSaveEdit(
																				rule.id
																			)
																		}
																		isBusy={
																			saving
																		}
																		disabled={
																			saving
																		}
																	>
																		{__(
																			'Save',
																			'fair-events'
																		)}
																	</Button>
																	<Button
																		variant="tertiary"
																		size="small"
																		onClick={
																			handleCancelEdit
																		}
																	>
																		{__(
																			'Cancel',
																			'fair-events'
																		)}
																	</Button>
																</HStack>
															</td>
														</>
													) : (
														<>
															<td>
																<strong>
																	{
																		rule.group_name
																	}
																</strong>
															</td>
															<td>
																{rule.discount_type ===
																'percentage'
																	? __(
																			'Percentage',
																			'fair-events'
																	  )
																	: __(
																			'Fixed amount',
																			'fair-events'
																	  )}
															</td>
															<td>
																{formatDiscount(
																	rule.discount_type,
																	rule.discount_value
																)}
															</td>
															<td>
																<HStack
																	spacing={2}
																>
																	<Button
																		variant="secondary"
																		size="small"
																		onClick={() =>
																			handleStartEdit(
																				rule
																			)
																		}
																	>
																		{__(
																			'Edit',
																			'fair-events'
																		)}
																	</Button>
																	<Button
																		variant="tertiary"
																		size="small"
																		isDestructive
																		onClick={() =>
																			handleDelete(
																				rule.id
																			)
																		}
																	>
																		{__(
																			'Delete',
																			'fair-events'
																		)}
																	</Button>
																</HStack>
															</td>
														</>
													)}
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</CardBody>
						</Card>
					)}

					{rules.length === 0 && (
						<p style={{ textAlign: 'center', color: '#666' }}>
							{__(
								'No group pricing rules yet. Add one below.',
								'fair-events'
							)}
						</p>
					)}

					{availableGroups.length > 0 && (
						<Card>
							<CardHeader>
								<h3 style={{ margin: 0 }}>
									{__('Add Pricing Rule', 'fair-events')}
								</h3>
							</CardHeader>
							<CardBody>
								<VStack spacing={3}>
									<SelectControl
										label={__('Group', 'fair-events')}
										value={selectedGroupId}
										options={[
											{
												label: __(
													'Select a group...',
													'fair-events'
												),
												value: '',
											},
											...availableGroups.map((g) => ({
												label: g.name,
												value: String(g.id),
											})),
										]}
										onChange={setSelectedGroupId}
									/>
									<SelectControl
										label={__(
											'Discount Type',
											'fair-events'
										)}
										value={discountType}
										options={discountTypeOptions}
										onChange={setDiscountType}
									/>
									<TextControl
										label={__(
											'Discount Value',
											'fair-events'
										)}
										type="number"
										value={discountValue}
										onChange={setDiscountValue}
										min="0"
										step="0.01"
										placeholder={
											discountType === 'percentage'
												? __('e.g. 10', 'fair-events')
												: __('e.g. 5.00', 'fair-events')
										}
									/>
									<Button
										variant="primary"
										onClick={handleAdd}
										isBusy={adding}
										disabled={
											adding ||
											!selectedGroupId ||
											!discountValue
										}
									>
										{__('Add Rule', 'fair-events')}
									</Button>
								</VStack>
							</CardBody>
						</Card>
					)}

					{availableGroups.length === 0 && groups.length > 0 && (
						<Notice status="info" isDismissible={false}>
							{__(
								'All groups already have pricing rules for this event.',
								'fair-events'
							)}
						</Notice>
					)}
				</>
			)}
		</VStack>
	);
}
