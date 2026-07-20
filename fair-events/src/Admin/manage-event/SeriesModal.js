/**
 * SeriesModal — "Turn into a series" / "Edit series" modal.
 *
 * Owns the frequency/ends fields and a live schedule preview, and saves
 * immediately on confirm (recurrence no longer rides along with the details
 * form's dirty-snapshot / Save flow). Also owns the "Irregular series"
 * click-to-toggle date picker.
 *
 * @package FairEvents
 */

import { useMemo, useState } from '@wordpress/element';
import {
	Button,
	Modal,
	Notice,
	TabPanel,
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	buildRRule,
	expandRRulePreview,
	parseRRule,
	MiniCalendar,
	RecurrenceControl,
} from 'fair-events-shared';

const DEFAULT_RECURRENCE = {
	enabled: true,
	frequency: 'weekly',
	endType: 'count',
	count: 10,
	until: '',
};

// Naive site-local date (no timezone re-conversion — see UI_GUIDELINES.md
// "Dates and times"). Only the calendar date matters for the preview.
function formatPreviewDate(dateStr) {
	return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'short',
		day: 'numeric',
	});
}

// Naive site-local Y-m-d slice — mirrors formatPreviewDate's no-reconversion
// rule (UI_GUIDELINES.md "Dates and times").
function dateOnly(datetime) {
	return datetime ? datetime.slice(0, 10) : '';
}

/**
 * Seed the extra (non-master) manual dates from whatever the modal already
 * knows about the series: an existing manual series' generated occurrences,
 * or (lossless rule → manual seeding) an existing rule series' generated
 * occurrences. The master's own date is tracked separately and never appears
 * in this list — see the `masterDate` prop of the "Irregular series" tab.
 *
 * @param {string}           masterDateStr        Master row's own date (Y-m-d).
 * @param {Array|undefined} generatedOccurrences Existing generated children, if any.
 * @return {string[]} Sorted, deduplicated Y-m-d dates, excluding the master's own date.
 */
function seedManualDates(masterDateStr, generatedOccurrences) {
	const dates = (generatedOccurrences || [])
		.map((occ) => dateOnly(occ.start_datetime))
		.filter((d) => Boolean(d) && d !== masterDateStr);

	return [...new Set(dates)].sort();
}

/**
 * @param {Object}        props
 * @param {number}        props.eventDateId            The event date being edited.
 * @param {string|null}   props.initialRrule           Stored rrule, or null when creating a new series.
 * @param {string|null}   props.initialRecurrenceMode  Stored recurrence_mode ('none'|'rule'|'manual'), or null.
 * @param {string}        props.startDatetime          Naive "Y-m-d H:i:s" start of the first occurrence, for the preview.
 * @param {Array}         [props.generatedOccurrences] Existing generated children, used to seed the manual-dates editor.
 * @param {Function}      props.onClose                Called to dismiss the modal without saving.
 * @param {Function}      props.onSaved                Called with the updated event date after a successful save.
 * @param {Function}      props.onImpact               Called with `{ impact, blocked }` (or null) after save succeeds or fails.
 */
export default function SeriesModal({
	eventDateId,
	initialRrule,
	initialRecurrenceMode,
	startDatetime,
	generatedOccurrences,
	onClose,
	onSaved,
	onImpact,
}) {
	const isEditing = !!initialRrule || 'manual' === initialRecurrenceMode;
	const isInitiallyManual = 'manual' === initialRecurrenceMode;

	const [activeTab, setActiveTab] = useState(
		isInitiallyManual ? 'irregular' : 'regular'
	);

	const [recurrence, setRecurrence] = useState(() =>
		initialRrule
			? { enabled: true, ...parseRRule(initialRrule) }
			: { ...DEFAULT_RECURRENCE }
	);
	// The master's own date is fixed — it's edited from the Event Details
	// form, not from this modal. Only the extra occurrence dates are
	// editable here.
	const masterDateStr = dateOnly(startDatetime);
	const [manualDates, setManualDates] = useState(() =>
		seedManualDates(masterDateStr, generatedOccurrences)
	);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState(null);

	const rrule = buildRRule(recurrence);

	// totalCount/lastDate cover every generated date regardless of `limit`, so
	// a large limit doubles as "give me the full list" for the calendar.
	const preview = useMemo(
		() => expandRRulePreview(rrule, startDatetime, Infinity),
		[rrule, startDatetime]
	);
	const generatedDatesSet = useMemo(() => new Set(preview.dates), [preview]);

	const regularDayProps = (dateStr) => {
		if (!generatedDatesSet.has(dateStr)) return {};
		const isMaster = dateStr === masterDateStr;
		return {
			background: isMaster ? '#007cba' : '#4ab866',
			color: '#fff',
			fontWeight: 600,
		};
	};

	const allManualDates = [masterDateStr, ...manualDates];
	const uniqueManualDates = new Set(allManualDates);
	const hasDuplicateManualDates =
		uniqueManualDates.size !== allManualDates.length;
	const sortedSelectedDates = [...uniqueManualDates].sort();

	const toggleManualDate = (dateStr) => {
		if (dateStr === masterDateStr) return;
		setManualDates((prev) =>
			prev.includes(dateStr)
				? prev.filter((d) => d !== dateStr)
				: [...prev, dateStr].sort()
		);
	};

	const irregularDayProps = (dateStr) => {
		const isMaster = dateStr === masterDateStr;
		const isSelected = uniqueManualDates.has(dateStr);

		if (isMaster) {
			return {
				background: '#007cba',
				color: '#fff',
				fontWeight: 600,
				interactive: true,
				disabled: true,
				ariaPressed: true,
				tooltip: __(
					'Master date — edit it from Event Details',
					'fair-events'
				),
			};
		}

		return {
			background: isSelected ? '#4ab866' : 'transparent',
			color: isSelected ? '#fff' : '#1e1e1e',
			fontWeight: isSelected ? 600 : 400,
			interactive: true,
			ariaPressed: isSelected,
			onActivate: () => toggleManualDate(dateStr),
			tooltip: isSelected
				? __('Selected — click to remove this date', 'fair-events')
				: __('Click to add this date', 'fair-events'),
		};
	};

	const isManualTab = 'irregular' === activeTab;

	const handleConfirm = async () => {
		setSaving(true);
		setError(null);

		try {
			const data = isManualTab
				? {
						recurrence_mode: 'manual',
						manual_dates: allManualDates,
				  }
				: { rrule };

			const updated = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}`,
				method: 'PUT',
				data,
			});
			onImpact(
				updated.recurrence_impact
					? { impact: updated.recurrence_impact, blocked: false }
					: null
			);
			onSaved(updated);
		} catch (err) {
			setError(
				err.message || __('Failed to save the series.', 'fair-events')
			);
			onImpact(
				err.data?.impact
					? { impact: err.data.impact, blocked: true }
					: null
			);
		} finally {
			setSaving(false);
		}
	};

	const manualDateCount = uniqueManualDates.size;

	const confirmLabel = isManualTab
		? isEditing
			? sprintf(
					/* translators: %d: number of dates in the series */
					__('Update series — %d dates', 'fair-events'),
					manualDateCount
			  )
			: sprintf(
					/* translators: %d: number of dates in the series */
					__('Create series — %d dates', 'fair-events'),
					manualDateCount
			  )
		: isEditing
		? sprintf(
				/* translators: %d: number of dates in the series */
				__('Update series — %d dates', 'fair-events'),
				preview.totalCount
		  )
		: sprintf(
				/* translators: %d: number of dates in the series */
				__('Create series — %d dates', 'fair-events'),
				preview.totalCount
		  );

	const confirmDisabled = saving
		? true
		: isManualTab
		? hasDuplicateManualDates
		: preview.totalCount === 0;

	const tabs = [
		{
			name: 'regular',
			title: __('Regular schedule', 'fair-events'),
		},
		{
			name: 'irregular',
			title: __('Irregular series', 'fair-events'),
		},
	];

	return (
		<Modal
			title={
				isEditing
					? __('Edit series', 'fair-events')
					: __('Turn into a series', 'fair-events')
			}
			onRequestClose={onClose}
			className="fair-events-series-modal"
		>
			{error && (
				<Notice status="error" isDismissible={false}>
					{error}
				</Notice>
			)}

			<TabPanel
				tabs={tabs}
				initialTabName={activeTab}
				onSelect={setActiveTab}
			>
				{(tab) =>
					tab.name === 'regular' ? (
						<HStack
							spacing={6}
							alignment="top"
							wrap
							style={{ marginTop: '16px' }}
						>
							<VStack spacing={4} style={{ minWidth: '260px' }}>
								<RecurrenceControl
									value={recurrence}
									onChange={setRecurrence}
									hideToggle
								/>
							</VStack>

							<VStack spacing={2} style={{ minWidth: '260px' }}>
								<strong>
									{__('Schedule preview', 'fair-events')}
								</strong>
								{preview.dates.length === 0 ? (
									<p>
										{__(
											'No dates match this schedule yet.',
											'fair-events'
										)}
									</p>
								) : (
									<>
										<MiniCalendar
											minDate={preview.dates[0]}
											maxDate={preview.lastDate}
											dayProps={regularDayProps}
										/>
										<p>
											{sprintf(
												/* translators: 1: number of dates in the series, 2: last date in the series */
												__(
													'%1$d dates, until %2$s',
													'fair-events'
												),
												preview.totalCount,
												formatPreviewDate(
													preview.lastDate
												)
											)}
										</p>
									</>
								)}
							</VStack>
						</HStack>
					) : (
						<VStack spacing={3} style={{ marginTop: '16px' }}>
							<p>
								{__(
									'Pick the exact dates this event happens on.',
									'fair-events'
								)}
							</p>
							<p style={{ color: '#757575' }}>
								{__(
									'One session per day. All dates share the event’s start time and length.',
									'fair-events'
								)}
							</p>

							{hasDuplicateManualDates && (
								<Notice status="error" isDismissible={false}>
									{__(
										'Each date can only be used once — remove the duplicate before saving.',
										'fair-events'
									)}
								</Notice>
							)}

							<MiniCalendar
								minDate={sortedSelectedDates[0]}
								maxDate={
									sortedSelectedDates[
										sortedSelectedDates.length - 1
									]
								}
								dayProps={irregularDayProps}
								allowForwardBeyondRange
							/>

							<p style={{ color: '#757575' }}>
								{sprintf(
									/* translators: %d: number of selected dates */
									__('%d dates selected', 'fair-events'),
									manualDateCount
								)}
							</p>
						</VStack>
					)
				}
			</TabPanel>

			<HStack
				justify="flex-end"
				spacing={2}
				style={{ marginTop: '24px' }}
			>
				<Button variant="tertiary" onClick={onClose} disabled={saving}>
					{__('Cancel', 'fair-events')}
				</Button>
				<Button
					variant="primary"
					onClick={handleConfirm}
					isBusy={saving}
					disabled={confirmDisabled}
				>
					{confirmLabel}
				</Button>
			</HStack>
		</Modal>
	);
}
