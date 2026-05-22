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
	FormTokenField,
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
		activity_collaborator_discount: false,
		minimum_activities: 0,
		show_ticket_type_minimum_activities: false,
	});
	const [options, setOptions] = useState([]);
	const [loading, setLoading] = useState(!initialData);
	const [saving, setSaving] = useState(false);
	const [importing, setImporting] = useState(false);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);
	const [pricingRules, setPricingRules] = useState([]);
	const [groups, setGroups] = useState([]);
	const [participants, setParticipants] = useState([]);
	const fileInputRef = useRef(null);

	const manageInvitationsUrl =
		window.fairEventsManageEventData?.manageInvitationsUrl || '';

	const hasAdvancedTickets = ticketTypes.length > 0 || salePeriods.length > 0;
	const hasInvitationTickets = ticketTypes.some((t) => t.invitation_only);
	const hasGroups = groups.length > 0;
	const groupNameById = Object.fromEntries(groups.map((g) => [g.id, g.name]));
	const groupIdByName = Object.fromEntries(groups.map((g) => [g.name, g.id]));
	const groupSuggestions = groups.map((g) => g.name);

	const formatParticipantLabel = (p) => {
		const fullName = `${p.name || ''} ${p.surname || ''}`.trim();
		return fullName || p.email || `#${p.id}`;
	};
	const participantLabelById = Object.fromEntries(
		participants.map((p) => [p.id, formatParticipantLabel(p)])
	);
	const participantIdByLabel = Object.fromEntries(
		participants.map((p) => [formatParticipantLabel(p), p.id])
	);
	const participantSuggestions = participants.map(formatParticipantLabel);

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
		(data.ticket_types || []).forEach((type) => {
			(data.sale_periods || []).forEach((period) => {
				priceMap[`${type.id}-${period.id}`] = {
					price: '',
					capacity: '',
					enabled: false,
				};
			});
		});
		(data.prices || []).forEach((p) => {
			const key = `${p.ticket_type_id}-${p.sale_period_id}`;
			priceMap[key] = {
				price: String(p.price),
				capacity:
					p.capacity !== null && p.capacity !== undefined
						? String(p.capacity)
						: '',
				enabled: true,
			};
		});
		setPrices(priceMap);

		if (data.settings) {
			setSettings((prev) => ({ ...prev, ...data.settings }));
		}
		setOptions((data.options || []).map(normalizeOption));
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
		apiFetch({ path: '/fair-audience/v1/groups' })
			.then((data) => setGroups(data || []))
			.catch(() => setGroups([]));
	}, []);

	useEffect(() => {
		apiFetch({ path: '/fair-audience/v1/participants?per_page=0' })
			.then((data) => setParticipants(Array.isArray(data) ? data : []))
			.catch(() => setParticipants([]));
	}, []);

	useEffect(() => {
		if (onSaveRef) {
			onSaveRef.current = handleSave;
		}
	});

	useEffect(() => {
		if (onDataRef) {
			onDataRef.current = () => {
				const pricesArray = [];
				ticketTypes.forEach((type, tIndex) => {
					salePeriods.forEach((period, pIndex) => {
						const val = getPrice(type, period);
						if (!val.enabled) return;
						if (val.price === '' && val.capacity === '') return;
						pricesArray.push({
							ticket_type_index: tIndex,
							sale_period_index: pIndex,
							price: parseFloat(val.price) || 0,
							capacity:
								val.capacity !== ''
									? parseInt(val.capacity, 10)
									: null,
						});
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
		ticketTypes.forEach((type, tIndex) => {
			salePeriods.forEach((period, pIndex) => {
				const val = getPrice(type, period);
				if (!val.enabled) return;
				if (val.price === '' && val.capacity === '') return;
				pricesArray.push({
					ticket_type_index: tIndex,
					sale_period_index: pIndex,
					price: parseFloat(val.price) || 0,
					capacity:
						val.capacity !== '' ? parseInt(val.capacity, 10) : null,
				});
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
					options: options.map((o, i) =>
						serializeOptionForSave(o, i)
					),
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
			(data.ticket_types || []).forEach((type) => {
				(data.sale_periods || []).forEach((period) => {
					priceMap[`${type.id}-${period.id}`] = {
						price: '',
						capacity: '',
						enabled: false,
					};
				});
			});
			(data.prices || []).forEach((p) => {
				const key = `${p.ticket_type_id}-${p.sale_period_id}`;
				priceMap[key] = {
					price: String(p.price),
					capacity:
						p.capacity !== null && p.capacity !== undefined
							? String(p.capacity)
							: '',
					enabled: true,
				};
			});
			setPrices(priceMap);

			if (data.settings) {
				setSettings((prev) => ({ ...prev, ...data.settings }));
			}
			setOptions((data.options || []).map(normalizeOption));

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
				invitation_only: t.invitation_only || false,
				minimum_activities: t.minimum_activities || 0,
				group_ids: t.group_ids || [],
			})),
			sale_periods: getEffectiveSalePeriods().map((p) => ({
				name: p.name || '',
				sale_start: p.sale_start || '',
				sale_end: p.sale_end || '',
			})),
			prices: exportPrices,
			options: options.map((o) => ({
				name: o.name || '',
				short_name: o.short_name || '',
				price: o.price !== undefined ? o.price : 0,
				discounted_price:
					o.discounted_price !== undefined &&
					o.discounted_price !== null &&
					o.discounted_price !== ''
						? o.discounted_price
						: null,
				capacity:
					o.capacity !== undefined &&
					o.capacity !== null &&
					o.capacity !== ''
						? o.capacity
						: null,
				derive_price_from_sale_period:
					!!o.derive_price_from_sale_period,
				period_prices: serializeOptionPeriodPrices(o).map((pp) => ({
					sale_period_index: pp.sale_period_index,
					price: pp.price,
				})),
				collaborator_ids: Array.isArray(o.collaborator_ids)
					? o.collaborator_ids
					: [],
			})),
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
				invitation_only: false,
				minimum_activities: 0,
				group_ids: [],
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

	const periodPriceKey = (period, pIndex) =>
		period && period.id ? String(period.id) : `new-${pIndex}`;

	const normalizeOption = (o) => {
		const map = {};
		(o.period_prices || []).forEach((pp) => {
			if (
				pp &&
				pp.sale_period_id !== undefined &&
				pp.sale_period_id !== null
			) {
				map[String(pp.sale_period_id)] = String(pp.price);
			}
		});
		return {
			...o,
			derive_price_from_sale_period: !!o.derive_price_from_sale_period,
			period_prices_map: map,
		};
	};

	const serializeOptionPeriodPrices = (option) => {
		if (!option.derive_price_from_sale_period) {
			return [];
		}
		const out = [];
		salePeriods.forEach((p, pIdx) => {
			const key = periodPriceKey(p, pIdx);
			const raw = option.period_prices_map?.[key];
			if (raw === undefined || raw === '') return;
			const entry = {
				sale_period_index: pIdx,
				price: parseFloat(raw) || 0,
			};
			if (p.id) entry.sale_period_id = p.id;
			out.push(entry);
		});
		return out;
	};

	const serializeOptionForSave = (option, index) => {
		const { period_prices_map: _unused, ...rest } = option;
		return {
			...rest,
			sort_order: index,
			derive_price_from_sale_period:
				!!option.derive_price_from_sale_period,
			period_prices: serializeOptionPeriodPrices(option),
		};
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

		if (settings.continues_pricing_period) {
			if (field === 'sale_end') {
				const next = index + 1;
				if (next < updated.length) {
					updated[next] = { ...updated[next], sale_start: value };
				}
			} else if (field === 'sale_start') {
				const prev = index - 1;
				if (prev >= 0) {
					updated[prev] = { ...updated[prev], sale_end: value };
				}
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
				...(prev[key] || { price: '', capacity: '', enabled: true }),
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
			if (i === salePeriods.length - 1 && endDatetime && !p.sale_end) {
				updated.sale_end = endDatetime;
			}
			return updated;
		});
	};

	const getPrice = (type, period) => {
		const key = getPriceKey(type, period);
		return prices[key] || { price: '', capacity: '', enabled: true };
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
				{(hasInvitationTickets ||
					settings.activity_collaborator_discount) &&
					manageInvitationsUrl && (
						<Button
							variant="secondary"
							href={`${manageInvitationsUrl}${eventDateId}`}
						>
							{__('Manage Invitations', 'fair-events')}
						</Button>
					)}
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

			{hasAdvancedTickets && (
				<Card>
					<Panel>
						<PanelBody
							title={__('Sale Periods', 'fair-events')}
							initialOpen={false}
						>
							<VStack spacing={4}>
								{salePeriods.length > 0 && (
									<HStack spacing={4} justify="flex-start">
										<div>
											<strong>
												{__(
													'Sale start at:',
													'fair-events'
												)}
											</strong>{' '}
											{salePeriods[0].sale_start
												? salePeriods[0].sale_start.replace(
														'T',
														' '
												  )
												: __('—', 'fair-events')}
										</div>
										<div>
											<strong>
												{__(
													'Sale end at:',
													'fair-events'
												)}
											</strong>{' '}
											{(() => {
												const last =
													salePeriods[
														salePeriods.length - 1
													];
												const value =
													last.sale_end ||
													endDatetime;
												return value
													? value.replace('T', ' ')
													: __('—', 'fair-events');
											})()}
										</div>
									</HStack>
								)}
								{settings.multiple_pricing_periods ? (
									<VStack spacing={3}>
										<div style={{ overflowX: 'auto' }}>
											<table className="wp-list-table widefat striped">
												<thead>
													<tr>
														<th>
															{__(
																'Name',
																'fair-events'
															)}
														</th>
														<th>
															{__(
																'From',
																'fair-events'
															)}
														</th>
														<th>
															{__(
																'Until',
																'fair-events'
															)}
														</th>
														<th />
													</tr>
												</thead>
												<tbody>
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
																	? period.sale_end ||
																	  endDatetime
																	: period.sale_end ||
																	  '';

															return (
																<tr
																	key={
																		period.id ||
																		`new-${pIndex}`
																	}
																>
																	<td>
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
																			__nextHasNoMarginBottom
																		/>
																	</td>
																	<td>
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
																			__nextHasNoMarginBottom
																		/>
																	</td>
																	<td>
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
																			__nextHasNoMarginBottom
																		/>
																	</td>
																	<td>
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
																	</td>
																</tr>
															);
														}
													)}
												</tbody>
											</table>
										</div>
										<HStack justify="flex-start">
											<Button
												variant="secondary"
												size="small"
												onClick={addSalePeriod}
											>
												{__(
													'+ Add Period',
													'fair-events'
												)}
											</Button>
										</HStack>
									</VStack>
								) : (
									salePeriods.length > 0 && (
										<HStack
											alignment="flex-end"
											spacing={3}
											justify="flex-start"
										>
											<TextControl
												label={__(
													'From',
													'fair-events'
												)}
												type="datetime-local"
												value={
													salePeriods[0].sale_start
														? salePeriods[0].sale_start.replace(
																' ',
																'T'
														  )
														: ''
												}
												onChange={(v) =>
													updateSalePeriod(
														0,
														'sale_start',
														v.replace('T', ' ')
													)
												}
												__nextHasNoMarginBottom
											/>
											<TextControl
												label={__(
													'Until',
													'fair-events'
												)}
												type="datetime-local"
												value={
													salePeriods[0].sale_end ||
													endDatetime ||
													''
														? (
																salePeriods[0]
																	.sale_end ||
																endDatetime
														  ).replace(' ', 'T')
														: ''
												}
												onChange={(v) =>
													updateSalePeriod(
														0,
														'sale_end',
														v.replace('T', ' ')
													)
												}
												__nextHasNoMarginBottom
											/>
										</HStack>
									)
								)}
							</VStack>
						</PanelBody>
					</Panel>
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
													{hasGroups && (
														<th>
															{__(
																'Groups',
																'fair-events'
															)}
														</th>
													)}
													{hasGroups && (
														<th>
															{__(
																'Invitation only',
																'fair-events'
															)}
														</th>
													)}
													{settings.show_ticket_type_minimum_activities &&
														options.length > 0 && (
															<th>
																{__(
																	'Min. activities',
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
																	? period.sale_end ||
																	  endDatetime
																	: period.sale_end ||
																	  '';
															const dateTooltip = `${
																fromValue
																	? fromValue.replace(
																			'T',
																			' '
																	  )
																	: '?'
															} → ${
																untilValue
																	? untilValue.replace(
																			'T',
																			' '
																	  )
																	: '?'
															}`;

															return (
																<th
																	key={
																		period.id ||
																		`new-${pIndex}`
																	}
																	title={
																		dateTooltip
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
															);
														}
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
															{hasGroups && (
																<td>
																	<FormTokenField
																		value={(
																			type.group_ids ||
																			[]
																		).map(
																			(
																				id
																			) =>
																				groupNameById[
																					id
																				] ||
																				`#${id}`
																		)}
																		suggestions={
																			groupSuggestions
																		}
																		onChange={(
																			tokens
																		) => {
																			const ids =
																				tokens
																					.map(
																						(
																							name
																						) =>
																							groupIdByName[
																								name
																							]
																					)
																					.filter(
																						Boolean
																					);
																			updateTicketType(
																				tIndex,
																				'group_ids',
																				ids
																			);
																		}}
																		__experimentalExpandOnFocus
																		__experimentalAutoSelectFirstMatch
																		placeholder={__(
																			'All participants',
																			'fair-events'
																		)}
																	/>
																</td>
															)}
															{hasGroups && (
																<td>
																	<CheckboxControl
																		checked={
																			type.invitation_only ||
																			false
																		}
																		onChange={(
																			v
																		) =>
																			updateTicketType(
																				tIndex,
																				'invitation_only',
																				v
																			)
																		}
																	/>
																</td>
															)}
															{settings.show_ticket_type_minimum_activities &&
																options.length >
																	0 && (
																	<td>
																		<TextControl
																			type="number"
																			min="0"
																			placeholder="0"
																			value={String(
																				type.minimum_activities ||
																					0
																			)}
																			onChange={(
																				v
																			) =>
																				updateTicketType(
																					tIndex,
																					'minimum_activities',
																					v !==
																						''
																						? Math.max(
																								0,
																								parseInt(
																									v,
																									10
																								) ||
																									0
																						  )
																						: 0
																				)
																			}
																			help={__(
																				'Only raises the event-wide minimum for this ticket type. Leave 0 to inherit.',
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
																				<CheckboxControl
																					__nextHasNoMarginBottom
																					label={__(
																						'Available',
																						'fair-events'
																					)}
																					checked={
																						cell.enabled !==
																						false
																					}
																					onChange={(
																						v
																					) =>
																						updatePrice(
																							type,
																							period,
																							'enabled',
																							v
																						)
																					}
																				/>
																				{cell.enabled !==
																					false && (
																					<>
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
																					</>
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
																: 0) +
															(hasGroups
																? 2
																: 0) +
															(settings.show_ticket_type_minimum_activities &&
															options.length > 0
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
						title={__('Activity Options', 'fair-events')}
						initialOpen={false}
					>
						<VStack spacing={3}>
							<TextControl
								label={__(
									'Minimum number of activities',
									'fair-events'
								)}
								help={__(
									'Participants must select at least this many activities to sign up. Set to 0 to disable.',
									'fair-events'
								)}
								type="number"
								min="0"
								value={String(settings.minimum_activities ?? 0)}
								onChange={(value) =>
									setSettings((prev) => ({
										...prev,
										minimum_activities:
											value === ''
												? 0
												: Math.max(
														0,
														parseInt(value, 10) || 0
												  ),
									}))
								}
								__nextHasNoMarginBottom
							/>
							<p>
								{__(
									'Add selectable activity options (checkboxes) shown to participants at signup. Each option has its own price added on top of the base price.',
									'fair-events'
								)}
							</p>
							{options.length > 0 && (
								<div style={{ overflowX: 'auto' }}>
									<table className="wp-list-table widefat striped">
										<thead>
											<tr>
												<th>
													{__('Name', 'fair-events')}
												</th>
												<th>
													{__(
														'Price (EUR)',
														'fair-events'
													)}
												</th>
												{settings.activity_collaborator_discount && (
													<th>
														{__(
															'Discounted price (EUR)',
															'fair-events'
														)}
													</th>
												)}
												<th>
													{__(
														'Capacity',
														'fair-events'
													)}
												</th>
												<th>
													{__(
														'Per-period pricing',
														'fair-events'
													)}
												</th>
												<th>
													{__(
														'Collaborator(s)',
														'fair-events'
													)}
												</th>
												<th />
											</tr>
										</thead>
										<tbody>
											{options.map((option, index) => {
												const collaboratorIds =
													Array.isArray(
														option.collaborator_ids
													)
														? option.collaborator_ids
														: [];
												return (
													<tr key={index}>
														<td>
															<VStack spacing={2}>
																<TextControl
																	label={__(
																		'Name',
																		'fair-events'
																	)}
																	hideLabelFromVision
																	placeholder={__(
																		'Activity name',
																		'fair-events'
																	)}
																	value={
																		option.name ||
																		''
																	}
																	onChange={(
																		v
																	) => {
																		const updated =
																			[
																				...options,
																			];
																		updated[
																			index
																		] = {
																			...updated[
																				index
																			],
																			name: v,
																		};
																		setOptions(
																			updated
																		);
																	}}
																	__nextHasNoMarginBottom
																/>
																<TextControl
																	label={__(
																		'Short name',
																		'fair-events'
																	)}
																	hideLabelFromVision
																	placeholder={__(
																		'Short name',
																		'fair-events'
																	)}
																	value={
																		option.short_name ||
																		''
																	}
																	onChange={(
																		v
																	) => {
																		const updated =
																			[
																				...options,
																			];
																		updated[
																			index
																		] = {
																			...updated[
																				index
																			],
																			short_name:
																				v,
																		};
																		setOptions(
																			updated
																		);
																	}}
																	__nextHasNoMarginBottom
																/>
															</VStack>
														</td>
														<td>
															<TextControl
																type="number"
																step="0.01"
																min="0"
																disabled={
																	!!option.derive_price_from_sale_period
																}
																value={
																	option.price !==
																	undefined
																		? String(
																				option.price
																		  )
																		: '0'
																}
																onChange={(
																	v
																) => {
																	const updated =
																		[
																			...options,
																		];
																	updated[
																		index
																	] = {
																		...updated[
																			index
																		],
																		price:
																			v !==
																			''
																				? parseFloat(
																						v
																				  )
																				: 0,
																	};
																	setOptions(
																		updated
																	);
																}}
																__nextHasNoMarginBottom
															/>
														</td>
														{settings.activity_collaborator_discount && (
															<td>
																<TextControl
																	type="number"
																	step="0.01"
																	min="0"
																	value={
																		option.discounted_price !==
																			null &&
																		option.discounted_price !==
																			undefined &&
																		option.discounted_price !==
																			''
																			? String(
																					option.discounted_price
																			  )
																			: ''
																	}
																	placeholder={__(
																		'No discount',
																		'fair-events'
																	)}
																	onChange={(
																		v
																	) => {
																		const updated =
																			[
																				...options,
																			];
																		updated[
																			index
																		] = {
																			...updated[
																				index
																			],
																			discounted_price:
																				v ===
																				''
																					? null
																					: parseFloat(
																							v
																					  ),
																		};
																		setOptions(
																			updated
																		);
																	}}
																	__nextHasNoMarginBottom
																/>
															</td>
														)}
														<td>
															<TextControl
																type="number"
																min="0"
																placeholder={__(
																	'Unlimited',
																	'fair-events'
																)}
																value={
																	option.capacity !==
																		null &&
																	option.capacity !==
																		undefined &&
																	option.capacity !==
																		''
																		? String(
																				option.capacity
																		  )
																		: ''
																}
																onChange={(
																	v
																) => {
																	const updated =
																		[
																			...options,
																		];
																	updated[
																		index
																	] = {
																		...updated[
																			index
																		],
																		capacity:
																			v ===
																			''
																				? null
																				: parseInt(
																						v,
																						10
																				  ),
																	};
																	setOptions(
																		updated
																	);
																}}
																__nextHasNoMarginBottom
															/>
														</td>
														<td>
															<CheckboxControl
																label={__(
																	'Per period',
																	'fair-events'
																)}
																checked={
																	!!option.derive_price_from_sale_period
																}
																onChange={(
																	checked
																) => {
																	const updated =
																		[
																			...options,
																		];
																	updated[
																		index
																	] = {
																		...updated[
																			index
																		],
																		derive_price_from_sale_period:
																			checked,
																	};
																	setOptions(
																		updated
																	);
																}}
																__nextHasNoMarginBottom
															/>
															{option.derive_price_from_sale_period && (
																<VStack
																	spacing={2}
																>
																	{salePeriods.length ===
																	0 ? (
																		<em>
																			{__(
																				'Add sale periods first.',
																				'fair-events'
																			)}
																		</em>
																	) : (
																		salePeriods.map(
																			(
																				period,
																				pIdx
																			) => {
																				const key =
																					periodPriceKey(
																						period,
																						pIdx
																					);
																				const val =
																					option
																						.period_prices_map?.[
																						key
																					] ??
																					'';
																				return (
																					<TextControl
																						key={
																							key
																						}
																						type="number"
																						step="0.01"
																						min="0"
																						label={
																							period.name ||
																							__(
																								'Period',
																								'fair-events'
																							) +
																								' ' +
																								(pIdx +
																									1)
																						}
																						value={
																							val
																						}
																						onChange={(
																							v
																						) => {
																							const updated =
																								[
																									...options,
																								];
																							const prev =
																								updated[
																									index
																								]
																									.period_prices_map ||
																								{};
																							updated[
																								index
																							] =
																								{
																									...updated[
																										index
																									],
																									period_prices_map:
																										{
																											...prev,
																											[key]: v,
																										},
																								};
																							setOptions(
																								updated
																							);
																						}}
																						__nextHasNoMarginBottom
																					/>
																				);
																			}
																		)
																	)}
																</VStack>
															)}
														</td>
														<td>
															<FormTokenField
																value={collaboratorIds.map(
																	(id) =>
																		participantLabelById[
																			id
																		] ||
																		`#${id}`
																)}
																suggestions={
																	participantSuggestions
																}
																onChange={(
																	tokens
																) => {
																	const ids =
																		tokens
																			.map(
																				(
																					label
																				) =>
																					participantIdByLabel[
																						label
																					]
																			)
																			.filter(
																				Boolean
																			);
																	const updated =
																		[
																			...options,
																		];
																	updated[
																		index
																	] = {
																		...updated[
																			index
																		],
																		collaborator_ids:
																			ids,
																	};
																	setOptions(
																		updated
																	);
																}}
																__experimentalExpandOnFocus
																__experimentalAutoSelectFirstMatch
																placeholder={__(
																	'Add participants',
																	'fair-events'
																)}
															/>
														</td>
														<td>
															<Button
																variant="tertiary"
																isDestructive
																size="small"
																onClick={() => {
																	setOptions(
																		options.filter(
																			(
																				_,
																				i
																			) =>
																				i !==
																				index
																		)
																	);
																}}
															>
																{__(
																	'Remove',
																	'fair-events'
																)}
															</Button>
														</td>
													</tr>
												);
											})}
										</tbody>
									</table>
								</div>
							)}
							<Button
								variant="secondary"
								size="small"
								onClick={() => {
									setOptions([
										...options,
										{
											name: '',
											short_name: '',
											price: 0,
											discounted_price: null,
											capacity: null,
											derive_price_from_sale_period: false,
											period_prices_map: {},
											collaborator_ids: [],
											sort_order: options.length,
										},
									]);
								}}
							>
								{__('+ Add Option', 'fair-events')}
							</Button>
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
							<CheckboxControl
								label={__(
									'Per-ticket-type minimum activities',
									'fair-events'
								)}
								help={__(
									'Show a Min. activities input on each ticket type to require more activities than the event-wide minimum (it only ever raises it). When off, every ticket type uses the event-wide minimum.',
									'fair-events'
								)}
								checked={
									settings.show_ticket_type_minimum_activities
								}
								onChange={(value) =>
									setSettings((prev) => ({
										...prev,
										show_ticket_type_minimum_activities:
											value,
									}))
								}
							/>
							<CheckboxControl
								label={__(
									'Activity collaborator discount',
									'fair-events'
								)}
								help={__(
									'Allow a discounted price on each activity option for participants invited by a collaborator linked to that activity. Adds a second price column to the activity options table and enables Manage Invitations.',
									'fair-events'
								)}
								checked={
									settings.activity_collaborator_discount
								}
								onChange={(value) =>
									setSettings((prev) => ({
										...prev,
										activity_collaborator_discount: value,
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
