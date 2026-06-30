/**
 * RecurrenceImpactSummary Component
 *
 * Displays the outcome of a recurrence change: either a blocked-edit warning
 * (HTTP 409 path) listing which occurrences cannot be removed, or an
 * informational summary of what was shifted / added / removed after a
 * successful save.
 *
 * @package FairEvents
 */

import { Notice } from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';

function formatDate(dateStr) {
	return new Date(dateStr).toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});
}

/**
 * @param {Object}        props
 * @param {Object}        props.impact   Impact object from the API (unchanged/shifted/added/removed arrays).
 * @param {boolean}       props.blocked  True when the change was rejected (HTTP 409); false when it was applied.
 * @param {Function|null} props.onDismiss Called when the user dismisses the notice.
 */
export default function RecurrenceImpactSummary({
	impact,
	blocked,
	onDismiss,
}) {
	if (!impact) return null;

	const { shifted = [], added = [], removed = [] } = impact;

	if (blocked) {
		const blockedRemovals = removed.filter(
			(r) => r.dependents > 0 || r.is_past
		);

		if (blockedRemovals.length === 0) return null;

		return (
			<Notice
				status="warning"
				isDismissible={!!onDismiss}
				onRemove={onDismiss}
			>
				<p style={{ margin: '0 0 8px' }}>
					{__('This change cannot be applied:', 'fair-events')}
				</p>
				<ul style={{ margin: 0, paddingLeft: '20px' }}>
					{blockedRemovals.map((r) => (
						<li key={r.id}>
							{formatDate(r.start_datetime)}
							{r.dependents > 0 && (
								<>
									{' — '}
									{sprintf(
										/* translators: %d: number of dependents (ticket types / signups) */
										__('%d dependent(s)', 'fair-events'),
										r.dependents
									)}
								</>
							)}
							{r.is_past && (
								<>
									{' '}
									{'— '}
									{__('in the past', 'fair-events')}
								</>
							)}
						</li>
					))}
				</ul>
			</Notice>
		);
	}

	const hasMeaningfulChange =
		shifted.length > 0 || added.length > 0 || removed.length > 0;
	if (!hasMeaningfulChange) return null;

	const parts = [];
	if (shifted.length > 0) {
		parts.push(
			sprintf(
				/* translators: %d: number of occurrences shifted in time */
				__('%d shifted', 'fair-events'),
				shifted.length
			)
		);
	}
	if (added.length > 0) {
		parts.push(
			sprintf(
				/* translators: %d: number of new occurrences */
				__('%d added', 'fair-events'),
				added.length
			)
		);
	}
	if (removed.length > 0) {
		parts.push(
			sprintf(
				/* translators: %d: number of removed occurrences */
				__('%d removed', 'fair-events'),
				removed.length
			)
		);
	}

	return (
		<Notice status="info" isDismissible={!!onDismiss} onRemove={onDismiss}>
			{sprintf(
				/* translators: %s: comma-separated list of change counts, e.g. "2 shifted, 1 added" */
				__('Recurrence updated: %s.', 'fair-events'),
				parts.join(', ')
			)}
		</Notice>
	);
}
