/**
 * Event Tickets Component
 *
 * Manages ticket types, sale periods, and pricing in a 2D grid.
 *
 * @package FairEventsExperimental
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
		show_ticket_type_capacity: false,
		multiple_pricing_periods: false,
		show_seats_per_ticket: false,
		activity_collaborator_discount: false,
		minimum_activities: 0,
		show_ticket_type_minimum_activities: false,
		activity_period_pricing: false,
		show_ticket_type_end_date: false,
		sliding_scale_enabled: false,
		sliding_scale_min: 0,
		sliding_scale_max: 0,
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
	const isSlidingScaleRangeValid =
		!settings.sliding_scale_enabled ||
		(parseFloat(settings.sliding_scale_min) >= 0 &&
			parseFloat(settings.sliding_scale_min) <=
				(parseFloat(signupPrice) || 0) &&
			(parseFloat(signupPrice) || 0) <=
				parseFloat(settings.sliding_scale_max));
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
				err.message ||
					__('Failed to load tickets.', 'fair-events-experimental')
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
		if (!isSlidingScaleRangeValid) {
			setError(
				__(
					'Fix the sliding-scale price range before saving: minimum ≤ suggested ≤ maximum.',
					'fair-events-experimental'
				)
			);
			return;
		}

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

			setSuccess(
				__('Tickets saved successfully.', 'fair-events-experimental')
			);
		} catch (err) {
			setError(
				err.message ||
					__('Failed to save tickets.', 'fair-events-experimental')
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
				disable_at: t.disable_at || null,
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
					!!settings.activity_period_pricing,
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
					__(
						'Failed to export ticket configuration.',
						'fair-events-experimental'
					)
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
						'fair-events-experimental'
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
							'fair-events-experimental'
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
						'fair-events-experimental'
					)
				);
			} catch (err) {
				setError(
					err.message ||
						__(
							'Failed to import ticket configuration.',
							'fair-events-experimental'
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
				disable_at: null,
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
		if (!settings.activity_period_pricing) {
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
			derive_price_from_sale_period: !!settings.activity_period_pricing,
			period_prices: serializeOptionPeriodPrices(option),
		};
	};

	// Per-period price inputs for an activity option. Shown in the Pricing
	// column for every option when the `activity_period_pricing` setting is
	// on (replacing the single flat-price input).
	const renderOptionPeriodPrices = (option, index) => {
		if (salePeriods.length === 0) {
			return (
				<em>
					{__('Add sale periods first.', 'fair-events-experimental')}
				</em>
			);
		}
		return (
			<VStack spacing={2}>
				{salePeriods.map((period, pIdx) => {
					const key = periodPriceKey(period, pIdx);
					const val = option.period_prices_map?.[key] ?? '';
					return (
						<TextControl
							key={key}
							type="number"
							step="0.01"
							min="0"
							label={
								period.name ||
								__('Period', 'fair-events-experimental') +
									' ' +
									(pIdx + 1)
							}
							value={val}
							onChange={(v) => {
								const updated = [...options];
								const prev =
									updated[index].period_prices_map || {};
								updated[index] = {
									...updated[index],
									period_prices_map: {
										...prev,
										[key]: v,
									},
								};
								setOptions(updated);
							}}
							__nextHasNoMarginBottom
						/>
					);
				})}
			</VStack>
		);
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
							{__(
								'Manage Invitations',
								'fair-events-experimental'
							)}
						</Button>
					)}
				<Button
					variant="secondary"
					onClick={handleExport}
					disabled={importing || saving}
				>
					{__('Export ticket settings', 'fair-events-experimental')}
				</Button>
				<Button
					variant="secondary"
					onClick={() => fileInputRef.current?.click()}
					disabled={importing || saving}
					isBusy={importing}
				>
					{__('Import ticket settings', 'fair-events-experimental')}
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
						<strong>
							{__('Signup price', 'fair-events-experimental')}
						</strong>
					</CardHeader>
					<CardBody>
						<p>
							{signupPrice.trim() === ''
								? __(
										'Free signup. Enter a price below to charge for this event, or switch to advanced ticketing for multiple ticket types.',
										'fair-events-experimental'
								  )
								: sprintf(
										/* translators: %s: formatted price */
										__(
											'Signup price: %s. Group discounts configured in the Groups tab still apply.',
											'fair-events-experimental'
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
														'fair-events-experimental'
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
						<strong>
							{__('Ticket Prices', 'fair-events-experimental')}
						</strong>
					</CardHeader>
					<CardBody>
						<div style={{ overflowX: 'auto' }}>
							<table className="wp-list-table widefat striped">
								<thead>
									<tr>
										<th>
											{__(
												'Ticket Type',
												'fair-events-experimental'
											)}
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
															'fair-events-experimental'
													  )
													: __(
															'Price',
															'fair-events-experimental'
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
														'fair-events-experimental'
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
							title={__(
								'Sale Periods',
								'fair-events-experimental'
							)}
							initialOpen={false}
						>
							<VStack spacing={4}>
								{salePeriods.length > 0 && (
									<HStack spacing={4} justify="flex-start">
										<div>
											<strong>
												{__(
													'Sale start at:',
													'fair-events-experimental'
												)}
											</strong>{' '}
											{salePeriods[0].sale_start
												? salePeriods[0].sale_start.replace(
														'T',
														' '
												  )
												: __(
														'—',
														'fair-events-experimental'
												  )}
										</div>
										<div>
											<strong>
												{__(
													'Sale end at:',
													'fair-events-experimental'
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
													: __(
															'—',
															'fair-events-experimental'
													  );
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
																'fair-events-experimental'
															)}
														</th>
														<th>
															{__(
																'From',
																'fair-events-experimental'
															)}
														</th>
														<th>
															{__(
																'Until',
																'fair-events-experimental'
															)}
														</th>
														<th />
													</tr>
												</thead>
												<tbody>
													{salePeriods.map(
														(period, pIndex) => {
															const isFirst =
																pIndex === 0;
															const isLast =
																pIndex ===
																salePeriods.length -
																	1;
															const fromValue =
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
																				'fair-events-experimental'
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
																				'fair-events-experimental'
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
													'fair-events-experimental'
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
													'fair-events-experimental'
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
													'fair-events-experimental'
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
						title={__('Edit tickets', 'fair-events-experimental')}
						initialOpen={false}
					>
						<VStack spacing={4}>
							<TextControl
								label={__(
									'Total capacity',
									'fair-events-experimental'
								)}
								type="number"
								min="0"
								value={capacity}
								onChange={setCapacity}
								help={__(
									'Leave empty for unlimited capacity.',
									'fair-events-experimental'
								)}
							/>
							{!hasAdvancedTickets ? (
								<VStack spacing={3}>
									<TextControl
										label={__(
											'Signup price (EUR)',
											'fair-events-experimental'
										)}
										help={__(
											'Leave empty for free signup. Group discounts (Groups tab) apply to this base price.',
											'fair-events-experimental'
										)}
										type="number"
										min="0"
										step="0.01"
										value={signupPrice}
										onChange={setSignupPrice}
										__nextHasNoMarginBottom
									/>
									<CheckboxControl
										label={__(
											'Pay what you can (sliding scale)',
											'fair-events-experimental'
										)}
										help={__(
											'Let attendees choose their own price within a min/max band instead of paying the fixed price above.',
											'fair-events-experimental'
										)}
										checked={
											!!settings.sliding_scale_enabled
										}
										onChange={(checked) =>
											setSettings((prev) => ({
												...prev,
												sliding_scale_enabled: checked,
											}))
										}
									/>
									{settings.sliding_scale_enabled && (
										<VStack spacing={3}>
											<HStack spacing={3} alignment="top">
												<TextControl
													label={__(
														'Minimum (EUR)',
														'fair-events-experimental'
													)}
													type="number"
													min="0"
													step="0.01"
													value={String(
														settings.sliding_scale_min ??
															0
													)}
													onChange={(value) =>
														setSettings((prev) => ({
															...prev,
															sliding_scale_min:
																value,
														}))
													}
													__nextHasNoMarginBottom
												/>
												<TextControl
													label={__(
														'Maximum (EUR)',
														'fair-events-experimental'
													)}
													type="number"
													min="0"
													step="0.01"
													value={String(
														settings.sliding_scale_max ??
															0
													)}
													onChange={(value) =>
														setSettings((prev) => ({
															...prev,
															sliding_scale_max:
																value,
														}))
													}
													__nextHasNoMarginBottom
												/>
											</HStack>
											{!isSlidingScaleRangeValid && (
												<Notice
													status="error"
													isDismissible={false}
												>
													{__(
														'Minimum must be less than or equal to the suggested price above, and the suggested price must be less than or equal to the maximum.',
														'fair-events-experimental'
													)}
												</Notice>
											)}
										</VStack>
									)}
									<p>
										{__(
											'Need multiple ticket types or time-based pricing? Switch to advanced ticketing below.',
											'fair-events-experimental'
										)}
									</p>
									<HStack spacing={2}>
										<Button
											variant="secondary"
											onClick={() => {
												setSettings((prev) => ({
													...prev,
													sliding_scale_enabled: false,
												}));
												addTicketType();
												addSalePeriod();
											}}
										>
											{__(
												'Switch to advanced ticketing',
												'fair-events-experimental'
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
															'fair-events-experimental'
														)}
													</th>
													{settings.show_ticket_type_capacity && (
														<th>
															{__(
																'Capacity',
																'fair-events-experimental'
															)}
														</th>
													)}
													{settings.show_seats_per_ticket && (
														<th>
															{__(
																'Seats',
																'fair-events-experimental'
															)}
														</th>
													)}
													{hasGroups && (
														<th>
															{__(
																'Groups',
																'fair-events-experimental'
															)}
														</th>
													)}
													{hasGroups && (
														<th>
															{__(
																'Invitation only',
																'fair-events-experimental'
															)}
														</th>
													)}
													{settings.show_ticket_type_minimum_activities &&
														options.length > 0 && (
															<th>
																{__(
																	'Min. activities',
																	'fair-events-experimental'
																)}
															</th>
														)}
													{settings.show_ticket_type_end_date && (
														<th>
															{__(
																'End date',
																'fair-events-experimental'
															)}
														</th>
													)}
													{salePeriods.map(
														(period, pIndex) => {
															const isFirst =
																pIndex === 0;
															const isLast =
																pIndex ===
																salePeriods.length -
																	1;
															const fromValue =
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
																				'fair-events-experimental'
																		  )
																		: __(
																				'Price',
																				'fair-events-experimental'
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
																		'fair-events-experimental'
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
																			'fair-events-experimental'
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
																			'fair-events-experimental'
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
																			'fair-events-experimental'
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
																				'fair-events-experimental'
																			)}
																		/>
																	</td>
																)}
															{settings.show_ticket_type_end_date && (
																<td>
																	<TextControl
																		type="datetime-local"
																		value={
																			type.disable_at
																				? type.disable_at.replace(
																						' ',
																						'T'
																				  )
																				: ''
																		}
																		onChange={(
																			v
																		) =>
																			updateTicketType(
																				tIndex,
																				'disable_at',
																				v
																					? v.replace(
																							'T',
																							' '
																					  )
																					: null
																			)
																		}
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
																						'fair-events-experimental'
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
																									'fair-events-experimental'
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
																		'fair-events-experimental'
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
																: 0) +
															(settings.show_ticket_type_end_date
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
																'fair-events-experimental'
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
						title={__(
							'Activity Options',
							'fair-events-experimental'
						)}
						initialOpen={false}
					>
						<VStack spacing={3}>
							<TextControl
								label={__(
									'Minimum number of activities',
									'fair-events-experimental'
								)}
								help={__(
									'Participants must select at least this many activities to sign up. Set to 0 to disable.',
									'fair-events-experimental'
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
									'fair-events-experimental'
								)}
							</p>
							{options.length > 0 && (
								<div style={{ overflowX: 'auto' }}>
									<table className="wp-list-table widefat striped">
										<thead>
											<tr>
												<th>
													{__(
														'Name',
														'fair-events-experimental'
													)}
												</th>
												<th>
													{__(
														'Price (EUR)',
														'fair-events-experimental'
													)}
												</th>
												{settings.activity_collaborator_discount && (
													<th>
														{__(
															'Discounted price (EUR)',
															'fair-events-experimental'
														)}
													</th>
												)}
												<th>
													{__(
														'Capacity',
														'fair-events-experimental'
													)}
												</th>
												<th>
													{__(
														'Collaborator(s)',
														'fair-events-experimental'
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
																		'fair-events-experimental'
																	)}
																	hideLabelFromVision
																	placeholder={__(
																		'Activity name',
																		'fair-events-experimental'
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
																		'fair-events-experimental'
																	)}
																	hideLabelFromVision
																	placeholder={__(
																		'Short name',
																		'fair-events-experimental'
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
															{settings.activity_period_pricing ? (
																renderOptionPeriodPrices(
																	option,
																	index
																)
															) : (
																<TextControl
																	type="number"
																	step="0.01"
																	min="0"
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
															)}
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
																		'fair-events-experimental'
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
																	'fair-events-experimental'
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
																	'fair-events-experimental'
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
																	'fair-events-experimental'
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
								{__('+ Add Option', 'fair-events-experimental')}
							</Button>
						</VStack>
					</PanelBody>
				</Panel>
			</Card>

			<Card>
				<Panel>
					<PanelBody
						title={__('Settings', 'fair-events-experimental')}
						initialOpen={false}
					>
						<VStack spacing={4}>
							<CheckboxControl
								label={__(
									'Per-ticket-type capacity',
									'fair-events-experimental'
								)}
								help={__(
									'Show a Capacity input on each ticket type to cap how many can be sold of that type.',
									'fair-events-experimental'
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
									'fair-events-experimental'
								)}
								help={__(
									'Enable time-based pricing with multiple sale periods (e.g. early bird, regular, late). When off, a single flat price applies for the whole sale window.',
									'fair-events-experimental'
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
								label={__(
									'Seats per ticket',
									'fair-events-experimental'
								)}
								help={__(
									'Show a Seats input on each ticket type to let one ticket consume more than one capacity slot (e.g. couples or +1 tickets). When off, every ticket counts as 1 seat.',
									'fair-events-experimental'
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
									'fair-events-experimental'
								)}
								help={__(
									'Show a Min. activities input on each ticket type to require more activities than the event-wide minimum (it only ever raises it). When off, every ticket type uses the event-wide minimum.',
									'fair-events-experimental'
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
									'Per-ticket-type end date',
									'fair-events-experimental'
								)}
								help={__(
									'Show a date/time input on each ticket type to stop selling it after a fixed date, regardless of remaining capacity.',
									'fair-events-experimental'
								)}
								checked={settings.show_ticket_type_end_date}
								onChange={(value) =>
									setSettings((prev) => ({
										...prev,
										show_ticket_type_end_date: value,
									}))
								}
							/>
							<CheckboxControl
								label={__(
									'Activity collaborator discount',
									'fair-events-experimental'
								)}
								help={__(
									'Allow a discounted price on each activity option for participants invited by a collaborator linked to that activity. Adds a second price column to the activity options table and enables Manage Invitations.',
									'fair-events-experimental'
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
							<CheckboxControl
								label={__(
									'Per-period pricing',
									'fair-events-experimental'
								)}
								help={__(
									'Price every activity option per sale period instead of a single flat price. The Pricing column in the activity options table becomes one input per sale period. Requires sale periods to be defined.',
									'fair-events-experimental'
								)}
								checked={settings.activity_period_pricing}
								onChange={(value) =>
									setSettings((prev) => ({
										...prev,
										activity_period_pricing: value,
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
													'fair-events-experimental'
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
										'fair-events-experimental'
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
										'fair-events-experimental'
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
