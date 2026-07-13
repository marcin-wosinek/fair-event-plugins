/**
 * EditInstancesModal — lists a series' occurrences with explicit
 * Cancel / Restore actions. This is the only place cancel/restore happens;
 * the calendar grid is navigation-only.
 *
 * @package FairEvents
 */

import { useMemo } from '@wordpress/element';
import {
	Button,
	Modal,
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';

// Naive site-local date (no timezone re-conversion — see UI_GUIDELINES.md
// "Dates and times"). Only the calendar date matters here.
function formatInstanceDate(dateStr) {
	return new Date(`${dateStr}T00:00:00`).toLocaleDateString(undefined, {
		weekday: 'long',
		year: 'numeric',
		month: 'long',
		day: 'numeric',
	});
}

/**
 * @param {Object}   props
 * @param {Array}    props.generatedOccurrences All occurrences (active and cancelled) from the master's `generated_occurrences`.
 * @param {string}   props.togglingExdate       The date currently being toggled, or null.
 * @param {Function} props.onToggleExdate       Called with a `Y-m-d` date to cancel/restore it.
 * @param {Function} props.onClose              Called to dismiss the modal.
 */
export default function EditInstancesModal({
	generatedOccurrences,
	togglingExdate,
	onToggleExdate,
	onClose,
}) {
	const occurrences = useMemo(() => {
		return [...(generatedOccurrences || [])].sort((a, b) =>
			a.start_datetime.localeCompare(b.start_datetime)
		);
	}, [generatedOccurrences]);

	return (
		<Modal
			title={__('Edit instances', 'fair-events')}
			onRequestClose={onClose}
			className="fair-events-edit-instances-modal"
		>
			<VStack spacing={2}>
				{occurrences.length === 0 && (
					<p>{__('No occurrences yet.', 'fair-events')}</p>
				)}
				{occurrences.map((occ) => {
					const date = occ.start_datetime.split(' ')[0];
					const isCancelled = occ.status === 'cancelled';
					const isToggling = togglingExdate === date;

					return (
						<HStack key={occ.id} justify="space-between">
							<span
								style={{
									textDecoration: isCancelled
										? 'line-through'
										: 'none',
								}}
							>
								{formatInstanceDate(date)}
								{isCancelled &&
									` (${__('Cancelled', 'fair-events')})`}
							</span>
							<Button
								variant="tertiary"
								isDestructive={!isCancelled}
								isBusy={isToggling}
								disabled={isToggling}
								onClick={() => onToggleExdate(date)}
							>
								{isCancelled
									? __('Restore', 'fair-events')
									: __('Cancel', 'fair-events')}
							</Button>
						</HStack>
					);
				})}
			</VStack>

			<HStack justify="flex-end" style={{ marginTop: '24px' }}>
				<Button variant="tertiary" onClick={onClose}>
					{__('Close', 'fair-events')}
				</Button>
			</HStack>
		</Modal>
	);
}
