/**
 * SeriesModal — "Turn into a series" / "Edit series" modal.
 *
 * Owns the frequency/ends fields and a live schedule preview, and saves
 * immediately on confirm (recurrence no longer rides along with the details
 * form's dirty-snapshot / Save flow). Also owns the "Irregular series"
 * hand-picked-dates editor.
 *
 * @package FairEvents
 */

import { useMemo, useState } from '@wordpress/element';
import {
	Button,
	Modal,
	Notice,
	TabPanel,
	TextControl,
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	buildRRule,
	expandRRulePreview,
	parseRRule,
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
 * Seed the manual-dates list from whatever the modal already knows about the
 * series: an existing manual series' own occurrences, or (lossless rule →
 * manual seeding) an existing rule series' generated occurrences, or just the
 * event's own start date for a brand-new series.
 *
 * @param {string}      startDatetime       Master row's start_datetime.
 * @param {Array|undefined} generatedOccurrences Existing generated children, if any.
 * @return {string[]} Sorted, deduplicated Y-m-d dates.
 */
function seedManualDates(startDatetime, generatedOccurrences) {
	const dates = [
		dateOnly(startDatetime),
		...(generatedOccurrences || []).map((occ) =>
			dateOnly(occ.start_datetime)
		),
	].filter(Boolean);

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
	const [manualDates, setManualDates] = useState(() =>
		seedManualDates(startDatetime, generatedOccurrences)
	);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState(null);

	const rrule = buildRRule(recurrence);

	const preview = useMemo(
		() => expandRRulePreview(rrule, startDatetime, 4),
		[rrule, startDatetime]
	);

	const filledManualDates = manualDates.filter(Boolean);
	const uniqueManualDates = new Set(filledManualDates);
	const hasDuplicateManualDates =
		uniqueManualDates.size !== filledManualDates.length;

	const updateManualDate = (index, value) => {
		setManualDates((prev) => prev.map((d, i) => (i === index ? value : d)));
	};

	const addManualDateRow = () => {
		setManualDates((prev) => [...prev, '']);
	};

	const removeManualDateRow = (index) => {
		setManualDates((prev) => prev.filter((_, i) => i !== index));
	};

	const isManualTab = 'irregular' === activeTab;

	const handleConfirm = async () => {
		setSaving(true);
		setError(null);

		try {
			const data = isManualTab
				? {
						recurrence_mode: 'manual',
						manual_dates: filledManualDates,
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
		? filledManualDates.length === 0 || hasDuplicateManualDates
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

							<VStack spacing={2} style={{ minWidth: '200px' }}>
								<strong>
									{__('Schedule preview', 'fair-events')}
								</strong>
								{preview.dates.length === 0 && (
									<p>
										{__(
											'No dates match this schedule yet.',
											'fair-events'
										)}
									</p>
								)}
								<ul style={{ margin: 0, paddingLeft: '20px' }}>
									{preview.dates.map((date) => (
										<li key={date}>
											{formatPreviewDate(date)}
										</li>
									))}
								</ul>
								{preview.remainingCount > 0 && (
									<p>
										{sprintf(
											/* translators: 1: number of remaining dates, 2: last date in the series */
											__(
												'… %1$d more, until %2$s',
												'fair-events'
											),
											preview.remainingCount,
											formatPreviewDate(preview.lastDate)
										)}
									</p>
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

							<VStack spacing={2}>
								{manualDates.map((date, index) => (
									// eslint-disable-next-line react/no-array-index-key
									<HStack key={index} alignment="center">
										<TextControl
											type="date"
											label={sprintf(
												/* translators: %d: 1-based row number in the manual date list */
												__('Date %d', 'fair-events'),
												index + 1
											)}
											hideLabelFromVision
											value={date}
											onChange={(value) =>
												updateManualDate(index, value)
											}
										/>
										<Button
											variant="tertiary"
											isDestructive
											onClick={() =>
												removeManualDateRow(index)
											}
											disabled={manualDates.length === 1}
										>
											{__('Remove', 'fair-events')}
										</Button>
									</HStack>
								))}
							</VStack>

							<Button
								variant="secondary"
								onClick={addManualDateRow}
							>
								{__('Add date', 'fair-events')}
							</Button>
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
