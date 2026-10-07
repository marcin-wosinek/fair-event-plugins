/**
 * SeriesModal — "Turn into a series" / "Edit series" modal.
 *
 * Owns the frequency/ends fields and a live schedule preview, and saves
 * immediately on confirm (recurrence no longer rides along with the details
 * form's dirty-snapshot / Save flow). The preview calendar doubles as the
 * place to skip individual dates of a regular schedule. Also owns the
 * "Irregular series" click-to-toggle date picker.
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
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	buildRRule,
	expandRRulePreview,
	parseRRule,
	formatDateOnly,
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

// Naive site-local Y-m-d slice — mirrors formatDateOnly's no-reconversion
// rule (UI_GUIDELINES.md "Dates and times").
function dateOnly( datetime ) {
	return datetime ? datetime.slice( 0, 10 ) : '';
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
function seedManualDates( masterDateStr, generatedOccurrences ) {
	const dates = ( generatedOccurrences || [] )
		.map( ( occ ) => dateOnly( occ.start_datetime ) )
		.filter( ( d ) => Boolean( d ) && d !== masterDateStr );

	return [ ...new Set( dates ) ].sort();
}

/**
 * @param {Object}        props
 * @param {number}        props.eventDateId            The event date being edited.
 * @param {string|null}   props.initialRrule           Stored rrule, or null when creating a new series.
 * @param {string|null}   props.initialRecurrenceMode  Stored recurrence_mode ('none'|'rule'|'manual'), or null.
 * @param {string}        props.startDatetime          Naive "Y-m-d H:i:s" start of the first occurrence, for the preview.
 * @param {Array}         [props.generatedOccurrences] Existing generated children, used to seed the manual-dates editor.
 * @param {string[]}      [props.cancelledDates]       Cancelled dates (Y-m-d) of an existing regular series, shown as skipped.
 * @param {Function}      props.onClose                Called to dismiss the modal without saving.
 * @param {Function}      props.onSaved                Called with the updated event date after a successful save.
 * @param {Function}      props.onImpact               Called with `{ impact, blocked }` (or null) after save succeeds or fails.
 */
export default function SeriesModal( {
	eventDateId,
	initialRrule,
	initialRecurrenceMode,
	startDatetime,
	generatedOccurrences,
	cancelledDates,
	onClose,
	onSaved,
	onImpact,
} ) {
	const isEditing = !! initialRrule || 'manual' === initialRecurrenceMode;
	const isInitiallyManual = 'manual' === initialRecurrenceMode;

	const [ activeTab, setActiveTab ] = useState(
		isInitiallyManual ? 'irregular' : 'regular'
	);

	const [ recurrence, setRecurrence ] = useState( () =>
		initialRrule
			? { enabled: true, ...parseRRule( initialRrule ) }
			: { ...DEFAULT_RECURRENCE }
	);
	// The master's own date is fixed — it's edited from the Event Details
	// form, not from this modal. Only the extra occurrence dates are
	// editable here.
	const masterDateStr = dateOnly( startDatetime );
	const [ manualDates, setManualDates ] = useState( () =>
		seedManualDates( masterDateStr, generatedOccurrences )
	);
	const [ saving, setSaving ] = useState( false );
	const [ error, setError ] = useState( null );

	const rrule = buildRRule( recurrence );

	// totalCount/lastDate cover every generated date regardless of `limit`, so
	// a large limit doubles as "give me the full list" for the calendar.
	const preview = useMemo(
		() => expandRRulePreview( rrule, startDatetime, Infinity ),
		[ rrule, startDatetime ]
	);
	const generatedDatesSet = useMemo(
		() => new Set( preview.dates ),
		[ preview ]
	);

	// Skipped dates of the regular schedule, by exact date. Seeded from the
	// stored series' cancelled dates that its own schedule still covers — a
	// date dropped by an earlier, shorter schedule is not a skip. Kept as
	// toggled while the modal is open, so a date that leaves the schedule and
	// comes back before saving is still skipped; only the ones in the current
	// schedule count and get saved.
	const [ skippedDates, setSkippedDates ] = useState( () =>
		initialRrule
			? ( cancelledDates || [] ).filter( ( d ) =>
					generatedDatesSet.has( d )
			  )
			: []
	);
	const skippedInSchedule = useMemo(
		() =>
			preview.dates.filter(
				( d ) => d !== masterDateStr && skippedDates.includes( d )
			),
		[ preview, skippedDates, masterDateStr ]
	);
	const skippedSet = useMemo(
		() => new Set( skippedInSchedule ),
		[ skippedInSchedule ]
	);
	const activeDates = useMemo(
		() => preview.dates.filter( ( d ) => ! skippedSet.has( d ) ),
		[ preview, skippedSet ]
	);
	const activeCount = preview.totalCount - skippedInSchedule.length;

	const toggleSkippedDate = ( dateStr ) =>
		setSkippedDates( ( prev ) =>
			prev.includes( dateStr )
				? prev.filter( ( d ) => d !== dateStr )
				: [ ...prev, dateStr ]
		);

	// Where each tab's calendar starts, fixed for as long as the modal is open:
	// its earliest date at opening. Later schedule edits and date toggles
	// recolour the days but never move this boundary or the viewed month.
	const [ calendarStart ] = useState( () => ( {
		regular: preview.dates[ 0 ] || masterDateStr,
		irregular: [ masterDateStr, ...manualDates ].sort()[ 0 ],
	} ) );
	// Owned here rather than by the calendar: TabPanel unmounts the inactive
	// tab, and each tab must come back on the month it was left on.
	const [ viewMonths, setViewMonths ] = useState( () => ( {
		regular: calendarStart.regular.slice( 0, 7 ),
		irregular: calendarStart.irregular.slice( 0, 7 ),
	} ) );
	const setViewMonth = ( tabName ) => ( month ) =>
		setViewMonths( ( prev ) => ( { ...prev, [ tabName ]: month } ) );

	const regularDayProps = ( dateStr ) => {
		if ( ! generatedDatesSet.has( dateStr ) ) return {};
		const dateLabel = formatDateOnly( dateStr, 'long' );

		if ( dateStr === masterDateStr ) {
			return {
				background: '#007cba',
				color: '#fff',
				fontWeight: 600,
				interactive: true,
				disabled: true,
				ariaPressed: true,
				ariaLabel: sprintf(
					/* translators: %s: full date, e.g. "November 3, 2026" */
					__( '%s — original date, always included', 'fair-events' ),
					dateLabel
				),
				tooltip: __(
					'Original date — change it in Event Details',
					'fair-events'
				),
			};
		}

		if ( skippedSet.has( dateStr ) ) {
			return {
				background: '#f0f0f0',
				color: '#50575e',
				border: '1px dashed #949494',
				textDecoration: 'line-through',
				interactive: true,
				ariaPressed: false,
				onActivate: () => toggleSkippedDate( dateStr ),
				ariaLabel: sprintf(
					/* translators: %s: full date, e.g. "November 3, 2026" */
					__( '%s — skipped, activate to restore', 'fair-events' ),
					dateLabel
				),
				tooltip: __( 'Skipped — click to restore', 'fair-events' ),
			};
		}

		return {
			background: '#4ab866',
			color: '#fff',
			fontWeight: 600,
			interactive: true,
			ariaPressed: true,
			onActivate: () => toggleSkippedDate( dateStr ),
			ariaLabel: sprintf(
				/* translators: %s: full date, e.g. "November 3, 2026" */
				__( '%s — included, activate to skip', 'fair-events' ),
				dateLabel
			),
			tooltip: __( 'Click to skip this date', 'fair-events' ),
		};
	};

	const allManualDates = [ masterDateStr, ...manualDates ];
	const uniqueManualDates = new Set( allManualDates );
	const hasDuplicateManualDates =
		uniqueManualDates.size !== allManualDates.length;

	const toggleManualDate = ( dateStr ) => {
		if ( dateStr === masterDateStr ) return;
		setManualDates( ( prev ) =>
			prev.includes( dateStr )
				? prev.filter( ( d ) => d !== dateStr )
				: [ ...prev, dateStr ].sort()
		);
	};

	const irregularDayProps = ( dateStr ) => {
		const isMaster = dateStr === masterDateStr;
		const isSelected = uniqueManualDates.has( dateStr );

		if ( isMaster ) {
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
			onActivate: () => toggleManualDate( dateStr ),
			tooltip: isSelected
				? __( 'Selected — click to remove this date', 'fair-events' )
				: __( 'Click to add this date', 'fair-events' ),
		};
	};

	const isManualTab = 'irregular' === activeTab;

	const handleConfirm = async () => {
		setSaving( true );
		setError( null );

		try {
			const data = isManualTab
				? {
						recurrence_mode: 'manual',
						manual_dates: allManualDates,
				  }
				: { rrule, excluded_dates: skippedInSchedule };

			const updated = await apiFetch( {
				path: `/fair-events/v1/event-dates/${ eventDateId }`,
				method: 'PUT',
				data,
			} );
			onImpact(
				updated.recurrence_impact
					? { impact: updated.recurrence_impact, blocked: false }
					: null
			);
			onSaved( updated );
		} catch ( err ) {
			setError(
				err.message || __( 'Failed to save the series.', 'fair-events' )
			);
			onImpact(
				err.data?.impact
					? { impact: err.data.impact, blocked: true }
					: null
			);
		} finally {
			setSaving( false );
		}
	};

	const manualDateCount = uniqueManualDates.size;
	const confirmCount = isManualTab ? manualDateCount : activeCount;

	const confirmLabel = isEditing
		? sprintf(
				/* translators: %d: number of dates in the series */
				_n(
					'Update series — %d date',
					'Update series — %d dates',
					confirmCount,
					'fair-events'
				),
				confirmCount
		  )
		: sprintf(
				/* translators: %d: number of dates in the series */
				_n(
					'Create series — %d date',
					'Create series — %d dates',
					confirmCount,
					'fair-events'
				),
				confirmCount
		  );

	const confirmDisabled = saving
		? true
		: isManualTab
		? hasDuplicateManualDates
		: preview.totalCount === 0;

	const tabs = [
		{
			name: 'regular',
			title: __( 'Regular schedule', 'fair-events' ),
		},
		{
			name: 'irregular',
			title: __( 'Irregular series', 'fair-events' ),
		},
	];

	return (
		<Modal
			title={
				isEditing
					? __( 'Edit series', 'fair-events' )
					: __( 'Turn into a series', 'fair-events' )
			}
			onRequestClose={ onClose }
			className="fair-events-series-modal"
		>
			{ error && (
				<Notice status="error" isDismissible={ false }>
					{ error }
				</Notice>
			) }

			<TabPanel
				tabs={ tabs }
				initialTabName={ activeTab }
				onSelect={ setActiveTab }
			>
				{ ( tab ) =>
					tab.name === 'regular' ? (
						<HStack
							spacing={ 6 }
							alignment="top"
							wrap
							style={ { marginTop: '16px' } }
						>
							<VStack
								spacing={ 4 }
								style={ { minWidth: '260px' } }
							>
								<RecurrenceControl
									value={ recurrence }
									onChange={ setRecurrence }
									hideToggle
								/>
							</VStack>

							<VStack
								spacing={ 2 }
								style={ { maxWidth: '100%' } }
							>
								<strong>
									{ __( 'Schedule preview', 'fair-events' ) }
								</strong>
								<MiniCalendar
									fixedMonths={ 2 }
									viewMonth={ viewMonths.regular }
									onViewMonthChange={ setViewMonth(
										'regular'
									) }
									minDate={ calendarStart.regular }
									maxDate={ preview.lastDate }
									dayProps={ regularDayProps }
								/>
								{ preview.dates.length === 0 ? (
									<p>
										{ __(
											'No dates match this schedule yet.',
											'fair-events'
										) }
									</p>
								) : (
									<>
										<p style={ { margin: 0 } }>
											{ sprintf(
												/* translators: 1: number of dates in the series, 2: last date in the series */
												_n(
													'%1$d date, until %2$s',
													'%1$d dates, until %2$s',
													activeCount,
													'fair-events'
												),
												activeCount,
												formatDateOnly(
													activeDates[
														activeDates.length - 1
													],
													'short'
												)
											) }
										</p>
										{ skippedInSchedule.length > 0 && (
											<p style={ { margin: 0 } }>
												{ sprintf(
													/* translators: %d: number of dates the organizer skipped */
													_n(
														'%d date skipped',
														'%d dates skipped',
														skippedInSchedule.length,
														'fair-events'
													),
													skippedInSchedule.length
												) }
											</p>
										) }
										<p
											style={ {
												margin: 0,
												color: '#757575',
												maxWidth: '420px',
											} }
										>
											{ __(
												'Click a date to skip it, and click it again to restore it. The original date (blue) is always part of the series.',
												'fair-events'
											) }
										</p>
									</>
								) }
							</VStack>
						</HStack>
					) : (
						<VStack spacing={ 3 } style={ { marginTop: '16px' } }>
							<p>
								{ __(
									'Pick the exact dates this event happens on.',
									'fair-events'
								) }
							</p>
							<p style={ { color: '#757575' } }>
								{ __(
									'One session per day. All dates share the event’s start time and length.',
									'fair-events'
								) }
							</p>

							{ hasDuplicateManualDates && (
								<Notice status="error" isDismissible={ false }>
									{ __(
										'Each date can only be used once — remove the duplicate before saving.',
										'fair-events'
									) }
								</Notice>
							) }

							<MiniCalendar
								fixedMonths={ 2 }
								viewMonth={ viewMonths.irregular }
								onViewMonthChange={ setViewMonth(
									'irregular'
								) }
								minDate={ calendarStart.irregular }
								dayProps={ irregularDayProps }
								allowForwardBeyondRange
							/>

							<p style={ { color: '#757575' } }>
								{ sprintf(
									/* translators: %d: number of selected dates */
									__( '%d dates selected', 'fair-events' ),
									manualDateCount
								) }
							</p>
						</VStack>
					)
				}
			</TabPanel>

			<HStack
				justify="flex-end"
				spacing={ 2 }
				style={ { marginTop: '24px' } }
			>
				<Button
					variant="tertiary"
					onClick={ onClose }
					disabled={ saving }
				>
					{ __( 'Cancel', 'fair-events' ) }
				</Button>
				<Button
					variant="primary"
					onClick={ handleConfirm }
					isBusy={ saving }
					disabled={ confirmDisabled }
				>
					{ confirmLabel }
				</Button>
			</HStack>
		</Modal>
	);
}
