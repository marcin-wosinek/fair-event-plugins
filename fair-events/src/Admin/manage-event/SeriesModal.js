/**
 * SeriesModal — "Turn into a series" / "Edit series" modal.
 *
 * Owns the frequency/ends fields and a live schedule preview, and saves
 * immediately on confirm (recurrence no longer rides along with the details
 * form's dirty-snapshot / Save flow).
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

/**
 * @param {Object}        props
 * @param {number}        props.eventDateId   The event date being edited.
 * @param {string|null}   props.initialRrule  Stored rrule, or null when creating a new series.
 * @param {string}        props.startDatetime Naive "Y-m-d H:i:s" start of the first occurrence, for the preview.
 * @param {Function}      props.onClose       Called to dismiss the modal without saving.
 * @param {Function}      props.onSaved       Called with the updated event date after a successful save.
 * @param {Function}      props.onImpact      Called with `{ impact, blocked }` (or null) after save succeeds or fails.
 */
export default function SeriesModal({
	eventDateId,
	initialRrule,
	startDatetime,
	onClose,
	onSaved,
	onImpact,
}) {
	const isEditing = !!initialRrule;

	const [recurrence, setRecurrence] = useState(() =>
		initialRrule
			? { enabled: true, ...parseRRule(initialRrule) }
			: { ...DEFAULT_RECURRENCE }
	);
	const [saving, setSaving] = useState(false);
	const [error, setError] = useState(null);

	const rrule = buildRRule(recurrence);

	const preview = useMemo(
		() => expandRRulePreview(rrule, startDatetime, 4),
		[rrule, startDatetime]
	);

	const handleConfirm = async () => {
		setSaving(true);
		setError(null);

		try {
			const updated = await apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}`,
				method: 'PUT',
				data: { rrule },
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

	const confirmLabel = isEditing
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

	const tabs = [
		{
			name: 'regular',
			title: __('Regular schedule', 'fair-events'),
		},
		{
			name: 'irregular',
			title: __('Irregular series', 'fair-events'),
			disabled: true,
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

			<TabPanel tabs={tabs}>
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
						<p style={{ marginTop: '16px' }}>
							{__(
								'Irregular series (picking arbitrary dates) is coming in a future update.',
								'fair-events'
							)}
						</p>
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
					disabled={saving || preview.totalCount === 0}
				>
					{confirmLabel}
				</Button>
			</HStack>
		</Modal>
	);
}
