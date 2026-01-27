import { __ } from '@wordpress/i18n';
import { useState, useEffect, useCallback, useMemo } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { Card, CardBody } from '@wordpress/components';
import { DataViews } from '@wordpress/dataviews';
import { dateI18n, getSettings } from '@wordpress/date';

const DEFAULT_VIEW = {
	type: 'table',
	perPage: 25,
	page: 1,
	sort: {
		field: 'event_date',
		direction: 'desc',
	},
	search: '',
	filters: [],
	fields: ['title', 'event_date', 'participants', 'images', 'likes'],
};

const DEFAULT_LAYOUTS = {
	table: {},
};

export default function EventsList() {
	const [events, setEvents] = useState([]);
	const [totalItems, setTotalItems] = useState(0);
	const [totalPages, setTotalPages] = useState(0);
	const [isLoading, setIsLoading] = useState(true);
	const [view, setView] = useState(DEFAULT_VIEW);

	// Define fields configuration for DataViews.
	const fields = useMemo(
		() => [
			{
				id: 'title',
				label: __('Event', 'fair-audience'),
				render: ({ item }) => (
					<a
						href={`admin.php?page=fair-audience-event-participants&event_id=${item.event_id}`}
					>
						{item.title}
					</a>
				),
				enableSorting: true,
				enableHiding: false,
				getValue: ({ item }) => item.title.toLowerCase(),
			},
			{
				id: 'event_date',
				label: __('Date', 'fair-audience'),
				render: ({ item }) => {
					if (!item.event_date) {
						return '—';
					}
					const { formats } = getSettings();
					return dateI18n(formats.datetime, item.event_date);
				},
				enableSorting: true,
				getValue: ({ item }) => item.event_date || '',
			},
			{
				id: 'participants',
				label: __('Participants', 'fair-audience'),
				render: ({ item }) => (
					<div style={{ textAlign: 'right' }}>
						{item.participants || 0}
					</div>
				),
				enableSorting: true,
				getValue: ({ item }) => item.participants || 0,
			},
			{
				id: 'images',
				label: __('Images', 'fair-audience'),
				render: ({ item }) => (
					<div style={{ textAlign: 'right' }}>
						<a
							href={`upload.php?mode=list&fair_event_filter=${item.event_id}`}
						>
							{item.gallery_count || 0}
						</a>
					</div>
				),
				enableSorting: true,
				getValue: ({ item }) => item.gallery_count || 0,
			},
			{
				id: 'likes',
				label: __('Likes', 'fair-audience'),
				render: ({ item }) => (
					<div style={{ textAlign: 'right' }}>
						{item.likes_count || 0}
					</div>
				),
				enableSorting: true,
				getValue: ({ item }) => item.likes_count || 0,
			},
		],
		[]
	);

	// Define actions for DataViews.
	const actions = useMemo(
		() => [
			{
				id: 'edit',
				label: __('Edit Event', 'fair-audience'),
				callback: ([item]) => {
					window.location.href = `post.php?post=${item.event_id}&action=edit`;
				},
			},
			{
				id: 'view',
				label: __('View Event', 'fair-audience'),
				callback: ([item]) => {
					window.open(item.link, '_blank');
				},
			},
		],
		[]
	);

	// Convert view state to API query params.
	const queryArgs = useMemo(() => {
		const params = new URLSearchParams();

		if (view.search) {
			params.append('search', view.search);
		}

		if (view.sort?.field) {
			params.append('orderby', view.sort.field);
			params.append('order', view.sort.direction || 'desc');
		}

		// Pagination.
		if (view.perPage) {
			params.append('per_page', view.perPage);
		}
		if (view.page) {
			params.append('page', view.page);
		}

		return params.toString();
	}, [view]);

	const loadEvents = useCallback(() => {
		setIsLoading(true);

		const path = `/fair-audience/v1/events${queryArgs ? '?' + queryArgs : ''}`;

		apiFetch({ path, parse: false })
			.then((response) => {
				const total = parseInt(
					response.headers.get('X-WP-Total') || '0',
					10
				);
				const pages = parseInt(
					response.headers.get('X-WP-TotalPages') || '1',
					10
				);
				setTotalItems(total);
				setTotalPages(pages);
				return response.json();
			})
			.then((data) => {
				setEvents(data);
				setIsLoading(false);
			})
			.catch((err) => {
				// eslint-disable-next-line no-console
				console.error('Error loading events:', err);
				setIsLoading(false);
			});
	}, [queryArgs]);

	useEffect(() => {
		loadEvents();
	}, [loadEvents]);

	const paginationInfo = useMemo(
		() => ({
			totalItems,
			totalPages,
		}),
		[totalItems, totalPages]
	);

	return (
		<div className="wrap">
			<h1>{__('Events', 'fair-audience')}</h1>

			<Card>
				<CardBody>
					<DataViews
						data={events}
						fields={fields}
						view={view}
						onChangeView={setView}
						actions={actions}
						paginationInfo={paginationInfo}
						defaultLayouts={DEFAULT_LAYOUTS}
						isLoading={isLoading}
						getItemId={(item) => item.event_id}
					/>
				</CardBody>
			</Card>
		</div>
	);
}
