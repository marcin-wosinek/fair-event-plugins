/**
 * Group Rules Component
 *
 * Unified per-group view showing both discounts and permissions.
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
	CheckboxControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

const PERMISSION_TYPES = ['view_signups', 'manage_signups'];

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

const permissionLabel = (type) => {
	switch (type) {
		case 'view_signups':
			return __('View signups', 'fair-events');
		case 'manage_signups':
			return __('Manage signups', 'fair-events');
		default:
			return type;
	}
};

export default function GroupRules({ eventDateId }) {
	const [pricingRules, setPricingRules] = useState([]);
	const [permissionRules, setPermissionRules] = useState([]);
	const [groups, setGroups] = useState([]);
	const [loading, setLoading] = useState(true);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);

	// Add form state
	const [selectedGroupId, setSelectedGroupId] = useState('');
	const [discountType, setDiscountType] = useState('percentage');
	const [discountValue, setDiscountValue] = useState('');
	const [addPermissions, setAddPermissions] = useState({
		view_signups: false,
		manage_signups: false,
	});
	const [adding, setAdding] = useState(false);

	// Edit state
	const [editingGroupId, setEditingGroupId] = useState(null);
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
			const [pricingData, permissionData, groupsData] = await Promise.all(
				[
					apiFetch({
						path: `/fair-events/v1/event-dates/${eventDateId}/group-pricing-rules`,
					}),
					apiFetch({
						path: `/fair-events/v1/event-dates/${eventDateId}/group-permission-rules`,
					}),
					apiFetch({
						path: '/fair-audience/v1/groups',
					}),
				]
			);

			setPricingRules(pricingData);
			setPermissionRules(permissionData);
			setGroups(groupsData);
		} catch (err) {
			setError(
				err.message || __('Failed to load group rules.', 'fair-events')
			);
		} finally {
			setLoading(false);
		}
	};

	// Build per-group merged view
	const groupsWithRules = [];
	const groupIdsWithRules = new Set();

	pricingRules.forEach((pr) => groupIdsWithRules.add(pr.group_id));
	permissionRules.forEach((pr) => groupIdsWithRules.add(pr.group_id));

	groupIdsWithRules.forEach((groupId) => {
		const group = groups.find((g) => g.id === groupId);
		const pricing = pricingRules.find((r) => r.group_id === groupId);
		const permissions = permissionRules.filter(
			(r) => r.group_id === groupId
		);

		groupsWithRules.push({
			groupId,
			groupName:
				group?.name || pricing?.group_name || `Group #${groupId}`,
			pricing,
			permissions,
		});
	});

	const availableGroups = groups.filter((g) => !groupIdsWithRules.has(g.id));

	const handleAdd = async () => {
		if (!selectedGroupId) return;

		const hasDiscount = discountValue && parseFloat(discountValue) > 0;
		const selectedPerms = PERMISSION_TYPES.filter((p) => addPermissions[p]);

		if (!hasDiscount && selectedPerms.length === 0) return;

		setAdding(true);
		setError(null);
		setSuccess(null);

		try {
			const promises = [];

			if (hasDiscount) {
				promises.push(
					apiFetch({
						path: `/fair-events/v1/event-dates/${eventDateId}/group-pricing-rules`,
						method: 'POST',
						data: {
							group_id: parseInt(selectedGroupId, 10),
							discount_type: discountType,
							discount_value: parseFloat(discountValue),
						},
					})
				);
			}

			for (const perm of selectedPerms) {
				promises.push(
					apiFetch({
						path: `/fair-events/v1/event-dates/${eventDateId}/group-permission-rules`,
						method: 'POST',
						data: {
							group_id: parseInt(selectedGroupId, 10),
							permission_type: perm,
						},
					})
				);
			}

			await Promise.all(promises);
			await loadData();

			setSelectedGroupId('');
			setDiscountValue('');
			setDiscountType('percentage');
			setAddPermissions({ view_signups: false, manage_signups: false });
			setSuccess(__('Group rules added.', 'fair-events'));
		} catch (err) {
			setError(
				err.message || __('Failed to add group rules.', 'fair-events')
			);
		} finally {
			setAdding(false);
		}
	};

	const handleStartEdit = (groupEntry) => {
		setEditingGroupId(groupEntry.groupId);
		if (groupEntry.pricing) {
			setEditDiscountType(groupEntry.pricing.discount_type);
			setEditDiscountValue(String(groupEntry.pricing.discount_value));
		} else {
			setEditDiscountType('percentage');
			setEditDiscountValue('');
		}
	};

	const handleCancelEdit = () => {
		setEditingGroupId(null);
	};

	const handleSaveEdit = async (groupEntry) => {
		setSaving(true);
		setError(null);
		setSuccess(null);

		try {
			const hasNewDiscount =
				editDiscountValue && parseFloat(editDiscountValue) > 0;

			if (groupEntry.pricing && hasNewDiscount) {
				// Update existing pricing rule
				await apiFetch({
					path: `/fair-events/v1/event-dates/${eventDateId}/group-pricing-rules/${groupEntry.pricing.id}`,
					method: 'PUT',
					data: {
						discount_type: editDiscountType,
						discount_value: parseFloat(editDiscountValue),
					},
				});
			} else if (groupEntry.pricing && !hasNewDiscount) {
				// Remove pricing rule
				await apiFetch({
					path: `/fair-events/v1/event-dates/${eventDateId}/group-pricing-rules/${groupEntry.pricing.id}`,
					method: 'DELETE',
				});
			} else if (!groupEntry.pricing && hasNewDiscount) {
				// Create new pricing rule
				await apiFetch({
					path: `/fair-events/v1/event-dates/${eventDateId}/group-pricing-rules`,
					method: 'POST',
					data: {
						group_id: groupEntry.groupId,
						discount_type: editDiscountType,
						discount_value: parseFloat(editDiscountValue),
					},
				});
			}

			await loadData();
			setEditingGroupId(null);
			setSuccess(__('Group rules updated.', 'fair-events'));
		} catch (err) {
			setError(
				err.message ||
					__('Failed to update group rules.', 'fair-events')
			);
		} finally {
			setSaving(false);
		}
	};

	const handleTogglePermission = async (groupId, permType, currentRule) => {
		setError(null);
		setSuccess(null);

		try {
			if (currentRule) {
				// Delete permission
				await apiFetch({
					path: `/fair-events/v1/event-dates/${eventDateId}/group-permission-rules/${currentRule.id}`,
					method: 'DELETE',
				});
			} else {
				// Create permission
				await apiFetch({
					path: `/fair-events/v1/event-dates/${eventDateId}/group-permission-rules`,
					method: 'POST',
					data: {
						group_id: groupId,
						permission_type: permType,
					},
				});
			}

			await loadData();
		} catch (err) {
			setError(
				err.message || __('Failed to update permission.', 'fair-events')
			);
		}
	};

	const handleRemoveGroup = async (groupEntry) => {
		if (
			!window.confirm(
				__(
					'Are you sure you want to remove all rules for this group?',
					'fair-events'
				)
			)
		) {
			return;
		}

		setError(null);
		setSuccess(null);

		try {
			const promises = [];

			if (groupEntry.pricing) {
				promises.push(
					apiFetch({
						path: `/fair-events/v1/event-dates/${eventDateId}/group-pricing-rules/${groupEntry.pricing.id}`,
						method: 'DELETE',
					})
				);
			}

			for (const perm of groupEntry.permissions) {
				promises.push(
					apiFetch({
						path: `/fair-events/v1/event-dates/${eventDateId}/group-permission-rules/${perm.id}`,
						method: 'DELETE',
					})
				);
			}

			await Promise.all(promises);
			await loadData();
			setSuccess(__('Group rules removed.', 'fair-events'));
		} catch (err) {
			setError(
				err.message ||
					__('Failed to remove group rules.', 'fair-events')
			);
		}
	};

	return (
		<Card style={{ marginTop: '16px' }}>
			<CardHeader>
				<h2>{__('Group Rules', 'fair-events')}</h2>
			</CardHeader>
			<CardBody>
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
							{groupsWithRules.length > 0 &&
								groupsWithRules.map((entry) => (
									<Card key={entry.groupId}>
										<CardBody>
											{editingGroupId ===
											entry.groupId ? (
												<VStack spacing={3}>
													<HStack alignment="center">
														<h3
															style={{
																margin: 0,
															}}
														>
															{entry.groupName}
														</h3>
													</HStack>
													<HStack
														spacing={4}
														alignment="top"
														wrap
													>
														<SelectControl
															label={__(
																'Discount Type',
																'fair-events'
															)}
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
														<TextControl
															label={__(
																'Discount Value',
																'fair-events'
															)}
															type="number"
															value={
																editDiscountValue
															}
															onChange={
																setEditDiscountValue
															}
															min="0"
															step="0.01"
															placeholder={__(
																'0 = no discount',
																'fair-events'
															)}
															__nextHasNoMarginBottom
														/>
													</HStack>
													<HStack spacing={2}>
														<Button
															variant="primary"
															size="small"
															onClick={() =>
																handleSaveEdit(
																	entry
																)
															}
															isBusy={saving}
															disabled={saving}
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
												</VStack>
											) : (
												<VStack spacing={2}>
													<HStack alignment="center">
														<h3
															style={{
																margin: 0,
															}}
														>
															{entry.groupName}
														</h3>
														<HStack spacing={2}>
															<Button
																variant="secondary"
																size="small"
																onClick={() =>
																	handleStartEdit(
																		entry
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
																	handleRemoveGroup(
																		entry
																	)
																}
															>
																{__(
																	'Remove',
																	'fair-events'
																)}
															</Button>
														</HStack>
													</HStack>
													{entry.pricing && (
														<p
															style={{
																margin: 0,
															}}
														>
															{__(
																'Discount:',
																'fair-events'
															)}{' '}
															{formatDiscount(
																entry.pricing
																	.discount_type,
																entry.pricing
																	.discount_value
															)}
														</p>
													)}
													<HStack spacing={4} wrap>
														{PERMISSION_TYPES.map(
															(permType) => {
																const rule =
																	entry.permissions.find(
																		(p) =>
																			p.permission_type ===
																			permType
																	);
																return (
																	<CheckboxControl
																		key={
																			permType
																		}
																		label={permissionLabel(
																			permType
																		)}
																		checked={
																			!!rule
																		}
																		onChange={() =>
																			handleTogglePermission(
																				entry.groupId,
																				permType,
																				rule
																			)
																		}
																		__nextHasNoMarginBottom
																	/>
																);
															}
														)}
													</HStack>
												</VStack>
											)}
										</CardBody>
									</Card>
								))}

							{groupsWithRules.length === 0 && (
								<p
									style={{
										textAlign: 'center',
										color: '#666',
									}}
								>
									{__(
										'No group rules yet. Add one below.',
										'fair-events'
									)}
								</p>
							)}

							{availableGroups.length > 0 && (
								<VStack spacing={3}>
									<h3 style={{ margin: 0 }}>
										{__('Add Group', 'fair-events')}
									</h3>
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
									<HStack spacing={4} alignment="top" wrap>
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
													? __(
															'e.g. 10',
															'fair-events'
													  )
													: __(
															'e.g. 5.00',
															'fair-events'
													  )
											}
										/>
									</HStack>
									<HStack spacing={4} wrap>
										{PERMISSION_TYPES.map((permType) => (
											<CheckboxControl
												key={permType}
												label={permissionLabel(
													permType
												)}
												checked={
													addPermissions[permType]
												}
												onChange={(checked) =>
													setAddPermissions({
														...addPermissions,
														[permType]: checked,
													})
												}
												__nextHasNoMarginBottom
											/>
										))}
									</HStack>
									<Button
										variant="primary"
										onClick={handleAdd}
										isBusy={adding}
										disabled={
											adding ||
											!selectedGroupId ||
											(!discountValue &&
												!PERMISSION_TYPES.some(
													(p) => addPermissions[p]
												))
										}
									>
										{__('Add', 'fair-events')}
									</Button>
								</VStack>
							)}

							{availableGroups.length === 0 &&
								groups.length > 0 && (
									<Notice status="info" isDismissible={false}>
										{__(
											'All groups already have rules for this event.',
											'fair-events'
										)}
									</Notice>
								)}
						</>
					)}
				</VStack>
			</CardBody>
		</Card>
	);
}
