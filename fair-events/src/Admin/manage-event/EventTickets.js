/**
 * Event Tickets Component
 *
 * Manages ticket types, sale periods, and pricing in a 2D grid.
 *
 * @package FairEvents
 */

import { useState, useEffect, useCallback } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	CheckboxControl,
	Panel,
	PanelBody,
	Spinner,
	Notice,
	TextControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

export default function EventTickets({
	eventDateId,
	onSaveRef,
	initialData,
	onDataRef,
}) {
	const [capacity, setCapacity] = useState('');
	const [ticketTypes, setTicketTypes] = useState([]);
	const [salePeriods, setSalePeriods] = useState([]);
	const [prices, setPrices] = useState({});
	const [settings, setSettings] = useState({
		continues_pricing_period: true,
		unlimited_tickets_in_price_period: true,
	});
	const [loading, setLoading] = useState(!initialData);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);

	const populateFromData = useCallback((data) => {
		setCapacity(
			data.capacity !== null && data.capacity !== undefined
				? String(data.capacity)
				: ''
		);
		setTicketTypes(data.ticket_types || []);
		setSalePeriods(data.sale_periods || []);

		const priceMap = {};
		(data.prices || []).forEach((p) => {
			const key = `${p.ticket_type_id}-${p.sale_period_id}`;
			priceMap[key] = {
				price: String(p.price),
				capacity:
					p.capacity !== null && p.capacity !== undefined
						? String(p.capacity)
						: '',
			};
		});
		setPrices(priceMap);

		if (data.settings) {
			setSettings((prev) => ({ ...prev, ...data.settings }));
		}
	}, []);

	const loadTickets = useCallback(async () => {
		setLoading(true);
		try {
			const data = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}/tickets`,
			});
			populateFromData(data);
		} catch (err) {
			setError(
				err.message || __('Failed to load tickets.', 'fair-events')
			);
		} finally {
			setLoading(false);
		}
	}, [eventDateId, populateFromData]);

	useEffect(() => {
		if (initialData) {
			populateFromData(initialData);
		} else {
			loadTickets();
		}
	}, [initialData, loadTickets, populateFromData]);

	useEffect(() => {
		if (onSaveRef) {
			onSaveRef.current = handleSave;
		}
	});

	useEffect(() => {
		if (onDataRef) {
			onDataRef.current = () => {
				const pricesArray = [];
				Object.entries(prices).forEach(([key, val]) => {
					if (val.price === '' && val.capacity === '') return;
					const [typeId, periodId] = key.split('-').map(Number);
					pricesArray.push({
						ticket_type_id: typeId,
						sale_period_id: periodId,
						price: parseFloat(val.price) || 0,
						capacity:
							val.capacity !== ''
								? parseInt(val.capacity, 10)
								: null,
					});
				});
				return {
					capacity: capacity !== '' ? parseInt(capacity, 10) : null,
					ticket_types: ticketTypes.map((t, i) => ({
						...t,
						sort_order: i,
					})),
					sale_periods: salePeriods.map((p, i) => ({
						...p,
						sort_order: i,
					})),
					prices: pricesArray,
					settings,
				};
			};
		}
	});

	const handleSave = async () => {
		setSaving(true);
		setError(null);
		setSuccess(null);

		const pricesArray = [];
		Object.entries(prices).forEach(([key, val]) => {
			if (val.price === '' && val.capacity === '') return;
			const [typeId, periodId] = key.split('-').map(Number);
			pricesArray.push({
				ticket_type_id: typeId,
				sale_period_id: periodId,
				price: parseFloat(val.price) || 0,
				capacity:
					val.capacity !== '' ? parseInt(val.capacity, 10) : null,
			});
		});

		try {
			const data = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}/tickets`,
				method: 'PUT',
				data: {
					capacity: capacity !== '' ? parseInt(capacity, 10) : null,
					ticket_types: ticketTypes.map((t, i) => ({
						...t,
						sort_order: i,
					})),
					sale_periods: salePeriods.map((p, i) => ({
						...p,
						sort_order: i,
					})),
					prices: pricesArray,
					settings,
				},
			});

			setCapacity(
				data.capacity !== null && data.capacity !== undefined
					? String(data.capacity)
					: ''
			);
			setTicketTypes(data.ticket_types || []);
			setSalePeriods(data.sale_periods || []);

			const priceMap = {};
			(data.prices || []).forEach((p) => {
				const key = `${p.ticket_type_id}-${p.sale_period_id}`;
				priceMap[key] = {
					price: String(p.price),
					capacity:
						p.capacity !== null && p.capacity !== undefined
							? String(p.capacity)
							: '',
				};
			});
			setPrices(priceMap);

			if (data.settings) {
				setSettings((prev) => ({ ...prev, ...data.settings }));
			}

			setSuccess(__('Tickets saved successfully.', 'fair-events'));
		} catch (err) {
			setError(
				err.message || __('Failed to save tickets.', 'fair-events')
			);
		} finally {
			setSaving(false);
		}
	};

	const addTicketType = () => {
		setTicketTypes([
			...ticketTypes,
			{
				name: '',
				capacity: null,
				sort_order: ticketTypes.length,
			},
		]);
	};

	const removeTicketType = (index) => {
		const type = ticketTypes[index];
		setTicketTypes(ticketTypes.filter((_, i) => i !== index));

		if (type.id) {
			const newPrices = { ...prices };
			salePeriods.forEach((p) => {
				delete newPrices[`${type.id}-${p.id}`];
			});
			setPrices(newPrices);
		}
	};

	const updateTicketType = (index, field, value) => {
		const updated = [...ticketTypes];
		updated[index] = { ...updated[index], [field]: value };
		setTicketTypes(updated);
	};

	const addSalePeriod = () => {
		const lastPeriod = salePeriods[salePeriods.length - 1];
		setSalePeriods([
			...salePeriods,
			{
				name: '',
				sale_start: lastPeriod?.sale_end || '',
				sale_end: '',
				sort_order: salePeriods.length,
			},
		]);
	};

	const removeSalePeriod = (index) => {
		const period = salePeriods[index];
		setSalePeriods(salePeriods.filter((_, i) => i !== index));

		if (period.id) {
			const newPrices = { ...prices };
			ticketTypes.forEach((t) => {
				delete newPrices[`${t.id}-${period.id}`];
			});
			setPrices(newPrices);
		}
	};

	const updateSalePeriod = (index, field, value) => {
		const updated = [...salePeriods];
		updated[index] = { ...updated[index], [field]: value };
		setSalePeriods(updated);
	};

	const getPriceKey = (type, period) => {
		const typeKey = type.id || `new-${ticketTypes.indexOf(type)}`;
		const periodKey = period.id || `new-${salePeriods.indexOf(period)}`;
		return `${typeKey}-${periodKey}`;
	};

	const updatePrice = (type, period, field, value) => {
		const key = getPriceKey(type, period);
		setPrices((prev) => ({
			...prev,
			[key]: {
				...(prev[key] || { price: '', capacity: '' }),
				[field]: value,
			},
		}));
	};

	const getPrice = (type, period) => {
		const key = getPriceKey(type, period);
		return prices[key] || { price: '', capacity: '' };
	};

	if (loading) {
		return (
			<Card style={{ marginTop: '16px' }}>
				<CardBody>
					<Spinner />
				</CardBody>
			</Card>
		);
	}

	return (
		<VStack
			spacing={4}
			className="fair-events-tickets"
			style={{ marginTop: '16px' }}
		>
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

			<Card>
				<CardHeader>
					<h2>{__('Event Capacity', 'fair-events')}</h2>
				</CardHeader>
				<CardBody>
					<TextControl
						label={__('Total capacity', 'fair-events')}
						type="number"
						min="0"
						value={capacity}
						onChange={setCapacity}
						help={__(
							'Leave empty for unlimited capacity.',
							'fair-events'
						)}
					/>
				</CardBody>
			</Card>

			<Card>
				<CardHeader>
					<h2>{__('Ticket Pricing Grid', 'fair-events')}</h2>
				</CardHeader>
				<CardBody>
					{ticketTypes.length === 0 && salePeriods.length === 0 ? (
						<VStack spacing={3}>
							<p>
								{__(
									'Add ticket types and sale periods to configure pricing.',
									'fair-events'
								)}
							</p>
							<HStack spacing={2}>
								<Button
									variant="secondary"
									onClick={addTicketType}
								>
									{__('+ Add Ticket Type', 'fair-events')}
								</Button>
								<Button
									variant="secondary"
									onClick={addSalePeriod}
								>
									{__('+ Add Sale Period', 'fair-events')}
								</Button>
							</HStack>
						</VStack>
					) : (
						<VStack spacing={4}>
							<div style={{ overflowX: 'auto' }}>
								<table className="wp-list-table widefat striped">
									<thead>
										<tr>
											<th>
												{__(
													'Ticket Type',
													'fair-events'
												)}
											</th>
											<th>
												{__('Capacity', 'fair-events')}
											</th>
											{salePeriods.map(
												(period, pIndex) => (
													<th
														key={
															period.id ||
															`new-${pIndex}`
														}
													>
														<VStack spacing={1}>
															<TextControl
																placeholder={__(
																	'Period name',
																	'fair-events'
																)}
																value={
																	period.name ||
																	''
																}
																onChange={(v) =>
																	updateSalePeriod(
																		pIndex,
																		'name',
																		v
																	)
																}
															/>
															<TextControl
																type="datetime-local"
																value={
																	period.sale_start
																		? period.sale_start.replace(
																				' ',
																				'T'
																		  )
																		: ''
																}
																onChange={(v) =>
																	updateSalePeriod(
																		pIndex,
																		'sale_start',
																		v.replace(
																			'T',
																			' '
																		)
																	)
																}
																placeholder={__(
																	'Start',
																	'fair-events'
																)}
															/>
															<TextControl
																type="datetime-local"
																value={
																	period.sale_end
																		? period.sale_end.replace(
																				' ',
																				'T'
																		  )
																		: ''
																}
																onChange={(v) =>
																	updateSalePeriod(
																		pIndex,
																		'sale_end',
																		v.replace(
																			'T',
																			' '
																		)
																	)
																}
																placeholder={__(
																	'End',
																	'fair-events'
																)}
															/>
															<Button
																variant="tertiary"
																isDestructive
																size="small"
																onClick={() =>
																	removeSalePeriod(
																		pIndex
																	)
																}
															>
																{__(
																	'Remove',
																	'fair-events'
																)}
															</Button>
														</VStack>
													</th>
												)
											)}
											<th>
												<Button
													variant="secondary"
													size="small"
													onClick={addSalePeriod}
												>
													{__(
														'+ Period',
														'fair-events'
													)}
												</Button>
											</th>
										</tr>
									</thead>
									<tbody>
										{ticketTypes.map((type, tIndex) => (
											<tr
												key={type.id || `new-${tIndex}`}
											>
												<td>
													<TextControl
														placeholder={__(
															'Type name',
															'fair-events'
														)}
														value={type.name || ''}
														onChange={(v) =>
															updateTicketType(
																tIndex,
																'name',
																v
															)
														}
													/>
												</td>
												<td>
													<TextControl
														type="number"
														min="0"
														placeholder={__(
															'Unlimited',
															'fair-events'
														)}
														value={
															type.capacity !==
																null &&
															type.capacity !==
																undefined
																? String(
																		type.capacity
																  )
																: ''
														}
														onChange={(v) =>
															updateTicketType(
																tIndex,
																'capacity',
																v !== ''
																	? parseInt(
																			v,
																			10
																	  )
																	: null
															)
														}
													/>
												</td>
												{salePeriods.map(
													(period, pIndex) => {
														const cell = getPrice(
															type,
															period
														);
														return (
															<td
																key={
																	period.id ||
																	`new-${pIndex}`
																}
															>
																<VStack
																	spacing={1}
																>
																	<TextControl
																		type="number"
																		step="0.01"
																		min="0"
																		placeholder={__(
																			'Price',
																			'fair-events'
																		)}
																		value={
																			cell.price
																		}
																		onChange={(
																			v
																		) =>
																			updatePrice(
																				type,
																				period,
																				'price',
																				v
																			)
																		}
																	/>
																	{!settings.unlimited_tickets_in_price_period && (
																		<TextControl
																			type="number"
																			min="0"
																			placeholder={__(
																				'Cap',
																				'fair-events'
																			)}
																			value={
																				cell.capacity
																			}
																			onChange={(
																				v
																			) =>
																				updatePrice(
																					type,
																					period,
																					'capacity',
																					v
																				)
																			}
																		/>
																	)}
																</VStack>
															</td>
														);
													}
												)}
												<td>
													<Button
														variant="tertiary"
														isDestructive
														size="small"
														onClick={() =>
															removeTicketType(
																tIndex
															)
														}
													>
														{__(
															'Remove',
															'fair-events'
														)}
													</Button>
												</td>
											</tr>
										))}
									</tbody>
									<tfoot>
										<tr>
											<td
												colSpan={salePeriods.length + 3}
											>
												<Button
													variant="secondary"
													size="small"
													onClick={addTicketType}
												>
													{__(
														'+ Add Ticket Type',
														'fair-events'
													)}
												</Button>
											</td>
										</tr>
									</tfoot>
								</table>
							</div>
						</VStack>
					)}
				</CardBody>
			</Card>

			<Card>
				<Panel>
					<PanelBody
						title={__('Settings', 'fair-events')}
						initialOpen={false}
					>
						<VStack spacing={4}>
							<CheckboxControl
								label={__(
									'Continues pricing period',
									'fair-events'
								)}
								checked={settings.continues_pricing_period}
								onChange={(value) =>
									setSettings((prev) => ({
										...prev,
										continues_pricing_period: value,
									}))
								}
							/>
							<CheckboxControl
								label={__(
									'Unlimited tickets in pricing period',
									'fair-events'
								)}
								checked={
									settings.unlimited_tickets_in_price_period
								}
								onChange={(value) =>
									setSettings((prev) => ({
										...prev,
										unlimited_tickets_in_price_period:
											value,
									}))
								}
							/>
						</VStack>
					</PanelBody>
				</Panel>
			</Card>
		</VStack>
	);
}
