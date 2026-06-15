import { useState, useEffect, useMemo } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Notice,
	Spinner,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import {
	ResponsiveContainer,
	BarChart,
	Bar,
	XAxis,
	YAxis,
	Tooltip,
	CartesianGrid,
} from 'recharts';

const MS_PER_DAY = 1000 * 60 * 60 * 24;
const BAR_COLOR = '#3858e9'; // WordPress admin blue.

// WordPress stores datetimes as "YYYY-MM-DD HH:MM:SS"; Safari/strict parsers
// reject the space, so normalise it to an ISO-ish "T" before constructing Date.
function parseDate(value) {
	if (!value) return NaN;
	return new Date(String(value).replace(' ', 'T')).getTime();
}

// People per activity: one row per distinct ticket option, counting how many
// confirmed participants picked it. ticket_option_ids / ticket_option_names are
// parallel arrays on each participant row. Sorted by count descending.
export function peoplePerActivity(participants) {
	const counts = new Map();
	participants.forEach((p) => {
		const ids = Array.isArray(p.ticket_option_ids)
			? p.ticket_option_ids
			: [];
		const names = Array.isArray(p.ticket_option_names)
			? p.ticket_option_names
			: [];
		ids.forEach((id, i) => {
			const name = names[i] || `#${id}`;
			counts.set(name, (counts.get(name) || 0) + 1);
		});
	});
	return Array.from(counts.entries())
		.map(([name, count]) => ({ name, count }))
		.sort((a, b) => b.count - a.count);
}

// Activities-per-person histogram: how many people picked 0 activities, 1, 2, …
// The range is filled continuously from the smallest to the largest observed
// count so the histogram has no gaps.
export function activityCountDistribution(participants) {
	const buckets = new Map();
	participants.forEach((p) => {
		const n = Array.isArray(p.ticket_option_ids)
			? p.ticket_option_ids.length
			: 0;
		buckets.set(n, (buckets.get(n) || 0) + 1);
	});
	if (!buckets.size) return [];
	const keys = Array.from(buckets.keys());
	const min = Math.min(...keys);
	const max = Math.max(...keys);
	const result = [];
	for (let i = min; i <= max; i++) {
		result.push({ activities: i, people: buckets.get(i) || 0 });
	}
	return result;
}

// Sales lead time: confirmed tickets bucketed per day by how many days before
// the event they were created. Returned furthest-out first (descending daysOut)
// with a continuous day range so the axis reads as a timeline toward the event.
export function salesLeadTime(participants, eventDate) {
	const eventTime = parseDate(eventDate);
	if (Number.isNaN(eventTime)) return [];
	const buckets = new Map();
	participants.forEach((p) => {
		const createdTime = parseDate(p.created_at);
		if (Number.isNaN(createdTime)) return;
		const daysOut = Math.max(
			0,
			Math.floor((eventTime - createdTime) / MS_PER_DAY)
		);
		buckets.set(daysOut, (buckets.get(daysOut) || 0) + 1);
	});
	if (!buckets.size) return [];
	const max = Math.max(...buckets.keys());
	const result = [];
	for (let d = max; d >= 0; d--) {
		result.push({ daysOut: d, count: buckets.get(d) || 0 });
	}
	return result;
}

function ChartCard({ title, children }) {
	return (
		<Card style={{ marginTop: '16px' }}>
			<CardHeader>
				<h3 style={{ margin: 0 }}>{title}</h3>
			</CardHeader>
			<CardBody>{children}</CardBody>
		</Card>
	);
}

export default function EventStatistics({ eventDateId }) {
	const [participants, setParticipants] = useState([]);
	const [eventDate, setEventDate] = useState(null);
	const [loading, setLoading] = useState(true);

	useEffect(() => {
		if (!eventDateId) {
			setLoading(false);
			return;
		}
		setLoading(true);
		Promise.all([
			apiFetch({
				path: `/fair-audience/v1/event-dates/${eventDateId}/participants`,
			}).catch(() => []),
			apiFetch({
				path: `/fair-audience/v1/event-dates/${eventDateId}`,
			}).catch(() => null),
		])
			.then(([participantData, eventInfo]) => {
				setParticipants(
					Array.isArray(participantData) ? participantData : []
				);
				setEventDate(eventInfo?.event_date || null);
			})
			.finally(() => setLoading(false));
	}, [eventDateId]);

	const confirmed = useMemo(
		() => participants.filter((p) => p.label === 'signed_up'),
		[participants]
	);
	const excludedCount = participants.length - confirmed.length;

	const activityData = useMemo(
		() => peoplePerActivity(confirmed),
		[confirmed]
	);
	const distributionData = useMemo(
		() => activityCountDistribution(confirmed),
		[confirmed]
	);
	const leadTimeData = useMemo(
		() => salesLeadTime(confirmed, eventDate),
		[confirmed, eventDate]
	);

	if (loading) {
		return (
			<div style={{ padding: '24px', textAlign: 'center' }}>
				<Spinner />
			</div>
		);
	}

	if (confirmed.length === 0) {
		return (
			<Notice status="info" isDismissible={false}>
				{__(
					'No confirmed participants yet. Statistics appear once people sign up.',
					'fair-events-experimental'
				)}
			</Notice>
		);
	}

	return (
		<div>
			<Notice status="info" isDismissible={false}>
				{sprintf(
					/* translators: %d: number of excluded participant rows. */
					__(
						'Confirmed participants only (signed up). %d excluded (pending payment, interested, collaborators).',
						'fair-events-experimental'
					),
					excludedCount
				)}
			</Notice>

			<ChartCard
				title={__('People per activity', 'fair-events-experimental')}
			>
				{activityData.length === 0 ? (
					<p>
						{__(
							'No activities recorded for confirmed participants.',
							'fair-events-experimental'
						)}
					</p>
				) : (
					<ResponsiveContainer
						width="100%"
						height={Math.max(120, activityData.length * 44)}
					>
						<BarChart
							data={activityData}
							layout="vertical"
							margin={{ left: 24, right: 24 }}
						>
							<CartesianGrid strokeDasharray="3 3" />
							<XAxis type="number" allowDecimals={false} />
							<YAxis type="category" dataKey="name" width={160} />
							<Tooltip />
							<Bar
								dataKey="count"
								name={__('People', 'fair-events-experimental')}
								fill={BAR_COLOR}
							/>
						</BarChart>
					</ResponsiveContainer>
				)}
			</ChartCard>

			<ChartCard
				title={__('Activities per person', 'fair-events-experimental')}
			>
				<ResponsiveContainer width="100%" height={280}>
					<BarChart
						data={distributionData}
						margin={{ left: 8, right: 24 }}
					>
						<CartesianGrid strokeDasharray="3 3" />
						<XAxis
							dataKey="activities"
							allowDecimals={false}
							label={{
								value: __(
									'Activities',
									'fair-events-experimental'
								),
								position: 'insideBottom',
								offset: -4,
							}}
						/>
						<YAxis allowDecimals={false} />
						<Tooltip />
						<Bar
							dataKey="people"
							name={__('People', 'fair-events-experimental')}
							fill={BAR_COLOR}
						/>
					</BarChart>
				</ResponsiveContainer>
			</ChartCard>

			<ChartCard
				title={__('Sales lead time', 'fair-events-experimental')}
			>
				{leadTimeData.length === 0 ? (
					<p>
						{__(
							'Lead time is unavailable (missing event date or signup timestamps).',
							'fair-events-experimental'
						)}
					</p>
				) : (
					<ResponsiveContainer width="100%" height={280}>
						<BarChart
							data={leadTimeData}
							margin={{ left: 8, right: 24 }}
						>
							<CartesianGrid strokeDasharray="3 3" />
							<XAxis
								dataKey="daysOut"
								allowDecimals={false}
								reversed
								label={{
									value: __(
										'Days before event',
										'fair-events-experimental'
									),
									position: 'insideBottom',
									offset: -4,
								}}
							/>
							<YAxis allowDecimals={false} />
							<Tooltip />
							<Bar
								dataKey="count"
								name={__('Tickets', 'fair-events-experimental')}
								fill={BAR_COLOR}
							/>
						</BarChart>
					</ResponsiveContainer>
				)}
			</ChartCard>
		</div>
	);
}
