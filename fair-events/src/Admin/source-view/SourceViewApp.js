/**
 * Source View App - Main Component
 *
 * @package FairEvents
 */

import { useState, useEffect, useCallback } from '@wordpress/element';
import {
	Button,
	Modal,
	Spinner,
	Notice,
	__experimentalHStack as HStack,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';
import { formatLocalDate, calculateLeadingDays } from 'fair-events-shared';
import CalendarHeader from '../calendar/components/CalendarHeader.js';
import CalendarGrid from '../calendar/components/CalendarGrid.js';
import CopyUrlButton from '../components/CopyUrlButton.js';
import SourceForm from '../sources/components/SourceForm.js';

const {
	sourceId,
	startOfWeek,
	sourcesListUrl,
	icalUrlTemplate,
	jsonUrlTemplate,
} = window.fairEventsSourceViewData || {};

export default function SourceViewApp() {
	const [source, setSource] = useState(null);
	const [events, setEvents] = useState([]);
	const [currentDate, setCurrentDate] = useState(new Date());
	const [loading, setLoading] = useState(true);
	const [eventsLoading, setEventsLoading] = useState(false);
	const [error, setError] = useState(null);
	const [isEditOpen, setIsEditOpen] = useState(false);

	const fetchSource = useCallback(async () => {
		try {
			const data = await apiFetch({
				path: `/fair-events/v1/sources/${sourceId}`,
			});
			setSource(data);
		} catch (err) {
			setError(
				err.message || __('Failed to load source.', 'fair-events')
			);
		} finally {
			setLoading(false);
		}
	}, []);

	// Fetch source details on mount.
	useEffect(() => {
		if (!sourceId) {
			setError(__('No source ID provided.', 'fair-events'));
			setLoading(false);
			return;
		}

		fetchSource();
	}, [fetchSource]);

	// Fetch events for current month
	const fetchEvents = useCallback(async () => {
		if (!source) return;

		setEventsLoading(true);

		const year = currentDate.getFullYear();
		const month = currentDate.getMonth();

		const firstDayOfMonth = new Date(year, month, 1);
		const lastDayOfMonth = new Date(year, month + 1, 0);

		const sow = startOfWeek ?? 1;
		const leadingDays = calculateLeadingDays(firstDayOfMonth, sow);

		const totalCells = leadingDays + lastDayOfMonth.getDate();
		const trailingDays = totalCells % 7 === 0 ? 0 : 7 - (totalCells % 7);

		const startDate = new Date(firstDayOfMonth);
		startDate.setDate(startDate.getDate() - leadingDays);

		const endDate = new Date(lastDayOfMonth);
		endDate.setDate(endDate.getDate() + trailingDays);

		try {
			const response = await apiFetch({
				path: `/fair-events/v1/sources/${
					source.slug
				}/json?start_date=${formatLocalDate(
					startDate
				)}&end_date=${formatLocalDate(endDate)}`,
			});
			setEvents(response.events || []);
		} catch (err) {
			setEvents([]);
		} finally {
			setEventsLoading(false);
		}
	}, [source, currentDate]);

	useEffect(() => {
		fetchEvents();
	}, [fetchEvents]);

	const handlePrevMonth = () => {
		setCurrentDate(
			new Date(currentDate.getFullYear(), currentDate.getMonth() - 1, 1)
		);
	};

	const handleNextMonth = () => {
		setCurrentDate(
			new Date(currentDate.getFullYear(), currentDate.getMonth() + 1, 1)
		);
	};

	const handleToday = () => {
		setCurrentDate(new Date());
	};

	const getIcalUrl = (slug) => {
		const template =
			icalUrlTemplate || '/wp-json/fair-events/v1/sources/{slug}/ical';
		return template.replace('{slug}', slug);
	};

	const getJsonUrl = (slug) => {
		const template =
			jsonUrlTemplate || '/wp-json/fair-events/v1/sources/{slug}/json';
		return template.replace('{slug}', slug);
	};

	const handleEditSuccess = () => {
		setIsEditOpen(false);
		fetchSource();
		fetchEvents();
	};

	if (loading) {
		return (
			<div className="wrap">
				<Spinner />
			</div>
		);
	}

	if (error) {
		return (
			<div className="wrap">
				<p>
					<a href={sourcesListUrl}>
						&larr; {__('Back to Event Sources', 'fair-events')}
					</a>
				</p>
				<Notice status="error" isDismissible={false}>
					{error}
				</Notice>
			</div>
		);
	}

	return (
		<div className="wrap fair-events-calendar-wrap">
			<p>
				<a href={sourcesListUrl}>
					&larr; {__('Back to Event Sources', 'fair-events')}
				</a>
			</p>

			<h1>
				{sprintf(
					/* translators: %s: source name */
					__('Source: %s', 'fair-events'),
					source.name
				)}
			</h1>

			<div
				className="fair-events-source-info"
				style={{
					background: '#fff',
					border: '1px solid #c3c4c7',
					padding: '16px',
					marginBottom: '20px',
				}}
			>
				<HStack spacing={6} wrap>
					<VStack spacing={1}>
						<strong>{__('Slug', 'fair-events')}</strong>
						<code>{source.slug}</code>
					</VStack>
					<VStack spacing={1}>
						<strong>{__('Status', 'fair-events')}</strong>
						<span>
							{source.enabled
								? __('Enabled', 'fair-events')
								: __('Disabled', 'fair-events')}
						</span>
					</VStack>
					<VStack spacing={1}>
						<strong>{__('Data Sources', 'fair-events')}</strong>
						<span>
							{source.data_sources?.length || 0}{' '}
							{__('data source(s)', 'fair-events')}
						</span>
					</VStack>
					<VStack spacing={1}>
						<strong>{__('Feed URLs', 'fair-events')}</strong>
						<HStack spacing={2}>
							<CopyUrlButton
								url={getIcalUrl(source.slug)}
								label={__('iCal', 'fair-events')}
								tooltip={__(
									'Copy iCal feed URL',
									'fair-events'
								)}
							/>
							<CopyUrlButton
								url={getJsonUrl(source.slug)}
								label={__('JSON', 'fair-events')}
								tooltip={__('Copy JSON API URL', 'fair-events')}
							/>
						</HStack>
					</VStack>
					<VStack spacing={1}>
						<Button
							variant="secondary"
							onClick={() => setIsEditOpen(true)}
						>
							{__('Edit Source', 'fair-events')}
						</Button>
					</VStack>
				</HStack>
				<Button
					variant="secondary"
					size="small"
					onClick={() => setIsEditOpen(true)}
					style={{ alignSelf: 'flex-start', marginTop: '8px' }}
				>
					{__('Edit Source', 'fair-events')}
				</Button>
			</div>

			<CalendarHeader
				currentDate={currentDate}
				onPrevMonth={handlePrevMonth}
				onNextMonth={handleNextMonth}
				onToday={handleToday}
			/>

			{eventsLoading ? (
				<div className="fair-events-calendar-loading">
					<Spinner />
				</div>
			) : (
				<CalendarGrid
					currentDate={currentDate}
					events={events}
					startOfWeek={startOfWeek}
				/>
			)}

			{isEditOpen && (
				<Modal
					title={__('Edit Event Source', 'fair-events')}
					onRequestClose={() => setIsEditOpen(false)}
					style={{ maxWidth: '800px' }}
				>
					<SourceForm
						source={source}
						onSuccess={handleEditSuccess}
						onCancel={() => setIsEditOpen(false)}
					/>
				</Modal>
			)}
		</div>
	);
}
