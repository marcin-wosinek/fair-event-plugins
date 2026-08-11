/**
 * SeriesModal — "Turn into a series" / "Edit series" modal.
 *
 * Owns the frequency/ends fields and a live schedule preview, and saves
 * immediately on confirm (recurrence no longer rides along with the details
 * form's dirty-snapshot / Save flow). Also owns the "Irregular series"
 * click-to-toggle date picker, which supports more than one session per day
 * (#1414) — a date can hold an independently-timed extra session alongside
 * (or instead of) the series master's own session.
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
	formatDateOnly,
	generateUuid,
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

// Naive site-local Y-m-d / H:i slices — mirrors formatDateOnly's
// no-reconversion rule (UI_GUIDELINES.md "Dates and times").
function dateOnly(datetime) {
	return datetime ? datetime.slice(0, 10) : '';
}
function timeOnly(datetime) {
	return datetime ? datetime.slice(11, 16) : '';
}

/**
 * Minutes between two "HH:MM" times, assumed same-day (a session's start and
 * end always share a date in this editor).
 */
function minutesBetween(startTime, endTime) {
	const [sh, sm] = startTime.split(':').map(Number);
	const [eh, em] = endTime.split(':').map(Number);
	return eh * 60 + em - (sh * 60 + sm);
}

function addMinutes(time, minutes) {
	const [h, m] = time.split(':').map(Number);
	const total = (((h * 60 + m + minutes) % 1440) + 1440) % 1440;
	const hh = String(Math.floor(total / 60)).padStart(2, '0');
	const mm = String(total % 60).padStart(2, '0');
	return `${hh}:${mm}`;
}

/**
 * Seed the extra (non-master) sessions from whatever the modal already knows
 * about the series: an existing manual series' generated occurrences, or
 * (lossless rule → manual seeding) an existing rule series' generated
 * occurrences. The master's own session is tracked separately and never
 * appears in this list — see the `masterDateStr` handling below. A local
 * `key` (independent of the server `id`) gives every row — including
 * not-yet-saved ones sharing `id: null` — a stable React key and
 * remove/edit target.
 *
 * @param {Array|undefined} generatedOccurrences Existing generated children, if any.
 * @return {Array} Sessions sorted by date then start time.
 */
function seedManualSessions(generatedOccurrences) {
	const sessions = (generatedOccurrences || [])
		.filter((occ) => Boolean(occ.start_datetime))
		.map((occ) => ({
			key: generateUuid(),
			id: occ.id,
			date: dateOnly(occ.start_datetime),
			startTime: timeOnly(occ.start_datetime),
			endTime: timeOnly(occ.end_datetime) || timeOnly(occ.start_datetime),
		}));

	sessions.sort((a, b) =>
		`${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`)
	);

	return sessions;
}

/**
 * @param {Object}        props
 * @param {number}        props.eventDateId            The event date being edited.
 * @param {string|null}   props.initialRrule           Stored rrule, or null when creating a new series.
 * @param {string|null}   props.initialRecurrenceMode  Stored recurrence_mode ('none'|'rule'|'manual'), or null.
 * @param {string}        props.startDatetime          Naive "Y-m-d H:i:s" start of the master's own session.
 * @param {string}        props.endDatetime            Naive "Y-m-d H:i:s" end of the master's own session — supplies the time/duration seeded onto new sessions.
 * @param {Array}         [props.generatedOccurrences] Existing generated children, used to seed the sessions editor.
 * @param {Function}      props.onClose                Called to dismiss the modal without saving.
 * @param {Function}      props.onSaved                Called with the updated event date after a successful save.
 * @param {Function}      props.onImpact               Called with `{ impact, blocked }` (or null) after save succeeds or fails.
 */
export default function SeriesModal({
	eventDateId,
	initialRrule,
	initialRecurrenceMode,
	startDatetime,
	endDatetime,
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

	// The master's own date and time are fixed — edited from the Event
	// Details form, not from this modal.
	const masterDateStr = dateOnly(startDatetime);
	const masterStartTime = timeOnly(startDatetime);
	const masterEndTime = timeOnly(endDatetime);
	const masterDurationMinutes = minutesBetween(
		masterStartTime,
		masterEndTime
	);

	// Extra sessions only — the master's own session is never part of this
	// list (see masterDateStr above), so a date can appear here more than
	// once (multiple sessions sharing a day) or not at all.
	const [manualSessions, setManualSessions] = useState(() =>
		seedManualSessions(generatedOccurrences)
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

	const sessionsByDate = useMemo(() => {
		const map = new Map();
		for (const session of manualSessions) {
			if (!map.has(session.date)) map.set(session.date, []);
			map.get(session.date).push(session);
		}
		return map;
	}, [manualSessions]);

	const selectedDates = useMemo(() => {
		const set = new Set([masterDateStr]);
		manualSessions.forEach((session) => set.add(session.date));
		return set;
	}, [manualSessions, masterDateStr]);

	const sortedDates = useMemo(
		() => [...selectedDates].sort(),
		[selectedDates]
	);

	const sessionCountForDate = (dateStr) =>
		(dateStr === masterDateStr ? 1 : 0) +
		(sessionsByDate.get(dateStr)?.length || 0);

	const newSessionFor = (dateStr) => ({
		key: generateUuid(),
		id: null,
		date: dateStr,
		startTime: masterStartTime,
		endTime:
			masterDurationMinutes > 0
				? addMinutes(masterStartTime, masterDurationMinutes)
				: masterStartTime,
	});

	const toggleDate = (dateStr) => {
		if (dateStr === masterDateStr) return;
		setManualSessions((prev) => {
			const hasAny = prev.some((session) => session.date === dateStr);
			return hasAny
				? prev.filter((session) => session.date !== dateStr)
				: [...prev, newSessionFor(dateStr)];
		});
	};

	const addSession = (dateStr) => {
		setManualSessions((prev) => [...prev, newSessionFor(dateStr)]);
	};

	const removeSession = (key) => {
		setManualSessions((prev) =>
			prev.filter((session) => session.key !== key)
		);
	};

	const updateSessionTime = (key, field, value) => {
		setManualSessions((prev) =>
			prev.map((session) =>
				session.key === key ? { ...session, [field]: value } : session
			)
		);
	};

	const irregularDayProps = (dateStr) => {
		const isMaster = dateStr === masterDateStr;
		const isSelected = selectedDates.has(dateStr);
		const count = sessionCountForDate(dateStr);
		const badge = count > 1 ? String(count) : undefined;

		if (isMaster) {
			return {
				background: '#007cba',
				color: '#fff',
				fontWeight: 600,
				interactive: true,
				disabled: true,
				ariaPressed: true,
				badge,
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
			badge,
			onActivate: () => toggleDate(dateStr),
			tooltip: isSelected
				? __(
						'Selected — click to remove every session on this date',
						'fair-events'
				  )
				: __('Click to add a session on this date', 'fair-events'),
		};
	};

	const isManualTab = 'irregular' === activeTab;

	const hasInvalidSessions = manualSessions.some(
		(session) =>
			!session.startTime ||
			!session.endTime ||
			session.endTime <= session.startTime
	);

	const buildManualSessionsPayload = () => [
		{
			id: eventDateId,
			start_datetime: startDatetime,
			end_datetime: endDatetime,
		},
		...manualSessions.map((session) => ({
			id: session.id,
			start_datetime: `${session.date} ${session.startTime}:00`,
			end_datetime: `${session.date} ${session.endTime}:00`,
		})),
	];

	const handleConfirm = async () => {
		setSaving(true);
		setError(null);

		try {
			const data = isManualTab
				? {
						recurrence_mode: 'manual',
						manual_sessions: buildManualSessionsPayload(),
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

	const manualDateCount = selectedDates.size;

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
		? hasInvalidSessions
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
												formatDateOnly(
													preview.lastDate,
													'short'
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
									'Pick the dates this event happens on. Click a date to add or remove it — a day can hold more than one session.',
									'fair-events'
								)}
							</p>

							{hasInvalidSessions && (
								<Notice status="error" isDismissible={false}>
									{__(
										'Every session needs a start and end time, with the end after the start.',
										'fair-events'
									)}
								</Notice>
							)}

							<MiniCalendar
								minDate={sortedDates[0]}
								maxDate={sortedDates[sortedDates.length - 1]}
								dayProps={irregularDayProps}
								allowForwardBeyondRange
							/>

							<VStack spacing={3}>
								<strong>{__('Sessions', 'fair-events')}</strong>
								{sortedDates.map((dateStr) => {
									const sessions = (
										sessionsByDate.get(dateStr) || []
									)
										.slice()
										.sort((a, b) =>
											a.startTime.localeCompare(
												b.startTime
											)
										);

									return (
										<VStack
											key={dateStr}
											spacing={2}
											style={{
												borderTop: '1px solid #e0e0e0',
												paddingTop: '8px',
											}}
										>
											<strong
												style={{ fontSize: '13px' }}
											>
												{formatDateOnly(
													dateStr,
													'long'
												)}
											</strong>

											{dateStr === masterDateStr && (
												<span
													style={{
														color: '#757575',
													}}
												>
													{sprintf(
														/* translators: 1: start time, 2: end time */
														__(
															'%1$s–%2$s (master — edit from Event Details)',
															'fair-events'
														),
														masterStartTime,
														masterEndTime
													)}
												</span>
											)}

											{sessions.map((session) => (
												<HStack
													key={session.key}
													spacing={2}
													alignment="center"
												>
													<TextControl
														label={__(
															'Session start time',
															'fair-events'
														)}
														hideLabelFromVision
														type="time"
														value={
															session.startTime
														}
														onChange={(value) =>
															updateSessionTime(
																session.key,
																'startTime',
																value
															)
														}
													/>
													<TextControl
														label={__(
															'Session end time',
															'fair-events'
														)}
														hideLabelFromVision
														type="time"
														value={session.endTime}
														onChange={(value) =>
															updateSessionTime(
																session.key,
																'endTime',
																value
															)
														}
													/>
													<Button
														icon="no-alt"
														label={__(
															'Remove session',
															'fair-events'
														)}
														isDestructive
														onClick={() =>
															removeSession(
																session.key
															)
														}
													/>
												</HStack>
											))}

											<Button
												variant="link"
												onClick={() =>
													addSession(dateStr)
												}
											>
												{__(
													'+ Add session',
													'fair-events'
												)}
											</Button>
										</VStack>
									);
								})}
							</VStack>
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
