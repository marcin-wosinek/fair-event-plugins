import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useCallback, useMemo } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { Button, Card, CardBody } from '@wordpress/components';
import { DataViews } from '@wordpress/dataviews';
import { chevronRight, chevronDown } from '@wordpress/icons';
import {
	formatSiteLocalDatetime,
	getEventDisplayTitle,
} from 'fair-events-shared';

const { manageEventUrl } = window.fairEventsAllEventsData || {};

const LINK_TYPE_OPTIONS = [
	{ value: 'post', label: __('Page', 'fair-events') },
	{ value: 'external', label: __('External', 'fair-events') },
	{ value: 'none', label: __('None', 'fair-events') },
];

const OCCURRENCE_TYPE_OPTIONS = [
	{ value: 'single', label: __('Single date', 'fair-events') },
	{ value: 'master', label: __('Series', 'fair-events') },
	{ value: 'generated', label: __('Series date', 'fair-events') },
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
	showLevels: true,
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
	const [expanded, setExpanded] = useState(() => new Set());

	const toggleExpanded = useCallback((masterId) => {
		setExpanded((prev) => {
			const next = new Set(prev);
			if (next.has(masterId)) {
				next.delete(masterId);
			} else {
				next.add(masterId);
			}
			return next;
		});
	}, []);

	const fields = useMemo(
		() => [
			{
				id: 'title',
				label: __('Name', 'fair-events'),
				render: ({ item }) => {
					if (
						item.occurrence_type === 'generated' &&
						item.master_id
					) {
						const label = item.start_datetime
							? formatSiteLocalDatetime(item.start_datetime)
							: getEventDisplayTitle(item.title);
						if (item.status === 'cancelled') {
							return (
								<span className="fair-events-all-events__cancelled">
									{label}{' '}
									<small>
										({__('Cancelled', 'fair-events')})
									</small>
								</span>
							);
						}
						return (
							<a
								href={`${manageEventUrl}&event_date_id=${item.id}`}
							>
								{label}
							</a>
						);
					}

					if (item.occurrence_type === 'master') {
						const isExpanded = expanded.has(item.id);
						const count = item.children_count || 0;
						return (
							<>
								<Button
									icon={
										isExpanded ? chevronDown : chevronRight
									}
									onClick={() => toggleExpanded(item.id)}
									aria-expanded={isExpanded}
									label={
										isExpanded
											? __(
													'Collapse series dates',
													'fair-events'
											  )
											: __(
													'Expand series dates',
													'fair-events'
											  )
									}
									showTooltip={false}
								/>
								<a
									href={`${manageEventUrl}&event_date_id=${item.id}`}
								>
									{getEventDisplayTitle(item.title)}
								</a>{' '}
								{sprintf(
									/* translators: %d: number of dates in the series. */
									__('(%d dates)', 'fair-events'),
									count
								)}
							</>
						);
					}

					return (
						<a href={`${manageEventUrl}&event_date_id=${item.id}`}>
							{getEventDisplayTitle(item.title)}
						</a>
					);
				},
				enableSorting: true,
				enableHiding: false,
				getValue: ({ item }) => (item.title || '').toLowerCase(),
			},
			{
				id: 'start_datetime',
				label: __('Date', 'fair-events'),
				render: ({ item }) => {
					if (!item.start_datetime) {
						return '—';
					}
					return formatSiteLocalDatetime(item.start_datetime);
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
				label: __('Type', 'fair-events'),
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
		[expanded, toggleExpanded]
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

	// Stale expanded ids should not leak across pages/filters.
	useEffect(() => {
		setExpanded(new Set());
	}, [queryArgs]);

	const flattenedEvents = useMemo(() => {
		const rows = [];
		for (const event of events) {
			rows.push(event);
			if (
				event.occurrence_type === 'master' &&
				expanded.has(event.id) &&
				event.children
			) {
				rows.push(...event.children);
			}
		}
		return rows;
	}, [events, expanded]);

	const getItemLevel = useCallback(
		(item) =>
			item.occurrence_type === 'generated' && item.master_id ? 1 : 0,
		[]
	);

	const actions = useMemo(
		() => [
			{
				id: 'edit',
				label: __('Edit', 'fair-events'),
				isPrimary: true,
				callback: ([item]) => {
					window.location.href = `${manageEventUrl}&event_date_id=${item.id}`;
				},
			},
		],
		[]
	);

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
						data={flattenedEvents}
						fields={fields}
						view={view}
						onChangeView={setView}
						paginationInfo={paginationInfo}
						defaultLayouts={DEFAULT_LAYOUTS}
						actions={actions}
						getItemLevel={getItemLevel}
						isLoading={isLoading}
						getItemId={(item) => item.id}
					/>
				</CardBody>
			</Card>
		</div>
	);
}
