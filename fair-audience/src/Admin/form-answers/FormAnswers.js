import { __ } from '@wordpress/i18n';
import { useState, useEffect, useMemo } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { Card, CardBody } from '@wordpress/components';
import { DataViews } from '@wordpress/dataviews';

const DEFAULT_VIEW = {
	type: 'table',
	perPage: 25,
	page: 1,
	sort: {
		field: 'created_at',
		direction: 'desc',
	},
	search: '',
	filters: [],
	fields: ['participant_name', 'created_at', 'event_name'],
};

const DEFAULT_LAYOUTS = {
	table: {},
};

export default function FormAnswers() {
	const [submissions, setSubmissions] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [view, setView] = useState(DEFAULT_VIEW);

	useEffect(() => {
		setIsLoading(true);
		apiFetch({
			path: '/fair-audience/v1/questionnaire-responses/all',
		})
			.then((data) => {
				setSubmissions(data);
				setIsLoading(false);
			})
			.catch((err) => {
				// eslint-disable-next-line no-console
				console.error('Error loading form answers:', err);
				setIsLoading(false);
			});
	}, []);

	const fields = useMemo(
		() => [
			{
				id: 'participant_name',
				label: __('Name', 'fair-audience'),
				enableSorting: true,
				enableHiding: false,
				render: ({ item }) => (
					<a
						href={`admin.php?page=fair-audience-submission-detail&submission_id=${item.id}`}
					>
						{item.participant_name || '—'}
					</a>
				),
				getValue: ({ item }) => item.participant_name || '',
			},
			{
				id: 'participant_email',
				label: __('Email', 'fair-audience'),
				enableSorting: true,
				getValue: ({ item }) => item.participant_email || '',
			},
			{
				id: 'title',
				label: __('Form', 'fair-audience'),
				enableSorting: true,
				getValue: ({ item }) => item.title || '',
			},
			{
				id: 'event_name',
				label: __('Event', 'fair-audience'),
				enableSorting: true,
				getValue: ({ item }) => item.event_name || '',
			},
			{
				id: 'created_at',
				label: __('Date', 'fair-audience'),
				enableSorting: true,
				getValue: ({ item }) => item.created_at || '',
			},
		],
		[]
	);

	const paginationInfo = useMemo(
		() => ({
			totalItems: submissions.length,
			totalPages: Math.ceil(submissions.length / (view.perPage || 25)),
		}),
		[submissions.length, view.perPage]
	);

	const handleDelete = (item) => {
		// eslint-disable-next-line no-undef
		if (
			!confirm(
				__(
					'Are you sure you want to delete this submission?',
					'fair-audience'
				)
			)
		) {
			return;
		}

		apiFetch({
			path: `/fair-audience/v1/questionnaire-responses/${item.id}`,
			method: 'DELETE',
		})
			.then(() => {
				setSubmissions((prev) => prev.filter((s) => s.id !== item.id));
			})
			.catch((err) => {
				// eslint-disable-next-line no-undef
				alert(
					__('Error: ', 'fair-audience') +
						(err.message ||
							__('Failed to delete submission.', 'fair-audience'))
				);
			});
	};

	const actions = useMemo(
		() => [
			{
				id: 'view',
				label: __('View', 'fair-audience'),
				icon: 'visibility',
				callback: ([item]) => {
					window.location.href = `admin.php?page=fair-audience-submission-detail&submission_id=${item.id}`;
				},
				supportsBulk: false,
			},
			{
				id: 'delete',
				label: __('Delete', 'fair-audience'),
				icon: 'trash',
				callback: ([item]) => handleDelete(item),
				supportsBulk: false,
				isDestructive: true,
			},
		],
		[]
	);

	return (
		<div className="wrap">
			<h1>{__('Form Answers', 'fair-audience')}</h1>

			<Card>
				<CardBody>
					<DataViews
						data={submissions}
						fields={fields}
						view={view}
						onChangeView={setView}
						actions={actions}
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
