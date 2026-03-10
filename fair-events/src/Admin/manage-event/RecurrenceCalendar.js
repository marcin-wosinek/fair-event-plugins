/**
 * Recurrence Calendar Component
 *
 * Simple mini-calendar showing recurring event occurrences
 * with cancel/restore toggle for individual dates.
 *
 * @package FairEvents
 */

import { useState, useMemo } from '@wordpress/element';
import {
	Button,
	Card,
	CardHeader,
	CardBody,
	Tooltip,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import {
	formatLocalDate,
	getWeekdayLabels,
	calculateLeadingDays,
} from 'fair-events-shared';

export default function RecurrenceCalendar({
	generatedOccurrences,
	exdates,
	masterDate,
	manageEventUrl,
	onToggleExdate,
	togglingExdate,
}) {
	const occurrences = generatedOccurrences || [];
	const cancelledDates = exdates || [];

	// Build lookup maps
	const occurrenceByDate = useMemo(() => {
		const map = {};
		occurrences.forEach((occ) => {
			const date = occ.start_datetime.split(' ')[0];
			map[date] = occ;
		});
		return map;
	}, [occurrences]);

	const cancelledSet = useMemo(
		() => new Set(cancelledDates),
		[cancelledDates]
	);

	// Determine the date range to show
	const allDates = useMemo(() => {
		const dates = [];
		occurrences.forEach((occ) => {
			dates.push(occ.start_datetime.split(' ')[0]);
		});
		cancelledDates.forEach((d) => dates.push(d));
		if (masterDate) {
			dates.push(masterDate);
		}
		return dates.sort();
	}, [occurrences, cancelledDates, masterDate]);

	// Calculate which months to show
	const months = useMemo(() => {
		if (allDates.length === 0) return [];
		const first = new Date(allDates[0] + 'T00:00:00');
		const last = new Date(allDates[allDates.length - 1] + 'T00:00:00');
		const result = [];
		const current = new Date(first.getFullYear(), first.getMonth(), 1);
		const end = new Date(last.getFullYear(), last.getMonth(), 1);
		while (current <= end) {
			result.push(new Date(current));
			current.setMonth(current.getMonth() + 1);
		}
		return result;
	}, [allDates]);

	// Navigation state: show months in pages
	const [startIndex, setStartIndex] = useState(0);
	const visibleCount = 3;
	const visibleMonths = months.slice(startIndex, startIndex + visibleCount);
	const canGoBack = startIndex > 0;
	const canGoForward = startIndex + visibleCount < months.length;

	const weekdayLabels = useMemo(
		() => getWeekdayLabels(1, { weekday: 'narrow' }),
		[]
	);
	const todayStr = formatLocalDate(new Date());

	if (allDates.length === 0) return null;

	return (
		<Card style={{ marginTop: '16px' }}>
			<CardHeader>
				<HStack alignment="center">
					<h2 style={{ margin: 0, flex: 1 }}>
						{__('Recurring Occurrences', 'fair-events')}
					</h2>
					{months.length > visibleCount && (
						<HStack spacing={1}>
							<Button
								icon="arrow-left-alt2"
								size="small"
								disabled={!canGoBack}
								label={__('Previous months', 'fair-events')}
								onClick={() =>
									setStartIndex(
										Math.max(0, startIndex - visibleCount)
									)
								}
							/>
							<Button
								icon="arrow-right-alt2"
								size="small"
								disabled={!canGoForward}
								label={__('Next months', 'fair-events')}
								onClick={() =>
									setStartIndex(
										Math.min(
											months.length - 1,
											startIndex + visibleCount
										)
									)
								}
							/>
						</HStack>
					)}
				</HStack>
			</CardHeader>
			<CardBody>
				<div
					style={{
						display: 'flex',
						gap: '24px',
						flexWrap: 'wrap',
					}}
				>
					{visibleMonths.map((monthDate) => (
						<MiniMonth
							key={`${monthDate.getFullYear()}-${monthDate.getMonth()}`}
							monthDate={monthDate}
							weekdayLabels={weekdayLabels}
							occurrenceByDate={occurrenceByDate}
							cancelledSet={cancelledSet}
							masterDate={masterDate}
							todayStr={todayStr}
							manageEventUrl={manageEventUrl}
							onToggleExdate={onToggleExdate}
							togglingExdate={togglingExdate}
						/>
					))}
				</div>
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
			</CardBody>
		</Card>
	);
}

function MiniMonth({
	monthDate,
	weekdayLabels,
	occurrenceByDate,
	cancelledSet,
	masterDate,
	todayStr,
	manageEventUrl,
	onToggleExdate,
	togglingExdate,
}) {
	const year = monthDate.getFullYear();
	const month = monthDate.getMonth();
	const firstDay = new Date(year, month, 1);
	const daysInMonth = new Date(year, month + 1, 0).getDate();
	const leadingDays = calculateLeadingDays(firstDay, 1);

	const monthLabel = firstDay.toLocaleDateString(undefined, {
		year: 'numeric',
		month: 'long',
	});

	const cells = [];

	// Leading empty cells
	for (let i = 0; i < leadingDays; i++) {
		cells.push(<div key={`lead-${i}`} />);
	}

	for (let day = 1; day <= daysInMonth; day++) {
		const date = new Date(year, month, day);
		const dateStr = formatLocalDate(date);
		const isOccurrence = dateStr in occurrenceByDate;
		const isCancelled = cancelledSet.has(dateStr);
		const isMaster = dateStr === masterDate;
		const isToday = dateStr === todayStr;
		const occ = occurrenceByDate[dateStr];

		let bg = 'transparent';
		let color = '#1e1e1e';
		let opacity = 1;
		let cursor = 'default';
		let border = 'none';

		if (isMaster) {
			bg = '#007cba';
			color = '#fff';
		} else if (isCancelled) {
			bg = '#cc1818';
			color = '#fff';
			opacity = 0.6;
			cursor = 'pointer';
		} else if (isOccurrence) {
			bg = '#4ab866';
			color = '#fff';
			cursor = 'pointer';
		}

		if (isToday) {
			border = '2px solid #1e1e1e';
		}

		const cellStyle = {
			width: '28px',
			height: '28px',
			display: 'flex',
			alignItems: 'center',
			justifyContent: 'center',
			borderRadius: '4px',
			fontSize: '12px',
			fontWeight: isOccurrence || isCancelled || isMaster ? 600 : 400,
			background: bg,
			color,
			opacity,
			cursor,
			border,
			textDecoration: isCancelled ? 'line-through' : 'none',
			position: 'relative',
		};

		const isToggleable = (isOccurrence || isCancelled) && !isMaster;
		const isToggling = togglingExdate === dateStr;

		const cellContent = (
			<div
				key={dateStr}
				style={cellStyle}
				onClick={
					isToggleable && !isToggling
						? () => onToggleExdate(dateStr)
						: undefined
				}
				role={isToggleable ? 'button' : undefined}
				tabIndex={isToggleable ? 0 : undefined}
				onKeyDown={
					isToggleable && !isToggling
						? (e) => {
								if (e.key === 'Enter' || e.key === ' ') {
									e.preventDefault();
									onToggleExdate(dateStr);
								}
						  }
						: undefined
				}
			>
				{isToggling ? '…' : day}
			</div>
		);

		if (isMaster) {
			cells.push(
				<Tooltip key={dateStr} text={__('Master event', 'fair-events')}>
					<a
						href={`${manageEventUrl}`}
						style={{ textDecoration: 'none' }}
					>
						{cellContent}
					</a>
				</Tooltip>
			);
		} else if (isOccurrence) {
			cells.push(
				<Tooltip
					key={dateStr}
					text={__('Click to cancel this occurrence', 'fair-events')}
				>
					{cellContent}
				</Tooltip>
			);
		} else if (isCancelled) {
			cells.push(
				<Tooltip
					key={dateStr}
					text={__('Click to restore this occurrence', 'fair-events')}
				>
					{cellContent}
				</Tooltip>
			);
		} else {
			cells.push(
				<div key={dateStr} style={cellStyle}>
					{day}
				</div>
			);
		}
	}

	return (
		<div style={{ minWidth: '220px' }}>
			<div
				style={{
					fontWeight: 600,
					marginBottom: '8px',
					fontSize: '13px',
					textAlign: 'center',
				}}
			>
				{monthLabel}
			</div>
			<div
				style={{
					display: 'grid',
					gridTemplateColumns: 'repeat(7, 28px)',
					gap: '2px',
					justifyContent: 'center',
				}}
			>
				{weekdayLabels.map((label, i) => (
					<div
						key={i}
						style={{
							textAlign: 'center',
							fontSize: '11px',
							color: '#757575',
							fontWeight: 600,
							height: '20px',
							lineHeight: '20px',
						}}
					>
						{label}
					</div>
				))}
				{cells}
			</div>
		</div>
	);
}
