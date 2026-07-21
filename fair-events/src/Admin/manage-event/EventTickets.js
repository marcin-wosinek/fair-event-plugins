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
	__experimentalConfirmDialog as ConfirmDialog,
	DropdownMenu,
	FormTokenField,
	MenuGroup,
	MenuItem,
	Modal,
	Panel,
	PanelBody,
	RadioControl,
	SelectControl,
	Spinner,
	Notice,
	TextControl,
	ToggleControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __, _n, sprintf } from '@wordpress/i18n';
import { moreVertical } from '@wordpress/icons';
import apiFetch from '@wordpress/api-fetch';
import SalePeriodsCalendar from './SalePeriodsCalendar.js';

export default function EventTickets({
	eventDateId,
	onSaveRef,
	initialData,
	onDataRef,
	startDatetime,
	endDatetime: endDatetimeProp,
	lastOccurrenceDatetime,
	isSeries,
	onDirtyChange,
}) {
	const [capacity, setCapacity] = useState('');
	const [endDatetime, setEndDatetime] = useState(
		endDatetimeProp ? endDatetimeProp.split(' ')[0].split('T')[0] : ''
	);
	const [ticketTypes, setTicketTypes] = useState([]);
	const [salePeriods, setSalePeriods] = useState([]);
	const [prices, setPrices] = useState({});
	const [settings, setSettings] = useState({
		show_ticket_type_capacity: false,
		multiple_pricing_periods: false,
		minimum_activities: 0,
		show_ticket_type_minimum_activities: false,
		activity_period_pricing: false,
		show_ticket_type_end_date: false,
	});
	const [options, setOptions] = useState([]);
	const [loading, setLoading] = useState(!initialData);
	const [saving, setSaving] = useState(false);
	const [importing, setImporting] = useState(false);
	const [error, setError] = useState(null);
	const [success, setSuccess] = useState(null);
	const [groups, setGroups] = useState([]);
	const [showScopeModal, setShowScopeModal] = useState(false);
	const [pendingScope, setPendingScope] = useState('single_instance');
	const [participants, setParticipants] = useState([]);
	const [mergePeriodsDialogOpen, setMergePeriodsDialogOpen] = useState(false);
	const fileInputRef = useRef(null);

	// Dirty-state tracking (#987): snapshot the save payload right after it's
	// loaded/saved so we can detect unsaved edits by re-serializing and
	// comparing.
	const [snapshot, setSnapshot] = useState(null);
	const [loadGen, setLoadGen] = useState(0);

	const manageInvitationsUrl =
		window.fairEventsManageEventData?.manageInvitationsUrl || '';

	// An event loaded with more than one stored sale period always renders in
	// multiple-periods mode, regardless of the stored toggle, so no configured
	// period is ever hidden.
	const effectiveMultiple =
		salePeriods.length > 1 || settings.multiple_pricing_periods;
	// Payments are unavailable when the connector plugin is missing
	// (connectorActive !== true) or installed but not yet configured
	// (paymentConfigured === false). The two cases show different warnings.
	// wp_localize_script casts booleans to strings ("1"/""), so read the
	// connector flags tolerantly rather than comparing against real booleans.
	const asBool = (v) => v === true || v === '1' || v === 1;
	const connectorActive = asBool(
		window.fairPaymentsConnector?.connectorActive
	);
	const paymentConfigured = asBool(
		window.fairPaymentsConnector?.paymentConfigured
	);
	const paymentsUnavailable = !connectorActive || !paymentConfigured;
	// Any price > 0 across every source makes at least one ticket purchasable,
	// so the "payments not set up" warning is relevant. Free ticketing (all
	// prices 0) works without payments, so it must not trigger the warning.
	const hasPurchasablePrice =
		Object.values(prices).some(
			(cell) =>
				cell && cell.enabled !== false && parseFloat(cell.price) > 0
		) ||
		options.some((o) => {
			if (parseFloat(o.price) > 0) return true;
			return Object.values(o.period_prices_map || {}).some(
				(v) => parseFloat(v) > 0
			);
		});
	const showPaymentsWarning = paymentsUnavailable && hasPurchasablePrice;
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
		setLoadGen((g) => g + 1);
		setCapacity(
			data.capacity !== null && data.capacity !== undefined
				? String(data.capacity)
				: ''
		);
		if (data.end_datetime) {
			setEndDatetime(data.end_datetime.split(' ')[0].split('T')[0]);
		}
		setTicketTypes(data.ticket_types || []);
		setSalePeriods(
			(data.sale_periods || []).map((p) => ({
				...p,
				sale_start: p.sale_start
					? p.sale_start.split(' ')[0].split('T')[0]
					: '',
				sale_end: p.sale_end
					? p.sale_end.split(' ')[0].split('T')[0]
					: '',
			}))
		);

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
			settings,
			ticket_types: ticketTypes.map((t) => ({
				name: t.name || '',
				capacity:
					t.capacity !== null && t.capacity !== undefined
						? t.capacity
						: null,
				invitation_only: t.invitation_only || false,
				minimum_activities: t.minimum_activities || 0,
				disable_at: t.disable_at || null,
				recurrence_scope: t.recurrence_scope || 'single_instance',
				minimum_instances: t.minimum_instances || 0,
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

	const addTicketType = (scope = 'single_instance') => {
		if (salePeriods.length === 0) {
			seedDefaultSalePeriods();
		}
		setTicketTypes([
			...ticketTypes,
			{
				name: '',
				capacity: null,
				invitation_only: false,
				minimum_activities: 0,
				disable_at: null,
				recurrence_scope: scope,
				minimum_instances: 0,
				group_ids: [],
				sort_order: ticketTypes.length,
			},
		]);
	};

	const openAddTicketModal = () => {
		if (isSeries) {
			setPendingScope('single_instance');
			setShowScopeModal(true);
		} else {
			addTicketType();
		}
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

	const getSiteToday = () =>
		window.fairEventsManageEventData?.siteToday || '';

	const dayAfterDate = (dateStr) => {
		if (!dateStr) return '';
		const d = new Date(dateStr + 'T00:00:00');
		d.setDate(d.getDate() + 1);
		return d.toISOString().slice(0, 10);
	};

	// The day after the event/series' last occurrence — the lazily-resolved
	// default sale end when the window is left unset. Falls back to the
	// single event's own end when there's no series data (e.g. still loading).
	const defaultSaleEnd = () => {
		const anchor = lastOccurrenceDatetime || endDatetime;
		return anchor ? dayAfterDate(anchor.split(' ')[0].split('T')[0]) : '';
	};

	const formatSaleDateLabel = (dateStr) => {
		if (!dateStr) return __('—', 'fair-events');
		const dateOnly = dateStr.split(' ')[0].split('T')[0];
		const d = new Date(dateOnly + 'T00:00:00');
		return new Intl.DateTimeFormat(undefined, {
			weekday: 'long',
			day: 'numeric',
			month: 'long',
		}).format(d);
	};

	const daysBeforeEvent = (dateStr) => {
		const eventStart = startDatetime
			? startDatetime.split(' ')[0].split('T')[0]
			: null;
		if (!eventStart || !dateStr) return null;
		const eventDay = new Date(eventStart + 'T00:00:00');
		const saleDay = new Date(dateStr + 'T00:00:00');
		const diff = Math.round((eventDay - saleDay) / (1000 * 60 * 60 * 24));
		return diff > 0 ? diff : null;
	};

	const eventDay = startDatetime
		? startDatetime.split(' ')[0].split('T')[0]
		: '';

	// Seeds a single default sale period row so prices have somewhere to
	// attach, but leaves sale_start/sale_end unset: the effective window is
	// resolved lazily (open start, day-after-last-occurrence end) rather than
	// frozen into storage at creation time. See getEffectiveSalePeriods().
	const seedDefaultSalePeriods = () => {
		setSalePeriods([
			{
				name: '',
				sale_start: '',
				sale_end: '',
				sort_order: 0,
			},
		]);
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
			return <em>{__('Add sale periods first.', 'fair-events')}</em>;
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
								sprintf(
									/* translators: %d: sale period number */
									__('Period %d', 'fair-events'),
									pIdx + 1
								)
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
		const defaultStart = isFirst
			? getSiteToday()
			: lastPeriod?.sale_end || '';
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

		// Sale periods always chain: each period's start is implied by the
		// previous period's end, so gaps/overlaps are impossible by construction.
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

	// Maps a SalePeriodsCalendar boundary click onto the chained setter:
	// boundary 0 is the first period's start, boundary N (the period count)
	// is the last period's end, and everything in between is the start of
	// the period at that index (updateSalePeriod's chaining already
	// propagates it to the previous period's end).
	const handleMoveSalePeriodBoundary = (boundaryIndex, dateStr) => {
		if (boundaryIndex === 0) {
			updateSalePeriod(0, 'sale_start', dateStr);
		} else if (boundaryIndex === salePeriods.length) {
			updateSalePeriod(salePeriods.length - 1, 'sale_end', dateStr);
		} else {
			updateSalePeriod(boundaryIndex, 'sale_start', dateStr);
		}
	};

	// "Multiple pricing periods" toggled on: split the single sale window at
	// the event's first day into two named, prefilled, editable periods,
	// migrating the existing single-period prices to the first one.
	// Toggled off with several periods defined: ask for confirmation before
	// merging back into one window (mergeToSinglePeriod does the merge).
	const handleToggleMultiplePeriods = (value) => {
		if (value) {
			if (salePeriods.length <= 1) {
				const base = salePeriods[0];
				const eventFirstDay = startDatetime
					? startDatetime.split(' ')[0].split('T')[0]
					: getSiteToday();
				// Only the split boundary (eventFirstDay) needs a stored date.
				// An unset start/end stays unset here rather than snapshotting
				// today's default — the organiser never chose those dates.
				const windowStart = base?.sale_start || '';
				const windowEnd = base?.sale_end || '';
				if (base) {
					const newPrices = { ...prices };
					ticketTypes.forEach((type) => {
						const oldKey = getPriceKey(type, base);
						if (prices[oldKey] !== undefined) {
							const typeKey =
								type.id || `new-${ticketTypes.indexOf(type)}`;
							newPrices[`${typeKey}-new-0`] = prices[oldKey];
						}
					});
					setPrices(newPrices);
				}
				setSalePeriods([
					{
						name: __('Advance ticket', 'fair-events'),
						sale_start: windowStart,
						sale_end: eventFirstDay,
						sort_order: 0,
					},
					{
						name: __('Day of event', 'fair-events'),
						sale_start: eventFirstDay,
						sale_end: windowEnd,
						sort_order: 1,
					},
				]);
			}
			setSettings((prev) => ({
				...prev,
				multiple_pricing_periods: true,
			}));
		} else if (salePeriods.length > 1) {
			setMergePeriodsDialogOpen(true);
		} else {
			setSettings((prev) => ({
				...prev,
				multiple_pricing_periods: false,
			}));
		}
	};

	const mergeToSinglePeriod = () => {
		const first = salePeriods[0];
		const last = salePeriods[salePeriods.length - 1];
		if (first) {
			const newPrices = {};
			ticketTypes.forEach((type) => {
				const oldKey = getPriceKey(type, first);
				if (prices[oldKey] !== undefined) {
					const typeKey =
						type.id || `new-${ticketTypes.indexOf(type)}`;
					newPrices[`${typeKey}-new-0`] = prices[oldKey];
				}
			});
			setPrices(newPrices);
			setSalePeriods([
				{
					name: '',
					sale_start: first.sale_start,
					// Merging returns to automatic: an unset end stays unset
					// (lazily resolved) instead of freezing whatever the
					// default happened to compute to at merge time.
					sale_end: last.sale_end || '',
					sort_order: 0,
				},
			]);
		}
		setSettings((prev) => ({ ...prev, multiple_pricing_periods: false }));
		setMergePeriodsDialogOpen(false);
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

	const appendTime = (dateStr) =>
		dateStr && !dateStr.includes(' ') && !dateStr.includes('T')
			? dateStr + ' 00:00:00'
			: dateStr;

	// An unset sale_start/sale_end is sent through as empty so the backend
	// stores NULL — the effective window is then resolved lazily server-side
	// (open start, day-after-last-occurrence end) rather than frozen here.
	const getEffectiveSalePeriods = () => {
		const periods = salePeriods.map((p, i) => {
			const updated = { ...p };
			if (i > 0) {
				updated.sale_start = salePeriods[i - 1].sale_end || '';
			}
			updated.sale_start = appendTime(updated.sale_start);
			updated.sale_end = appendTime(updated.sale_end);
			return updated;
		});
		return periods;
	};

	const getPrice = (type, period) => {
		const key = getPriceKey(type, period);
		return prices[key] || { price: '', capacity: '', enabled: true };
	};

	// Full save payload — shared by handleSave, the onDataRef consumer, and
	// the dirty-state snapshot comparison.
	const buildSavePayload = () => {
		const pricesArray = [];
		ticketTypes.forEach((type, tIndex) => {
			salePeriods.forEach((period, pIndex) => {
				const val = getPrice(type, period);
				// The `enabled` flag is only user-controllable via the
				// "Available" checkbox, which renders only in multiple-periods
				// mode. In single-period mode there is no way to flip it, so a
				// typed price/capacity must always save — otherwise price-less
				// cells (seeded enabled: false) silently drop their input.
				if (effectiveMultiple && !val.enabled) return;
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

		return {
			capacity: capacity !== '' ? parseInt(capacity, 10) : null,
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
			options: options.map((o, i) => serializeOptionForSave(o, i)),
		};
	};

	useEffect(() => {
		if (onDataRef) {
			onDataRef.current = buildSavePayload;
		}
	});

	// Re-baseline the snapshot whenever populateFromData() runs (initial load
	// or a fresh save). Gated on loadGen — a state value set in the same
	// batch as the loaded ticketTypes/salePeriods/etc. — rather than a ref,
	// so this effect's closure only reads those fields once React has
	// actually committed the loaded values (a ref flip is visible to effects
	// in the same commit, before the batched setState calls have flushed).
	useEffect(() => {
		setSnapshot(JSON.stringify(buildSavePayload()));
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [loadGen]);

	const dirty =
		snapshot !== null && snapshot !== JSON.stringify(buildSavePayload());

	useEffect(() => {
		if (onDirtyChange) {
			onDirtyChange(dirty);
		}
	}, [dirty, onDirtyChange]);

	const handleSave = async () => {
		setSaving(true);
		setError(null);
		setSuccess(null);

		try {
			const data = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}/tickets`,
				method: 'PUT',
				data: buildSavePayload(),
			});

			populateFromData(data);
			setSuccess(__('Tickets saved successfully.', 'fair-events'));
		} catch (err) {
			setError(
				err.message || __('Failed to save tickets.', 'fair-events')
			);
		} finally {
			setSaving(false);
		}
	};

	const siteCurrency = window.fairPaymentsConnector?.currency || 'EUR';

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
			{showPaymentsWarning &&
				(connectorActive ? (
					<Notice
						status="warning"
						isDismissible={false}
						actions={[
							{
								label: __('Set up Mollie', 'fair-events'),
								url: window.fairPaymentsConnector.settingsUrl,
							},
						]}
					>
						{__(
							"Paid tickets won't be sold until Mollie payments are configured.",
							'fair-events'
						)}
					</Notice>
				) : (
					<Notice status="warning" isDismissible={false}>
						{__(
							'Paid tickets need the Fair Payments Connector plugin. Install and activate it to sell tickets.',
							'fair-events'
						)}
					</Notice>
				))}
			<HStack spacing={2} justify="space-between">
				<Button
					variant="primary"
					onClick={handleSave}
					isBusy={saving}
					disabled={saving}
				>
					{__('Save tickets', 'fair-events')}
				</Button>
				{hasInvitationTickets && manageInvitationsUrl && (
					<Button
						variant="secondary"
						href={`${manageInvitationsUrl}${eventDateId}`}
					>
						{__('Manage Invitations', 'fair-events')}
					</Button>
				)}
			</HStack>
			<input
				ref={fileInputRef}
				type="file"
				accept="application/json,.json"
				style={{ display: 'none' }}
				onChange={handleImportFile}
			/>
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
										{(() => {
											const start =
												salePeriods[0].sale_start;
											const days = daysBeforeEvent(start);
											const label =
												formatSaleDateLabel(start);
											return start
												? days !== null
													? sprintf(
															/* translators: 1: formatted date, 2: number of days */
															_n(
																'From %1$s (%2$d day before event)',
																'From %1$s (%2$d days before event)',
																days,
																'fair-events'
															),
															label,
															days
													  )
													: sprintf(
															/* translators: %s: formatted date */
															__(
																'From %s',
																'fair-events'
															),
															label
													  )
												: __('—', 'fair-events');
										})()}
									</div>
									<div>
										<strong>
											{__('Sale end at:', 'fair-events')}
										</strong>{' '}
										{(() => {
											const last =
												salePeriods[
													salePeriods.length - 1
												];
											const end =
												last.sale_end ||
												defaultSaleEnd();
											if (!end)
												return __('—', 'fair-events');
											return last.sale_end
												? sprintf(
														/* translators: %s: formatted date */
														__(
															'until %s',
															'fair-events'
														),
														formatSaleDateLabel(end)
												  )
												: sprintf(
														/* translators: %s: formatted date */
														__(
															'until %s (default)',
															'fair-events'
														),
														formatSaleDateLabel(end)
												  );
										})()}
									</div>
								</HStack>
							)}
							{salePeriods.length > 0 && (
								<SalePeriodsCalendar
									salePeriods={salePeriods}
									eventDay={eventDay}
									onMoveBoundary={
										handleMoveSalePeriodBoundary
									}
									embedded
								/>
							)}
							{effectiveMultiple ? (
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
																  ]?.sale_end ||
																  ''
																: period.sale_start ||
																  '';
														// The last period's end is lazily resolved when unset — show
														// the field empty (not a frozen snapshot) with the resolved
														// default as help text, plus a way back to automatic.
														const untilIsAutomatic =
															isLast &&
															!period.sale_end;
														const untilValue =
															period.sale_end ||
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
																		type="date"
																		value={
																			fromValue ||
																			''
																		}
																		onChange={(
																			v
																		) =>
																			updateSalePeriod(
																				pIndex,
																				'sale_start',
																				v
																			)
																		}
																		__nextHasNoMarginBottom
																	/>
																</td>
																<td>
																	<VStack
																		spacing={
																			1
																		}
																	>
																		<TextControl
																			type="date"
																			value={
																				untilValue
																			}
																			onChange={(
																				v
																			) =>
																				updateSalePeriod(
																					pIndex,
																					'sale_end',
																					v
																				)
																			}
																			help={
																				untilIsAutomatic &&
																				defaultSaleEnd()
																					? sprintf(
																							/* translators: %s: formatted date */
																							__(
																								'Automatic: until %s',
																								'fair-events'
																							),
																							formatSaleDateLabel(
																								defaultSaleEnd()
																							)
																					  )
																					: undefined
																			}
																			__nextHasNoMarginBottom
																		/>
																		{isLast &&
																			period.sale_end && (
																				<Button
																					variant="link"
																					size="small"
																					onClick={() =>
																						updateSalePeriod(
																							pIndex,
																							'sale_end',
																							''
																						)
																					}
																				>
																					{__(
																						'Reset to automatic',
																						'fair-events'
																					)}
																				</Button>
																			)}
																	</VStack>
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
											{__('+ Add Period', 'fair-events')}
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
											label={__('From', 'fair-events')}
											type="date"
											value={
												salePeriods[0].sale_start || ''
											}
											onChange={(v) =>
												updateSalePeriod(
													0,
													'sale_start',
													v
												)
											}
											__nextHasNoMarginBottom
										/>
										<VStack spacing={1}>
											<TextControl
												label={__(
													'Until',
													'fair-events'
												)}
												type="date"
												value={
													salePeriods[0].sale_end ||
													''
												}
												onChange={(v) =>
													updateSalePeriod(
														0,
														'sale_end',
														v
													)
												}
												help={
													!salePeriods[0].sale_end &&
													defaultSaleEnd()
														? sprintf(
																/* translators: %s: formatted date */
																__(
																	'Automatic: until %s',
																	'fair-events'
																),
																formatSaleDateLabel(
																	defaultSaleEnd()
																)
														  )
														: undefined
												}
												__nextHasNoMarginBottom
											/>
											{salePeriods[0].sale_end && (
												<Button
													variant="link"
													size="small"
													onClick={() =>
														updateSalePeriod(
															0,
															'sale_end',
															''
														)
													}
												>
													{__(
														'Reset to automatic',
														'fair-events'
													)}
												</Button>
											)}
										</VStack>
									</HStack>
								)
							)}
						</VStack>
					</PanelBody>
				</Panel>
			</Card>

			<Card>
				<CardHeader>
					<strong>{__('Tickets', 'fair-events')}</strong>
					<DropdownMenu
						icon={moreVertical}
						label={__('More actions', 'fair-events')}
					>
						{({ onClose }) => (
							<MenuGroup>
								<MenuItem
									onClick={() => {
										handleExport();
										onClose();
									}}
									disabled={importing || saving}
								>
									{__(
										'Export ticket settings',
										'fair-events'
									)}
								</MenuItem>
								<MenuItem
									onClick={() => {
										fileInputRef.current?.click();
										onClose();
									}}
									disabled={importing || saving}
								>
									{__(
										'Import ticket settings',
										'fair-events'
									)}
								</MenuItem>
							</MenuGroup>
						)}
					</DropdownMenu>
				</CardHeader>
				<CardBody>
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
															'Min. add-ons',
															'fair-events'
														)}
													</th>
												)}
											{settings.show_ticket_type_end_date && (
												<th>
													{__(
														'End date',
														'fair-events'
													)}
												</th>
											)}
											{isSeries && (
												<th>
													{__('Scope', 'fair-events')}
												</th>
											)}
											{salePeriods.map(
												(period, pIndex) => {
													const isFirst =
														pIndex === 0;
													const isLast =
														pIndex ===
														salePeriods.length - 1;
													const fromValue = !isFirst
														? salePeriods[
																pIndex - 1
														  ]?.sale_end || ''
														: period.sale_start ||
														  '';
													const untilValue = isLast
														? period.sale_end ||
														  defaultSaleEnd()
														: period.sale_end || '';
													const dateTooltip = `${
														fromValue || '?'
													} → ${untilValue || '?'}`;

													return (
														<th
															key={
																period.id ||
																`new-${pIndex}`
															}
															title={dateTooltip}
														>
															{effectiveMultiple
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
													{type.disabled && (
														<span
															style={{
																color: '#757575',
																fontSize:
																	'0.85em',
															}}
														>
															{__(
																'Disabled — no longer on sale',
																'fair-events'
															)}
														</span>
													)}
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
												)}
												{hasGroups && (
													<td>
														<FormTokenField
															value={(
																type.group_ids ||
																[]
															).map(
																(id) =>
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
															onChange={(v) =>
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
													options.length > 0 && (
														<td>
															<TextControl
																type="number"
																min="0"
																placeholder="0"
																value={String(
																	type.minimum_activities ||
																		0
																)}
																onChange={(v) =>
																	updateTicketType(
																		tIndex,
																		'minimum_activities',
																		v !== ''
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
																	'Only raises the event-wide minimum add-ons for this ticket type. Leave 0 to inherit.',
																	'fair-events'
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
															onChange={(v) =>
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
												{isSeries && (
													<td>
														{type.has_sales ? (
															<span>
																{type.recurrence_scope ===
																'whole_series'
																	? __(
																			'Whole series',
																			'fair-events'
																	  )
																	: type.recurrence_scope ===
																	  'multiple_instances'
																	? __(
																			'Multiple instances',
																			'fair-events'
																	  )
																	: __(
																			'This instance',
																			'fair-events'
																	  )}
															</span>
														) : (
															<>
																<SelectControl
																	value={
																		type.recurrence_scope ||
																		'single_instance'
																	}
																	options={[
																		{
																			value: 'single_instance',
																			label: __(
																				'This instance',
																				'fair-events'
																			),
																		},
																		{
																			value: 'whole_series',
																			label: __(
																				'Whole series',
																				'fair-events'
																			),
																		},
																		{
																			value: 'multiple_instances',
																			label: __(
																				'Multiple instances',
																				'fair-events'
																			),
																		},
																	]}
																	onChange={(
																		v
																	) =>
																		updateTicketType(
																			tIndex,
																			'recurrence_scope',
																			v
																		)
																	}
																	__nextHasNoMarginBottom
																/>
																{type.recurrence_scope ===
																	'multiple_instances' && (
																	<TextControl
																		type="number"
																		min="0"
																		placeholder="0"
																		label={__(
																			'Minimum instances',
																			'fair-events'
																		)}
																		value={String(
																			type.minimum_instances ||
																				0
																		)}
																		onChange={(
																			v
																		) =>
																			updateTicketType(
																				tIndex,
																				'minimum_instances',
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
																		__next40pxDefaultSize
																		__nextHasNoMarginBottom
																	/>
																)}
															</>
														)}
													</td>
												)}
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
																	{effectiveMultiple && (
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
																	)}
																	{(!effectiveMultiple ||
																		cell.enabled !==
																			false) && (
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
																	)}
																</VStack>
															</td>
														);
													}
												)}
												<td>
													{type.has_sales ? (
														<ToggleControl
															label={
																type.disabled
																	? __(
																			'Disabled',
																			'fair-events'
																	  )
																	: __(
																			'Enabled',
																			'fair-events'
																	  )
															}
															checked={
																!type.disabled
															}
															onChange={(v) =>
																updateTicketType(
																	tIndex,
																	'disabled',
																	!v
																)
															}
														/>
													) : (
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
													)}
												</td>
											</tr>
										))}
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
													(hasGroups ? 2 : 0) +
													(settings.show_ticket_type_minimum_activities &&
													options.length > 0
														? 1
														: 0) +
													(settings.show_ticket_type_end_date
														? 1
														: 0)
												}
											>
												<VStack
													spacing={2}
													alignment="flex-start"
												>
													{ticketTypes.length ===
														0 && (
														<p
															style={{
																margin: 0,
															}}
														>
															{__(
																'No ticket types yet. Add one to start selling tickets for this event.',
																'fair-events'
															)}
														</p>
													)}
													<Button
														variant="secondary"
														size="small"
														onClick={
															openAddTicketModal
														}
													>
														{__(
															'+ Add Ticket Type',
															'fair-events'
														)}
													</Button>
												</VStack>
											</td>
										</tr>
									</tfoot>
								</table>
							</div>
						</VStack>
					</VStack>
				</CardBody>
			</Card>
			<Card>
				<Panel>
					<PanelBody
						title={__('Add-ons', 'fair-events')}
						initialOpen={false}
					>
						<VStack spacing={3}>
							<TextControl
								label={__(
									'Minimum number of add-ons',
									'fair-events'
								)}
								help={__(
									'Participants must select at least this many add-ons to sign up. Set to 0 to disable.',
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
									'Add selectable add-ons (checkboxes) shown to participants at signup. Each add-on has its own price added on top of the base price.',
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
													{sprintf(
														/* translators: %s: currency code */
														__(
															'Price (%s)',
															'fair-events'
														),
														siteCurrency
													)}
												</th>
												<th>
													{__(
														'Capacity',
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
																		'Add-on name',
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
						title={__('More options', 'fair-events')}
						initialOpen={false}
					>
						<VStack spacing={4}>
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
								checked={effectiveMultiple}
								onChange={handleToggleMultiplePeriods}
							/>
							<CheckboxControl
								label={__(
									'Per-ticket-type minimum add-ons',
									'fair-events'
								)}
								help={__(
									'Show a Min. add-ons input on each ticket type to require more add-ons than the event-wide minimum (it only ever raises it). When off, every ticket type uses the event-wide minimum.',
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
									'Per-ticket-type end date',
									'fair-events'
								)}
								help={__(
									'Show a date/time input on each ticket type to stop selling it after a fixed date, regardless of remaining capacity.',
									'fair-events'
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
									'Price add-ons per sale period',
									'fair-events'
								)}
								help={__(
									'Price every add-on per sale period instead of a single flat price. The Pricing column in the add-ons table becomes one input per sale period. Requires sale periods to be defined.',
									'fair-events'
								)}
								checked={settings.activity_period_pricing}
								onChange={(value) =>
									setSettings((prev) => ({
										...prev,
										activity_period_pricing: value,
									}))
								}
							/>
						</VStack>
					</PanelBody>
				</Panel>
			</Card>
			<ConfirmDialog
				isOpen={mergePeriodsDialogOpen}
				onConfirm={mergeToSinglePeriod}
				onCancel={() => setMergePeriodsDialogOpen(false)}
				confirmButtonText={__('Merge periods', 'fair-events')}
				cancelButtonText={__('Cancel', 'fair-events')}
			>
				{sprintf(
					/* translators: %d: number of sale periods being merged */
					__(
						'Merge to one sale window? Prices for the other %d periods will be discarded.',
						'fair-events'
					),
					Math.max(salePeriods.length - 1, 0)
				)}
			</ConfirmDialog>
			{showScopeModal && (
				<Modal
					title={__('Choose ticket scope', 'fair-events')}
					onRequestClose={() => setShowScopeModal(false)}
				>
					<RadioControl
						selected={pendingScope}
						options={[
							{
								value: 'single_instance',
								label: __(
									'This instance — a separate ticket is needed for each date',
									'fair-events'
								),
							},
							{
								value: 'whole_series',
								label: __(
									'Whole series — one purchase covers every occurrence',
									'fair-events'
								),
							},
							{
								value: 'multiple_instances',
								label: __(
									'Multiple instances — buyer picks several occurrences',
									'fair-events'
								),
							},
						]}
						onChange={(v) => setPendingScope(v)}
					/>
					<Button
						variant="primary"
						onClick={() => {
							addTicketType(pendingScope);
							setShowScopeModal(false);
						}}
					>
						{__('Add ticket type', 'fair-events')}
					</Button>
				</Modal>
			)}
		</VStack>
	);
}
