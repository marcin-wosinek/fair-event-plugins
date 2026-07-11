import { __ } from '@wordpress/i18n';
import { useState, useEffect, useMemo } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardBody,
	__experimentalToggleGroupControl as ToggleGroupControl,
	__experimentalToggleGroupControlOption as ToggleGroupControlOption,
} from '@wordpress/components';
import { DataViews } from '@wordpress/dataviews';

const DEFAULT_VIEW = {
	type: 'table',
	perPage: 25,
	page: 1,
	sort: {
		field: 'count',
		direction: 'desc',
	},
	search: '',
	filters: [],
	fields: ['label', 'count'],
};

const DEFAULT_LAYOUTS = {
	table: {},
};

export default function AnswersOverview() {
	const [groupBy, setGroupBy] = useState('page');
	const [groups, setGroups] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [view, setView] = useState(DEFAULT_VIEW);

	useEffect(() => {
		setIsLoading(true);
		apiFetch({
			path: `/fair-form/v1/questionnaire-responses/grouped?by=${groupBy}`,
		})
			.then((data) => {
				setGroups(data);
				setIsLoading(false);
			})
			.catch((err) => {
				// eslint-disable-next-line no-console
				console.error('Error loading grouped responses:', err);
				setIsLoading(false);
			});
	}, [groupBy]);

	const fields = useMemo(() => {
		const labelField = {
			id: 'label',
			label: __('Name', 'fair-form'),
			enableSorting: true,
			enableHiding: false,
			getValue: ({ item }) => item.label || '',
			render: ({ item }) => {
				let href = 'admin.php?page=fair-form-questionnaire-responses';
				if (groupBy === 'page' && item.post_id) {
					href += `&post_id=${item.post_id}`;
				} else if (groupBy === 'event' && item.event_date_id) {
					href += `&event_date_id=${item.event_date_id}`;
				} else if (groupBy === 'form' && item.form_id) {
					href += `&form_id=${encodeURIComponent(item.form_id)}`;
				}
				return <a href={href}>{item.label || '—'}</a>;
			},
		};

		return [
			labelField,
			{
				id: 'count',
				label: __('Submissions', 'fair-form'),
				enableSorting: true,
				getValue: ({ item }) => item.count,
			},
		];
	}, [groupBy]);

	const paginationInfo = useMemo(
		() => ({
			totalItems: groups.length,
			totalPages: Math.ceil(groups.length / (view.perPage || 25)),
		}),
		[groups.length, view.perPage]
	);

	const groupByLabel = {
		page: __('by Page', 'fair-form'),
		event: __('by Event', 'fair-form'),
		form: __('by Form', 'fair-form'),
	};

	return (
		<div className="wrap">
			<h1>{__('Form Answers Overview', 'fair-form')}</h1>

			<div style={{ marginBottom: '16px' }}>
				<ToggleGroupControl
					label={__('Group by', 'fair-form')}
					value={groupBy}
					onChange={setGroupBy}
					isBlock
				>
					<ToggleGroupControlOption
						value="page"
						label={__('Page', 'fair-form')}
					/>
					<ToggleGroupControlOption
						value="event"
						label={__('Event', 'fair-form')}
					/>
					<ToggleGroupControlOption
						value="form"
						label={__('Form', 'fair-form')}
					/>
				</ToggleGroupControl>
			</div>

			<p style={{ color: '#757575', fontStyle: 'italic' }}>
				{groupByLabel[groupBy]}
			</p>

			<Card>
				<CardBody>
					<DataViews
						data={groups}
						fields={fields}
						view={view}
						onChangeView={setView}
						paginationInfo={paginationInfo}
						defaultLayouts={DEFAULT_LAYOUTS}
						isLoading={isLoading}
						getItemId={(item) =>
							groupBy === 'page'
								? `page-${item.post_id}`
								: groupBy === 'event'
								? `event-${item.event_date_id}`
								: `form-${item.form_id}`
						}
					/>
				</CardBody>
			</Card>
		</div>
	);
}
