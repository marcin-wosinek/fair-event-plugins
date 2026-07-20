/**
 * Recurrence Calendar Component
 *
 * Simple mini-calendar showing recurring event occurrences. Every occurrence
 * and the master cell navigate to their manage-event page; cancelling and
 * restoring occurrences happens in the "Edit instances" modal instead. Thin
 * adapter over the shared `MiniCalendar` grid/paging primitive.
 *
 * @package FairEvents
 */

import { useMemo } from '@wordpress/element';
import { Card, CardHeader, CardBody } from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import { MiniCalendar } from 'fair-events-shared';

export default function RecurrenceCalendar({
	generatedOccurrences,
	cancelledDates,
	masterDate,
	manageEventUrl,
	masterEventDateId,
	embedded = false,
}) {
	const occurrences = generatedOccurrences || [];
	const cancelledDatesList = cancelledDates || [];

	// generatedOccurrences includes cancelled rows too (with id/status), so a
	// single map covers both active and cancelled cells.
	const occurrenceByDate = useMemo(() => {
		const map = {};
		occurrences.forEach((occ) => {
			const date = occ.start_datetime.split(' ')[0];
			map[date] = occ;
		});
		return map;
	}, [occurrences]);

	const cancelledSet = useMemo(
		() => new Set(cancelledDatesList),
		[cancelledDatesList]
	);

	// Determine the date range to show
	const allDates = useMemo(() => {
		const dates = [];
		occurrences.forEach((occ) => {
			dates.push(occ.start_datetime.split(' ')[0]);
		});
		cancelledDatesList.forEach((d) => dates.push(d));
		if (masterDate) {
			dates.push(masterDate);
		}
		return dates.sort();
	}, [occurrences, cancelledDatesList, masterDate]);

	if (allDates.length === 0) return null;

	const dayProps = (dateStr) => {
		const occ = occurrenceByDate[dateStr];
		const isCancelled =
			occ?.status === 'cancelled' || cancelledSet.has(dateStr);
		const isOccurrence = !!occ && !isCancelled;
		const isMaster = dateStr === masterDate;

		if (!isMaster && !isOccurrence && !isCancelled) {
			return {};
		}

		let background = 'transparent';
		let color = '#1e1e1e';
		let opacity = 1;
		let textDecoration = 'none';

		if (isMaster) {
			background = '#007cba';
			color = '#fff';
		} else if (isCancelled) {
			background = '#cc1818';
			color = '#fff';
			opacity = 0.6;
			textDecoration = 'line-through';
		} else if (isOccurrence) {
			background = '#4ab866';
			color = '#fff';
		}

		const common = {
			background,
			color,
			opacity,
			textDecoration,
			fontWeight: 600,
		};

		if (isMaster) {
			return {
				...common,
				href: `${manageEventUrl}&event_date_id=${masterEventDateId}`,
				tooltip: __('Master event', 'fair-events'),
			};
		}

		return {
			...common,
			href: `${manageEventUrl}&event_date_id=${occ.id}`,
			tooltip: __('Open this occurrence', 'fair-events'),
		};
	};

	const calendarBody = (
		<>
			<MiniCalendar
				minDate={allDates[0]}
				maxDate={allDates[allDates.length - 1]}
				dayProps={dayProps}
			/>
			<div
				style={{
					marginTop: '16px',
					display: 'flex',
					gap: '16px',
					fontSize: '12px',
					color: '#757575',
				}}
			>
				<span>
					<span
						style={{
							display: 'inline-block',
							width: '12px',
							height: '12px',
							background: '#007cba',
							borderRadius: '2px',
							verticalAlign: 'middle',
							marginRight: '4px',
						}}
					/>
					{__('Master', 'fair-events')}
				</span>
				<span>
					<span
						style={{
							display: 'inline-block',
							width: '12px',
							height: '12px',
							background: '#4ab866',
							borderRadius: '2px',
							verticalAlign: 'middle',
							marginRight: '4px',
						}}
					/>
					{__('Active', 'fair-events')}
				</span>
				<span>
					<span
						style={{
							display: 'inline-block',
							width: '12px',
							height: '12px',
							background: '#cc1818',
							borderRadius: '2px',
							verticalAlign: 'middle',
							marginRight: '4px',
							opacity: 0.6,
						}}
					/>
					{__('Cancelled', 'fair-events')}
				</span>
			</div>
		</>
	);

	if (embedded) {
		return calendarBody;
	}

	return (
		<Card style={{ marginTop: '16px' }}>
			<CardHeader>
				<h2 style={{ margin: 0 }}>
					{__('Recurring Occurrences', 'fair-events')}
				</h2>
			</CardHeader>
			<CardBody>{calendarBody}</CardBody>
		</Card>
	);
}
