import { __ } from '@wordpress/i18n';
import { useState, useEffect, useMemo } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import { Button, Card, CardBody } from '@wordpress/components';
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
};

const DEFAULT_LAYOUTS = {
	table: {},
};

export default function QuestionnaireResponses() {
	const [responses, setResponses] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [view, setView] = useState(DEFAULT_VIEW);

	const params = new URLSearchParams(window.location.search);
	const eventDateId = params.get('event_date_id');

	useEffect(() => {
		if (!eventDateId) {
			setIsLoading(false);
			return;
		}

		setIsLoading(true);
		apiFetch({
			path: `/fair-audience/v1/questionnaire-responses?event_date_id=${eventDateId}`,
		})
			.then((data) => {
				setResponses(data);
				setIsLoading(false);
			})
			.catch((err) => {
				// eslint-disable-next-line no-console
				console.error('Error loading questionnaire responses:', err);
				setIsLoading(false);
			});
	}, [eventDateId]);

	// Derive dynamic question columns from all responses.
	const questionColumns = useMemo(() => {
		const seen = new Map();
		responses.forEach((response) => {
			(response.answers || []).forEach((answer) => {
				if (!seen.has(answer.question_key)) {
					seen.set(answer.question_key, answer.question_text);
				}
			});
		});
		return Array.from(seen.entries()).map(([key, text]) => ({
			key,
			text,
		}));
	}, [responses]);

	// Build fields for DataViews.
	const fields = useMemo(() => {
		const baseFields = [
			{
				id: 'participant_name',
				label: __('Name', 'fair-audience'),
				enableSorting: true,
				enableHiding: false,
				getValue: ({ item }) => item.participant_name || '',
			},
			{
				id: 'participant_email',
				label: __('Email', 'fair-audience'),
				enableSorting: true,
				getValue: ({ item }) => item.participant_email || '',
			},
			{
				id: 'created_at',
				label: __('Date', 'fair-audience'),
				enableSorting: true,
				getValue: ({ item }) => item.created_at || '',
			},
		];

		const dynamicFields = questionColumns.map((col) => ({
			id: `question_${col.key}`,
			label: col.text,
			enableSorting: false,
			getValue: ({ item }) => {
				const answer = (item.answers || []).find(
					(a) => a.question_key === col.key
				);
				return answer ? answer.answer_value : '';
			},
		}));

		return [...baseFields, ...dynamicFields];
	}, [questionColumns]);

	const defaultViewFields = useMemo(() => fields.map((f) => f.id), [fields]);

	const viewWithFields = useMemo(
		() => ({
			...view,
			fields: view.fields || defaultViewFields,
		}),
		[view, defaultViewFields]
	);

	const paginationInfo = useMemo(
		() => ({
			totalItems: responses.length,
			totalPages: Math.ceil(responses.length / (view.perPage || 25)),
		}),
		[responses.length, view.perPage]
	);

	const handleDelete = (item) => {
		// eslint-disable-next-line no-undef
		if (
			!confirm(
				__(
					'Are you sure you want to delete this response?',
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
				setResponses((prev) => prev.filter((r) => r.id !== item.id));
			})
			.catch((err) => {
				// eslint-disable-next-line no-undef
				alert(
					__('Error: ', 'fair-audience') +
						(err.message ||
							__('Failed to delete response.', 'fair-audience'))
				);
			});
	};

	const actions = useMemo(
		() => [
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

	const exportCsv = () => {
		if (responses.length === 0) {
			return;
		}

		const headers = [
			__('Name', 'fair-audience'),
			__('Email', 'fair-audience'),
			__('Date', 'fair-audience'),
			...questionColumns.map((col) => col.text),
		];

		const rows = responses.map((response) => {
			const base = [
				response.participant_name,
				response.participant_email,
				response.created_at,
			];
			const answers = questionColumns.map((col) => {
				const answer = (response.answers || []).find(
					(a) => a.question_key === col.key
				);
				return answer ? answer.answer_value : '';
			});
			return [...base, ...answers];
		});

		const escapeCsvField = (field) => {
			const str = String(field ?? '');
			if (str.includes(',') || str.includes('"') || str.includes('\n')) {
				return '"' + str.replace(/"/g, '""') + '"';
			}
			return str;
		};

		const csvContent = [
			headers.map(escapeCsvField).join(','),
			...rows.map((row) => row.map(escapeCsvField).join(',')),
		].join('\n');

		// BOM for UTF-8 Excel compatibility.
		const bom = '\uFEFF';
		const blob = new Blob([bom + csvContent], {
			type: 'text/csv;charset=utf-8;',
		});
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		link.download = `questionnaire-responses-${eventDateId}.csv`;
		link.click();
		URL.revokeObjectURL(url);
	};

	if (!eventDateId) {
		return (
			<div className="wrap">
				<p>{__('No event date ID provided.', 'fair-audience')}</p>
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1>{__('Questionnaire Responses', 'fair-audience')}</h1>

			<p>
				<a href="admin.php?page=fair-audience-by-event">
					&larr; {__('Back to Events', 'fair-audience')}
				</a>
			</p>

			<div style={{ marginBottom: '16px' }}>
				<Button
					variant="secondary"
					onClick={exportCsv}
					disabled={responses.length === 0}
				>
					{__('Export CSV', 'fair-audience')}
				</Button>
			</div>

			<Card>
				<CardBody>
					<DataViews
						data={responses}
						fields={fields}
						view={viewWithFields}
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
