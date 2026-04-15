/**
 * Event Tickets Component
 *
 * Manages ticket types, sale periods, and pricing in a 2D grid.
 *
 * @package FairEvents
 */

import { useState, useEffect, useCallback, useRef } from '@wordpress/element';
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
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

export default function EventTickets({
	eventDateId,
	onSaveRef,
	initialData,
	onDataRef,
}) {
	const [capacity, setCapacity] = useState('');
	const [signupPrice, setSignupPrice] = useState('');
	const [endDatetime, setEndDatetime] = useState('');
	const [ticketTypes, setTicketTypes] = useState([]);
	const [salePeriods, setSalePeriods] = useState([]);
	const [prices, setPrices] = useState({});
	const [settings, setSettings] = useState({
		continues_pricing_period: true,
		unlimited_tickets_in_price_period: true,
		show_ticket_type_capacity: false,
		multiple_pricing_periods: false,
		show_seats_per_ticket: false,
	});
	const [loading, setLoading] = useState(!initialData);
	const [saving, setSaving] = useState(false);
	const [importing, setImporting] = useState(false);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);
	const [pricingRules, setPricingRules] = useState([]);
	const fileInputRef = useRef(null);

	const hasAdvancedTickets = ticketTypes.length > 0 || salePeriods.length > 0;

	const populateFromData = useCallback((data) => {
		setCapacity(
			data.capacity !== null && data.capacity !== undefined
				? String(data.capacity)
				: ''
		);
		setSignupPrice(
			data.signup_price !== null && data.signup_price !== undefined
				? String(data.signup_price)
				: ''
		);
		if (data.end_datetime) {
			setEndDatetime(data.end_datetime);
		}
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
		if (!eventDateId) return;
		apiFetch({
			path: `/fair-events/v1/event-dates/${eventDateId}/group-pricing-rules`,
		})
			.then((rules) => setPricingRules(rules || []))
			.catch(() => setPricingRules([]));
	}, [eventDateId]);

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
					signup_price: hasAdvancedTickets
						? null
						: signupPrice.trim() === ''
						? null
						: parseFloat(signupPrice),
					ticket_types: ticketTypes.map((t, i) => ({
						...t,
						sort_order: i,
					})),
					sale_periods: getEffectiveSalePeriods().map((p, i) => ({
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
					signup_price: hasAdvancedTickets
						? null
						: signupPrice.trim() === ''
						? null
						: parseFloat(signupPrice),
					ticket_types: ticketTypes.map((t, i) => ({
						...t,
						sort_order: i,
					})),
					sale_periods: getEffectiveSalePeriods().map((p, i) => ({
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
			setSignupPrice(
				data.signup_price !== null && data.signup_price !== undefined
					? String(data.signup_price)
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

	const buildExportPayload = () => {
		const exportPrices = [];
		ticketTypes.forEach((type, tIndex) => {
			salePeriods.forEach((period, pIndex) => {
				const cell = getPrice(type, period);
				if (cell.price === '' && cell.capacity === '') return;
				exportPrices.push({
					ticket_type_index: tIndex,
					sale_period_index: pIndex,
					price: parseFloat(cell.price) || 0,
					capacity:
						cell.capacity !== ''
							? parseInt(cell.capacity, 10)
							: null,
				});
			});
		});

		return {
			version: 1,
			type: 'fair-events-tickets',
			exported_at: new Date().toISOString(),
			capacity: capacity !== '' ? parseInt(capacity, 10) : null,
			signup_price: hasAdvancedTickets
				? null
				: signupPrice.trim() === ''
				? null
				: parseFloat(signupPrice),
			settings,
			ticket_types: ticketTypes.map((t) => ({
				name: t.name || '',
				capacity:
					t.capacity !== null && t.capacity !== undefined
						? t.capacity
						: null,
				seats_per_ticket: t.seats_per_ticket || 1,
			})),
			sale_periods: getEffectiveSalePeriods().map((p) => ({
				name: p.name || '',
				sale_start: p.sale_start || '',
				sale_end: p.sale_end || '',
			})),
			prices: exportPrices,
		};
	};

	const handleExport = () => {
		try {
			const payload = buildExportPayload();
			const json = JSON.stringify(payload, null, 2);
			const blob = new Blob([json], { type: 'application/json' });
			const url = URL.createObjectURL(blob);
			const a = document.createElement('a');
			a.href = url;
			a.download = `tickets-event-${eventDateId}-${new Date()
				.toISOString()
				.slice(0, 10)}.json`;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
		} catch (err) {
			setError(
				err.message ||
					__('Failed to export ticket configuration.', 'fair-events')
			);
		}
	};

	const handleImportFile = async (event) => {
		const file = event.target.files && event.target.files[0];
		if (file) {
			if (
				!window.confirm(
					__(
						'Importing will replace all current ticket types, sale periods, prices, and settings for this event. Continue?',
						'fair-events'
					)
				)
			) {
				event.target.value = '';
				return;
			}

			setImporting(true);
			setError(null);
			setSuccess(null);

			try {
				const text = await file.text();
				const parsed = JSON.parse(text);

				if (
					!parsed ||
					typeof parsed !== 'object' ||
					parsed.type !== 'fair-events-tickets'
				) {
					throw new Error(
						__(
							'Invalid file format. Expected a fair-events-tickets export.',
							'fair-events'
						)
					);
				}

				const data = await apiFetch({
					path: `/fair-events/v1/event-dates/${eventDateId}/tickets/import`,
					method: 'POST',
					data: parsed,
				});

				populateFromData(data);
				setSuccess(
					__(
						'Ticket configuration imported successfully.',
						'fair-events'
					)
				);
			} catch (err) {
				setError(
					err.message ||
						__(
							'Failed to import ticket configuration.',
							'fair-events'
						)
				);
			} finally {
				setImporting(false);
				event.target.value = '';
			}
		}
	};

	const addTicketType = () => {
		setTicketTypes([
			...ticketTypes,
			{
				name: '',
				capacity: null,
				seats_per_ticket: 1,
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

	const formatNow = () => {
		const now = new Date();
		const pad = (n) => String(n).padStart(2, '0');
		return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(
			now.getDate()
		)} ${pad(now.getHours())}:${pad(now.getMinutes())}:00`;
	};

	const addSalePeriod = () => {
		const lastPeriod = salePeriods[salePeriods.length - 1];
		const isFirst = salePeriods.length === 0;
		const defaultStart = isFirst ? formatNow() : lastPeriod?.sale_end || '';
		setSalePeriods([
			...salePeriods,
			{
				name: '',
				sale_start: defaultStart,
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

		if (settings.continues_pricing_period && field === 'sale_end') {
			const next = index + 1;
			if (next < updated.length) {
				updated[next] = { ...updated[next], sale_start: value };
			}
		}

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

	const getEffectiveSalePeriods = () => {
		if (!settings.continues_pricing_period) {
			return salePeriods;
		}
		return salePeriods.map((p, i) => {
			const updated = { ...p };
			if (i > 0) {
				updated.sale_start = salePeriods[i - 1].sale_end || '';
			}
			if (i === salePeriods.length - 1 && endDatetime) {
				updated.sale_end = endDatetime;
			}
			return updated;
		});
	};

	const getPrice = (type, period) => {
		const key = getPriceKey(type, period);
		return prices[key] || { price: '', capacity: '' };
	};

	const formatCurrency = (value) => {
		return new Intl.NumberFormat('en-US', {
			style: 'currency',
			currency: 'EUR',
		}).format(value);
	};

	const applyDiscount = (basePrice, type, value) => {
		const discounted =
			type === 'percentage'
				? basePrice * (1 - value / 100)
				: basePrice - value;
		return Math.max(0, discounted);
	};

	const formatDiscount = (type, value) => {
		if (type === 'percentage') {
			return `${value}%`;
		}
		return formatCurrency(value);
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

			<HStack spacing={2} justify="flex-end">
				<Button
					variant="secondary"
					onClick={handleExport}
					disabled={importing || saving}
				>
					{__('Export ticket settings', 'fair-events')}
				</Button>
				<Button
					variant="secondary"
					onClick={() => fileInputRef.current?.click()}
					disabled={importing || saving}
					isBusy={importing}
				>
					{__('Import ticket settings', 'fair-events')}
				</Button>
				<input
					ref={fileInputRef}
					type="file"
					accept="application/json,.json"
					style={{ display: 'none' }}
					onChange={handleImportFile}
				/>
			</HStack>

			{!hasAdvancedTickets && (
				<Card>
					<CardHeader>
						<strong>{__('Signup price', 'fair-events')}</strong>
					</CardHeader>
					<CardBody>
						<p>
							{signupPrice.trim() === ''
								? __(
										'Free signup. Enter a price below to charge for this event, or switch to advanced ticketing for multiple ticket types.',
										'fair-events'
								  )
								: sprintf(
										/* translators: %s: formatted price */
										__(
											'Signup price: %s. Group discounts configured in the Groups tab still apply.',
											'fair-events'
										),
										formatCurrency(
											parseFloat(signupPrice) || 0
										)
								  )}
						</p>
						{signupPrice.trim() !== '' &&
							pricingRules.length > 0 && (
								<ul
									style={{
										margin: '8px 0 0',
										paddingLeft: '20px',
									}}
								>
									{pricingRules.map((rule) => {
										const base =
											parseFloat(signupPrice) || 0;
										const finalPrice = applyDiscount(
											base,
											rule.discount_type,
											parseFloat(rule.discount_value) || 0
										);
										return (
											<li key={rule.id}>
												{sprintf(
													/* translators: 1: group name, 2: discount, 3: final price */
													__(
														'%1$s: %2$s discount → %3$s',
														'fair-events'
													),
													rule.group_name ||
														`#${rule.group_id}`,
													formatDiscount(
														rule.discount_type,
														parseFloat(
															rule.discount_value
														) || 0
													),
													formatCurrency(finalPrice)
												)}
											</li>
										);
									})}
								</ul>
							)}
					</CardBody>
				</Card>
			)}

			{ticketTypes.length > 0 && salePeriods.length > 0 && (
				<Card>
					<CardHeader>
						<strong>{__('Ticket Prices', 'fair-events')}</strong>
					</CardHeader>
					<CardBody>
						<div style={{ overflowX: 'auto' }}>
							<table className="wp-list-table widefat striped">
								<thead>
									<tr>
										<th>
											{__('Ticket Type', 'fair-events')}
										</th>
										{salePeriods.map((period, pIndex) => (
											<th
												key={
													period.id || `new-${pIndex}`
												}
											>
												{settings.multiple_pricing_periods
													? period.name ||
													  __(
															'(unnamed)',
															'fair-events'
													  )
													: __(
															'Price',
															'fair-events'
													  )}
											</th>
										))}
									</tr>
								</thead>
								<tbody>
									{ticketTypes.map((type, tIndex) => (
										<tr key={type.id || `new-${tIndex}`}>
											<td>
												{type.name ||
													__(
														'(unnamed)',
														'fair-events'
													)}
											</td>
											{salePeriods.map(
												(period, pIndex) => {
													const cell = getPrice(
														type,
														period
													);
													const hasPrice =
														cell.price !== '';
													return (
														<td
															key={
																period.id ||
																`new-${pIndex}`
															}
														>
															{hasPrice
																? formatCurrency(
																		cell.price
																  )
																: '—'}
															{!settings.unlimited_tickets_in_price_period &&
																cell.capacity !==
																	'' &&
																` (${cell.capacity})`}
														</td>
													);
												}
											)}
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</CardBody>
				</Card>
			)}

			<Card>
				<Panel>
					<PanelBody
						title={__('Edit tickets', 'fair-events')}
						initialOpen={false}
					>
						<VStack spacing={4}>
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
							{!hasAdvancedTickets ? (
								<VStack spacing={3}>
									<TextControl
										label={__(
											'Signup price (EUR)',
											'fair-events'
										)}
										help={__(
											'Leave empty for free signup. Group discounts (Groups tab) apply to this base price.',
											'fair-events'
										)}
										type="number"
										min="0"
										step="0.01"
										value={signupPrice}
										onChange={setSignupPrice}
										__nextHasNoMarginBottom
									/>
									<p>
										{__(
											'Need multiple ticket types or time-based pricing? Switch to advanced ticketing below.',
											'fair-events'
										)}
									</p>
									<HStack spacing={2}>
										<Button
											variant="secondary"
											onClick={() => {
												addTicketType();
												addSalePeriod();
											}}
										>
											{__(
												'Switch to advanced ticketing',
												'fair-events'
											)}
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
													{settings.show_ticket_type_capacity && (
														<th>
															{__(
																'Capacity',
																'fair-events'
															)}
														</th>
													)}
													{settings.show_seats_per_ticket && (
														<th>
															{__(
																'Seats',
																'fair-events'
															)}
														</th>
													)}
													{salePeriods.map(
														(period, pIndex) => {
															const isContinuous =
																settings.continues_pricing_period;
															const isFirst =
																pIndex === 0;
															const isLast =
																pIndex ===
																salePeriods.length -
																	1;
															const fromValue =
																isContinuous &&
																!isFirst
																	? salePeriods[
																			pIndex -
																				1
																	  ]
																			?.sale_end ||
																	  ''
																	: period.sale_start ||
																	  '';
															const untilValue =
																isContinuous &&
																isLast
																	? endDatetime
																	: period.sale_end ||
																	  '';

															return (
																<th
																	key={
																		period.id ||
																		`new-${pIndex}`
																	}
																>
																	{settings.multiple_pricing_periods ? (
																		<VStack
																			spacing={
																				1
																			}
																		>
																			<HStack
																				alignment="center"
																				spacing={
																					2
																				}
																			>
																				<span
																					style={{
																						whiteSpace:
																							'nowrap',
																					}}
																				>
																					{__(
																						'Name',
																						'fair-events'
																					)}
																				</span>
																				<TextControl
																					placeholder={__(
																						'Period name',
																						'fair-events'
																					)}
																					value={
																						period.name ||
																						''
																					}
																					onChange={(
																						v
																					) =>
																						updateSalePeriod(
																							pIndex,
																							'name',
																							v
																						)
																					}
																				/>
																			</HStack>
																			<HStack
																				alignment="center"
																				spacing={
																					2
																				}
																			>
																				<span
																					style={{
																						whiteSpace:
																							'nowrap',
																					}}
																				>
																					{__(
																						'From',
																						'fair-events'
																					)}
																				</span>
																				{isContinuous &&
																				!isFirst ? (
																					<span>
																						{fromValue.replace(
																							'T',
																							' '
																						)}
																					</span>
																				) : (
																					<TextControl
																						type="datetime-local"
																						value={
																							fromValue
																								? fromValue.replace(
																										' ',
																										'T'
																								  )
																								: ''
																						}
																						onChange={(
																							v
																						) =>
																							updateSalePeriod(
																								pIndex,
																								'sale_start',
																								v.replace(
																									'T',
																									' '
																								)
																							)
																						}
																					/>
																				)}
																			</HStack>
																			<HStack
																				alignment="center"
																				spacing={
																					2
																				}
																			>
																				<span
																					style={{
																						whiteSpace:
																							'nowrap',
																					}}
																				>
																					{__(
																						'Until',
																						'fair-events'
																					)}
																				</span>
																				{isContinuous &&
																				isLast ? (
																					<span>
																						{untilValue.replace(
																							'T',
																							' '
																						)}
																					</span>
																				) : (
																					<TextControl
																						type="datetime-local"
																						value={
																							untilValue
																								? untilValue.replace(
																										' ',
																										'T'
																								  )
																								: ''
																						}
																						onChange={(
																							v
																						) =>
																							updateSalePeriod(
																								pIndex,
																								'sale_end',
																								v.replace(
																									'T',
																									' '
																								)
																							)
																						}
																					/>
																				)}
																			</HStack>
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
																	) : (
																		<span>
																			{__(
																				'Price',
																				'fair-events'
																			)}
																		</span>
																	)}
																</th>
															);
														}
													)}
													{settings.multiple_pricing_periods && (
														<th>
															<Button
																variant="secondary"
																size="small"
																onClick={
																	addSalePeriod
																}
															>
																{__(
																	'+ Period',
																	'fair-events'
																)}
															</Button>
														</th>
													)}
												</tr>
											</thead>
											<tbody>
												{ticketTypes.map(
													(type, tIndex) => (
														<tr
															key={
																type.id ||
																`new-${tIndex}`
															}
														>
															<td>
																<TextControl
																	placeholder={__(
																		'Type name',
																		'fair-events'
																	)}
																	value={
																		type.name ||
																		''
																	}
																	onChange={(
																		v
																	) =>
																		updateTicketType(
																			tIndex,
																			'name',
																			v
																		)
																	}
																/>
															</td>
															{settings.show_ticket_type_capacity && (
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
																		onChange={(
																			v
																		) =>
																			updateTicketType(
																				tIndex,
																				'capacity',
																				v !==
																					''
																					? parseInt(
																							v,
																							10
																					  )
																					: null
																			)
																		}
																	/>
																</td>
															)}
															{settings.show_seats_per_ticket && (
																<td>
																	<TextControl
																		type="number"
																		min="1"
																		value={String(
																			type.seats_per_ticket ||
																				1
																		)}
																		onChange={(
																			v
																		) =>
																			updateTicketType(
																				tIndex,
																				'seats_per_ticket',
																				Math.max(
																					1,
																					parseInt(
																						v,
																						10
																					) ||
																						1
																				)
																			)
																		}
																		help={__(
																			'How many capacity slots this ticket consumes (1 = single, 2 = pair/+1).',
																			'fair-events'
																		)}
																	/>
																</td>
															)}
															{salePeriods.map(
																(
																	period,
																	pIndex
																) => {
																	const cell =
																		getPrice(
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
																				spacing={
																					1
																				}
																			>
																				<HStack
																					alignment="center"
																					spacing={
																						2
																					}
																				>
																					<span
																						style={{
																							whiteSpace:
																								'nowrap',
																						}}
																					>
																						{__(
																							'Price',
																							'fair-events'
																						)}
																					</span>
																					<TextControl
																						type="number"
																						step="0.01"
																						min="0"
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
																				</HStack>
																				{!settings.unlimited_tickets_in_price_period && (
																					<HStack
																						alignment="center"
																						spacing={
																							2
																						}
																					>
																						<span
																							style={{
																								whiteSpace:
																									'nowrap',
																							}}
																						>
																							{__(
																								'Cap',
																								'fair-events'
																							)}
																						</span>
																						<TextControl
																							type="number"
																							min="0"
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
																					</HStack>
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
													)
												)}
											</tbody>
											<tfoot>
												<tr>
													<td
														colSpan={
															salePeriods.length +
															1 +
															(settings.show_ticket_type_capacity
																? 1
																: 0) +
															(settings.show_seats_per_ticket
																? 1
																: 0)
														}
													>
														<Button
															variant="secondary"
															size="small"
															onClick={
																addTicketType
															}
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
						</VStack>
					</PanelBody>
				</Panel>
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
							<CheckboxControl
								label={__(
									'Per-ticket-type capacity',
									'fair-events'
								)}
								help={__(
									'Show a Capacity input on each ticket type to cap how many can be sold of that type.',
									'fair-events'
								)}
								checked={settings.show_ticket_type_capacity}
								onChange={(value) =>
									setSettings((prev) => ({
										...prev,
										show_ticket_type_capacity: value,
									}))
								}
							/>
							<CheckboxControl
								label={__(
									'Multiple pricing periods',
									'fair-events'
								)}
								help={__(
									'Enable time-based pricing with multiple sale periods (e.g. early bird, regular, late). When off, a single flat price applies for the whole sale window.',
									'fair-events'
								)}
								checked={settings.multiple_pricing_periods}
								onChange={(value) =>
									setSettings((prev) => ({
										...prev,
										multiple_pricing_periods: value,
									}))
								}
							/>
							<CheckboxControl
								label={__('Seats per ticket', 'fair-events')}
								help={__(
									'Show a Seats input on each ticket type to let one ticket consume more than one capacity slot (e.g. couples or +1 tickets). When off, every ticket counts as 1 seat.',
									'fair-events'
								)}
								checked={settings.show_seats_per_ticket}
								onChange={(value) =>
									setSettings((prev) => ({
										...prev,
										show_seats_per_ticket: value,
									}))
								}
							/>
							{hasAdvancedTickets ? (
								<Button
									variant="secondary"
									isDestructive
									onClick={() => {
										if (
											window.confirm(
												__(
													'Switching back to simple ticketing will remove all ticket types, sale periods, and prices. Continue?',
													'fair-events'
												)
											)
										) {
											setTicketTypes([]);
											setSalePeriods([]);
											setPrices({});
										}
									}}
								>
									{__(
										'Switch to simple ticketing',
										'fair-events'
									)}
								</Button>
							) : (
								<Button
									variant="secondary"
									onClick={() => {
										addTicketType();
										addSalePeriod();
									}}
								>
									{__(
										'Switch to advanced ticketing',
										'fair-events'
									)}
								</Button>
							)}
						</VStack>
					</PanelBody>
				</Panel>
			</Card>
		</VStack>
	);
}
