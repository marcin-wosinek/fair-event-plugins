/**
 * WordPress dependencies
 */
import { __ } from '@wordpress/i18n';
import { useState, useEffect, useCallback } from '@wordpress/element';
import { Button, SelectControl, Spinner, Notice } from '@wordpress/components';
import apiFetch from '@wordpress/api-fetch';

/**
 * Get current ISO week string.
 *
 * @return {string} ISO week string e.g. "2026-W07"
 */
function getCurrentWeek() {
	const now = new Date();
	const jan4 = new Date(now.getFullYear(), 0, 4);
	const dayOfYear =
		Math.floor((now - new Date(now.getFullYear(), 0, 1)) / 86400000) + 1;
	const weekNum = Math.ceil((dayOfYear + jan4.getDay() - 1) / 7);
	const year = now.getFullYear();
	return `${year}-W${String(weekNum).padStart(2, '0')}`;
}

/**
 * Offset an ISO week string by a number of weeks.
 *
 * @param {string} weekStr ISO week string.
 * @param {number} offset  Weeks to offset.
 * @return {string} New ISO week string.
 */
function offsetWeek(weekStr, offset) {
	const match = weekStr.match(/^(\d{4})-W(\d{2})$/);
	if (!match) {
		return weekStr;
	}
	const date = new Date();
	date.setFullYear(parseInt(match[1], 10));
	// Set to Monday of the given ISO week
	const jan4 = new Date(date.getFullYear(), 0, 4);
	const dayOfWeek = jan4.getDay() || 7;
	const firstMonday = new Date(jan4);
	firstMonday.setDate(jan4.getDate() - dayOfWeek + 1);
	const targetDate = new Date(firstMonday);
	targetDate.setDate(
		firstMonday.getDate() + (parseInt(match[2], 10) - 1) * 7
	);
	targetDate.setDate(targetDate.getDate() + offset * 7);

	// Calculate ISO week of the target date
	const thursday = new Date(targetDate);
	thursday.setDate(targetDate.getDate() + (4 - (targetDate.getDay() || 7)));
	const yearStart = new Date(thursday.getFullYear(), 0, 1);
	const weekNo = Math.ceil(
		((thursday - yearStart) / 86400000 + yearStart.getDay() + 1) / 7
	);
	// ISO year is based on the Thursday
	const isoYear = thursday.getFullYear();
	return `${isoYear}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Generate WhatsApp-formatted message from weekly events data.
 *
 * @param {Object} data API response data.
 * @return {string} Formatted message text.
 */
function generateMessage(data) {
	if (!data || !data.days) {
		return '';
	}

	const { source, week, days } = data;

	// Find the range of days with month name
	const firstDay = days[0];
	const lastDay = days[days.length - 1];
	const monthName = firstDay.month_name;

	const header = `Agenda de ${source.name}, ${firstDay.day_num}\u2013${lastDay.day_num} de ${monthName}:`;

	const lines = [header];

	for (const day of days) {
		for (const event of day.events) {
			let timeStr = '';
			if (!event.all_day) {
				if (event.end_time && event.end_time !== event.start_time) {
					timeStr = `${event.start_time}-${event.end_time}`;
				} else if (event.start_time) {
					timeStr = event.start_time;
				}
			}

			const parts = [`* ${day.weekday}`];
			if (timeStr) {
				parts[0] += `, ${timeStr}`;
			}
			parts[0] += `, ${event.title}`;
			if (event.url) {
				parts[0] += `: ${event.url}`;
			}

			lines.push(parts[0]);
		}
	}

	return lines.join('\n');
}

/**
 * WeeklySchedule admin page component.
 *
 * @return {JSX.Element} Weekly schedule page.
 */
export default function WeeklySchedule() {
	const [sources, setSources] = useState([]);
	const [selectedSource, setSelectedSource] = useState('');
	const [currentWeek, setCurrentWeek] = useState(getCurrentWeek());
	const [data, setData] = useState(null);
	const [loading, setLoading] = useState(false);
	const [sourcesLoading, setSourcesLoading] = useState(true);
	const [error, setError] = useState(null);
	const [message, setMessage] = useState('');
	const [copied, setCopied] = useState(false);

	// Fetch event sources on mount.
	useEffect(() => {
		apiFetch({ path: '/fair-events/v1/sources?enabled_only=true' })
			.then((result) => {
				setSources(result);
				setSourcesLoading(false);
			})
			.catch(() => {
				setSourcesLoading(false);
			});
	}, []);

	// Fetch weekly events when source or week changes.
	const fetchEvents = useCallback(() => {
		if (!selectedSource) {
			setData(null);
			setMessage('');
			return;
		}

		setLoading(true);
		setError(null);

		apiFetch({
			path: `/fair-events/v1/weekly-events?source=${encodeURIComponent(
				selectedSource
			)}&week=${encodeURIComponent(currentWeek)}`,
		})
			.then((result) => {
				setData(result);
				setMessage(generateMessage(result));
				setLoading(false);
			})
			.catch((err) => {
				setError(
					err.message ||
						__('Failed to fetch events.', 'fair-audience')
				);
				setLoading(false);
			});
	}, [selectedSource, currentWeek]);

	useEffect(() => {
		fetchEvents();
	}, [fetchEvents]);

	const handleCopy = () => {
		navigator.clipboard.writeText(message).then(() => {
			setCopied(true);
			setTimeout(() => setCopied(false), 2000);
		});
	};

	const sourceOptions = [
		{ label: __('— Select source —', 'fair-audience'), value: '' },
		...sources.map((s) => ({ label: s.name, value: s.slug })),
	];

	return (
		<div className="wrap">
			<h1>{__('Weekly Schedule', 'fair-audience')}</h1>

			<div
				style={{
					display: 'flex',
					alignItems: 'flex-end',
					gap: '16px',
					marginBottom: '20px',
					flexWrap: 'wrap',
				}}
			>
				<div style={{ minWidth: '250px' }}>
					{sourcesLoading ? (
						<Spinner />
					) : (
						<SelectControl
							label={__('Event Source', 'fair-audience')}
							value={selectedSource}
							options={sourceOptions}
							onChange={setSelectedSource}
						/>
					)}
				</div>

				<div
					style={{
						display: 'flex',
						alignItems: 'center',
						gap: '8px',
					}}
				>
					<Button
						variant="secondary"
						onClick={() =>
							setCurrentWeek(offsetWeek(currentWeek, -1))
						}
						aria-label={__('Previous week', 'fair-audience')}
					>
						&larr;
					</Button>
					<span
						style={{
							fontWeight: 'bold',
							minWidth: '100px',
							textAlign: 'center',
						}}
					>
						{currentWeek}
					</span>
					<Button
						variant="secondary"
						onClick={() =>
							setCurrentWeek(offsetWeek(currentWeek, 1))
						}
						aria-label={__('Next week', 'fair-audience')}
					>
						&rarr;
					</Button>
					<Button
						variant="tertiary"
						onClick={() => setCurrentWeek(getCurrentWeek())}
					>
						{__('Today', 'fair-audience')}
					</Button>
				</div>
			</div>

			{error && (
				<Notice status="error" isDismissible={false}>
					{error}
				</Notice>
			)}

			{loading && (
				<div style={{ textAlign: 'center', padding: '40px' }}>
					<Spinner />
				</div>
			)}

			{!loading && data && (
				<>
					<div
						style={{
							display: 'grid',
							gridTemplateColumns: 'repeat(7, 1fr)',
							marginBottom: '24px',
						}}
					>
						{data.days.map((day, idx) => (
							<div
								key={day.date}
								style={{
									backgroundColor: '#fff',
									minHeight: '120px',
									border: '1px solid #ddd',
									borderLeft:
										idx === 0 ? '1px solid #ddd' : 'none',
								}}
							>
								<div
									style={{
										padding: '8px',
										backgroundColor: '#f0f0f0',
										borderBottom: '1px solid #ddd',
										fontWeight: 'bold',
										fontSize: '13px',
									}}
								>
									{day.weekday}
									<span
										style={{
											float: 'right',
											fontWeight: 'normal',
										}}
									>
										{day.day_num}
									</span>
								</div>
								<div style={{ padding: '4px' }}>
									{day.events.map((event, idx) => (
										<div
											key={idx}
											style={{
												padding: '4px 6px',
												marginBottom: '2px',
												fontSize: '12px',
												backgroundColor: '#e8f0fe',
												borderRadius: '3px',
												lineHeight: '1.3',
												display: 'flex',
												alignItems: 'center',
												gap: '4px',
											}}
										>
											<span
												style={{
													flex: 1,
													minWidth: 0,
												}}
											>
												{!event.all_day &&
													event.start_time && (
														<strong
															style={{
																marginRight:
																	'4px',
															}}
														>
															{event.start_time}
														</strong>
													)}
												{event.url ? (
													<a
														href={event.url}
														target="_blank"
														rel="noopener noreferrer"
													>
														{event.title}
													</a>
												) : (
													event.title
												)}
											</span>
											{event.event_id &&
												window
													.fairAudienceWeeklyScheduleData
													?.participantsUrl && (
													<a
														href={`${window.fairAudienceWeeklyScheduleData.participantsUrl}${event.event_id}`}
														title={__(
															'View Participants',
															'fair-audience'
														)}
														style={{
															color: '#2271b1',
															textDecoration:
																'none',
															flexShrink: 0,
														}}
													>
														<span className="dashicons dashicons-groups" />
													</a>
												)}
										</div>
									))}
								</div>
							</div>
						))}
					</div>

					<div style={{ maxWidth: '800px' }}>
						<h2>{__('WhatsApp Message', 'fair-audience')}</h2>
						<textarea
							value={message}
							onChange={(e) => setMessage(e.target.value)}
							rows={Math.max(10, message.split('\n').length + 2)}
							style={{
								width: '100%',
								fontFamily: 'monospace',
								fontSize: '13px',
								padding: '12px',
							}}
						/>
						<div style={{ marginTop: '8px' }}>
							<Button variant="primary" onClick={handleCopy}>
								{copied
									? __('Copied!', 'fair-audience')
									: __('Copy to clipboard', 'fair-audience')}
							</Button>
						</div>
					</div>
				</>
			)}
		</div>
	);
}
