import { __ } from '@wordpress/i18n';
import { useState, useEffect, useCallback, useMemo } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { Card, CardBody } from '@wordpress/components';
import { DataViews } from '@wordpress/dataviews';
import { dateI18n, getSettings } from '@wordpress/date';

const { manageEventUrl } = window.fairEventsAllEventsData || {};

const LINK_TYPE_OPTIONS = [
	{ value: 'post', label: __('Post', 'fair-events') },
	{ value: 'external', label: __('External', 'fair-events') },
	{ value: 'none', label: __('None', 'fair-events') },
];

const OCCURRENCE_TYPE_OPTIONS = [
	{ value: 'single', label: __('Single', 'fair-events') },
	{ value: 'master', label: __('Master', 'fair-events') },
	{ value: 'generated', label: __('Generated', 'fair-events') },
];

const DEFAULT_VIEW = {
	type: 'table',
	perPage: 25,
	page: 1,
	sort: {
		field: 'start_datetime',
		direction: 'desc',
	},
	search: '',
	filters: [],
	fields: [
		'title',
		'start_datetime',
		'categories',
		'link_type',
		'linked_post',
		'occurrence_type',
	],
};

const DEFAULT_LAYOUTS = {
	table: {},
};

function getLinkTypeLabel(value) {
	const option = LINK_TYPE_OPTIONS.find((o) => o.value === value);
	return option ? option.label : value;
}

function getOccurrenceTypeLabel(value) {
	const option = OCCURRENCE_TYPE_OPTIONS.find((o) => o.value === value);
	return option ? option.label : value;
}

export default function AllEvents() {
	const [events, setEvents] = useState([]);
	const [totalItems, setTotalItems] = useState(0);
	const [totalPages, setTotalPages] = useState(0);
	const [isLoading, setIsLoading] = useState(true);
	const [view, setView] = useState(DEFAULT_VIEW);

	const fields = useMemo(
		() => [
			{
				id: 'title',
				label: __('Name', 'fair-events'),
				render: ({ item }) => (
					<a href={`${manageEventUrl}&event_date_id=${item.id}`}>
						{item.title}
					</a>
				),
				enableSorting: true,
				enableHiding: false,
				getValue: ({ item }) => item.title.toLowerCase(),
			},
			{
				id: 'start_datetime',
				label: __('Date', 'fair-events'),
				render: ({ item }) => {
					if (!item.start_datetime) {
						return '—';
					}
					const { formats } = getSettings();
					return dateI18n(formats.datetime, item.start_datetime);
				},
				enableSorting: true,
				getValue: ({ item }) => item.start_datetime || '',
			},
			{
				id: 'categories',
				label: __('Categories', 'fair-events'),
				render: ({ item }) => {
					if (!item.categories || item.categories.length === 0) {
						return '—';
					}
					return item.categories.map((c) => c.name).join(', ');
				},
				enableSorting: false,
			},
			{
				id: 'link_type',
				label: __('Link Type', 'fair-events'),
				render: ({ item }) => getLinkTypeLabel(item.link_type),
				enableSorting: true,
				getValue: ({ item }) => item.link_type,
				elements: LINK_TYPE_OPTIONS,
				filterBy: {
					operators: ['is'],
				},
			},
			{
				id: 'linked_post',
				label: __('Linked Post / URL', 'fair-events'),
				render: ({ item }) => {
					if (item.post && item.post.edit_url) {
						return (
							<a href={item.post.edit_url}>
								{item.post.title}{' '}
								<small>({item.post.status})</small>
							</a>
						);
					}
					if (item.link_type === 'external' && item.external_url) {
						return (
							<a
								href={item.external_url}
								target="_blank"
								rel="noopener noreferrer"
							>
								{item.external_url}
							</a>
						);
					}
					return '—';
				},
				enableSorting: false,
			},
			{
				id: 'occurrence_type',
				label: __('Occurrence', 'fair-events'),
				render: ({ item }) =>
					getOccurrenceTypeLabel(item.occurrence_type),
				enableSorting: true,
				getValue: ({ item }) => item.occurrence_type,
				elements: OCCURRENCE_TYPE_OPTIONS,
				filterBy: {
					operators: ['is'],
				},
			},
		],
		[]
	);

	const queryArgs = useMemo(() => {
		const params = new URLSearchParams();

		if (view.search) {
			params.append('search', view.search);
		}

		if (view.sort?.field) {
			params.append('orderby', view.sort.field);
			params.append('order', view.sort.direction || 'desc');
		}

		if (view.perPage) {
			params.append('per_page', view.perPage);
		}
		if (view.page) {
			params.append('page', view.page);
		}

		// Apply filters.
		if (view.filters) {
			for (const filter of view.filters) {
				if (filter.field === 'link_type' && filter.value) {
					params.append('link_type', filter.value);
				}
				if (filter.field === 'occurrence_type' && filter.value) {
					params.append('occurrence_type', filter.value);
				}
			}
		}

		return params.toString();
	}, [view]);

	const loadEvents = useCallback(() => {
		setIsLoading(true);

		const path = `/fair-events/v1/event-dates/all${
			queryArgs ? '?' + queryArgs : ''
		}`;

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
			<h1>{__('All Events', 'fair-events')}</h1>

			<Card>
				<CardBody>
					<DataViews
						data={events}
						fields={fields}
						view={view}
						onChangeView={setView}
						paginationInfo={paginationInfo}
						defaultLayouts={DEFAULT_LAYOUTS}
						isLoading={isLoading}
						getItemId={(item) => item.id}
					/>
				</CardBody>
			</Card>
		</div>
	);
}
