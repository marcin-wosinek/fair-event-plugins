import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useMemo } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	Card,
	CardBody,
	Modal,
	RadioControl,
	SelectControl,
	TextControl,
	TextareaControl,
	Notice,
} from '@wordpress/components';
import { DataViews } from '@wordpress/dataviews';
import { submissionToMarkdown } from '../utils/submission-markdown.js';

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

	// Markdown export feedback state.
	const [copyFeedback, setCopyFeedback] = useState(null);

	// Add-to-group modal state.
	const [isGroupModalOpen, setIsGroupModalOpen] = useState(false);
	const [groupMode, setGroupMode] = useState('existing');
	const [availableGroups, setAvailableGroups] = useState([]);
	const [groupsLoading, setGroupsLoading] = useState(false);
	const [selectedGroupId, setSelectedGroupId] = useState('');
	const [newGroupName, setNewGroupName] = useState('');
	const [newGroupDescription, setNewGroupDescription] = useState('');
	const [isSubmittingGroup, setIsSubmittingGroup] = useState(false);
	const [groupFeedback, setGroupFeedback] = useState(null);

	const params = new URLSearchParams(window.location.search);
	const eventDateId = params.get('event_date_id');
	const postId = params.get('post_id');
	const formId = params.get('form_id');
	const title = params.get('title');

	useEffect(() => {
		const parts = [];
		if (eventDateId) {
			parts.push(`event_date_id=${eventDateId}`);
		}
		if (postId) {
			parts.push(`post_id=${postId}`);
		}
		if (formId) {
			parts.push(`form_id=${encodeURIComponent(formId)}`);
		}
		if (title) {
			parts.push(`title=${encodeURIComponent(title)}`);
		}

		const apiPath = `/fair-form/v1/questionnaire-responses${
			parts.length ? '?' + parts.join('&') : ''
		}`;

		setIsLoading(true);
		apiFetch({
			path: apiPath,
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
	}, [eventDateId, postId, formId]);

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
				label: __('Name', 'fair-form'),
				enableSorting: true,
				enableHiding: false,
				getValue: ({ item }) => item.participant_name || '',
				render: ({ item }) =>
					item.participant_id ? (
						// TODO(phase-3): retarget to fair-form participant detail once it exists.
						<a
							href={`admin.php?page=fair-audience-participant-detail&participant_id=${item.participant_id}`}
						>
							{item.participant_name || ''}
						</a>
					) : (
						item.participant_name || ''
					),
			},
			{
				id: 'participant_email',
				label: __('Email', 'fair-form'),
				enableSorting: true,
				getValue: ({ item }) => item.participant_email || '',
			},
			{
				id: 'participant_status',
				label: __('Status', 'fair-form'),
				enableSorting: true,
				getValue: ({ item }) => item.participant_status || '',
				render: ({ item }) => {
					const labels = {
						pending: __('Pending', 'fair-form'),
						confirmed: __('Confirmed', 'fair-form'),
					};
					return (
						labels[item.participant_status] ||
						item.participant_status ||
						'—'
					);
				},
				elements: [
					{ value: 'pending', label: __('Pending', 'fair-form') },
					{
						value: 'confirmed',
						label: __('Confirmed', 'fair-form'),
					},
				],
				filterBy: { operators: ['is'] },
			},
			{
				id: 'participant_mailing',
				label: __('Mailing', 'fair-form'),
				enableSorting: true,
				getValue: ({ item }) => item.participant_mailing || '',
				render: ({ item }) => {
					const labels = {
						minimal: __('Minimal', 'fair-form'),
						marketing: __('Marketing', 'fair-form'),
					};
					return (
						labels[item.participant_mailing] ||
						item.participant_mailing ||
						'—'
					);
				},
				elements: [
					{ value: 'minimal', label: __('Minimal', 'fair-form') },
					{
						value: 'marketing',
						label: __('Marketing', 'fair-form'),
					},
				],
				filterBy: { operators: ['is'] },
			},
			{
				id: 'participant_categories',
				label: __('Subscribed Categories', 'fair-form'),
				enableSorting: false,
				getValue: ({ item }) =>
					(item.participant_categories || [])
						.map((c) => c.name)
						.join(', '),
				render: ({ item }) => {
					const cats = item.participant_categories || [];
					if (cats.length === 0) {
						return '—';
					}
					return cats.map((c) => c.name).join(', ');
				},
			},
			{
				id: 'created_at',
				label: __('Date', 'fair-form'),
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
					'fair-form'
				)
			)
		) {
			return;
		}

		apiFetch({
			path: `/fair-form/v1/questionnaire-responses/${item.id}`,
			method: 'DELETE',
		})
			.then(() => {
				setResponses((prev) => prev.filter((r) => r.id !== item.id));
			})
			.catch((err) => {
				// eslint-disable-next-line no-undef
				alert(
					__('Error: ', 'fair-form') +
						(err.message ||
							__('Failed to delete response.', 'fair-form'))
				);
			});
	};

	const actions = useMemo(
		() => [
			{
				id: 'delete',
				label: __('Delete', 'fair-form'),
				icon: 'trash',
				callback: ([item]) => handleDelete(item),
				supportsBulk: false,
			},
		],
		[]
	);

	// Unique participant IDs from responses (skip null/0).
	const uniqueParticipantIds = useMemo(() => {
		const ids = new Set();
		responses.forEach((response) => {
			const pid = parseInt(response.participant_id, 10);
			if (pid > 0) {
				ids.add(pid);
			}
		});
		return Array.from(ids);
	}, [responses]);

	const openGroupModal = () => {
		setGroupMode('existing');
		setSelectedGroupId('');
		setNewGroupName('');
		setNewGroupDescription('');
		setGroupFeedback(null);
		setIsGroupModalOpen(true);

		setGroupsLoading(true);
		apiFetch({
			path: '/fair-audience/v1/groups?orderby=name&order=asc',
		})
			.then((data) => {
				setAvailableGroups(data);
				setGroupsLoading(false);
			})
			.catch((err) => {
				// eslint-disable-next-line no-console
				console.error('Error loading groups:', err);
				setGroupsLoading(false);
			});
	};

	const addParticipantsToGroup = (groupId) => {
		const promises = uniqueParticipantIds.map((participantId) =>
			apiFetch({
				path: `/fair-audience/v1/groups/${groupId}/participants`,
				method: 'POST',
				data: { participant_id: participantId },
			})
				.then(() => ({ added: true }))
				.catch((err) => {
					if (err.code === 'already_member') {
						return { added: false };
					}
					throw err;
				})
		);

		return Promise.all(promises).then((results) => ({
			added: results.filter((r) => r.added).length,
			skipped: results.filter((r) => !r.added).length,
		}));
	};

	const handleSubmitGroup = () => {
		if (uniqueParticipantIds.length === 0) {
			return;
		}

		setIsSubmittingGroup(true);
		setGroupFeedback(null);

		const resolveGroup =
			groupMode === 'new'
				? apiFetch({
						path: '/fair-audience/v1/groups',
						method: 'POST',
						data: {
							name: newGroupName.trim(),
							description: newGroupDescription.trim(),
						},
				  }).then((group) => group.id)
				: Promise.resolve(parseInt(selectedGroupId, 10));

		resolveGroup
			.then((groupId) => addParticipantsToGroup(groupId))
			.then(({ added, skipped }) => {
				setGroupFeedback({
					status: 'success',
					message: sprintf(
						// translators: 1: number added, 2: number already in group
						__(
							'%1$d participant(s) added, %2$d already in group.',
							'fair-form'
						),
						added,
						skipped
					),
				});
			})
			.catch((err) => {
				setGroupFeedback({
					status: 'error',
					message:
						err.message ||
						__('Failed to add participants to group.', 'fair-form'),
				});
			})
			.finally(() => {
				setIsSubmittingGroup(false);
			});
	};

	const canSubmitGroup =
		uniqueParticipantIds.length > 0 &&
		!isSubmittingGroup &&
		((groupMode === 'existing' && selectedGroupId) ||
			(groupMode === 'new' && newGroupName.trim()));

	const buildMarkdown = () => {
		const lines = [];
		const heading = title || __('Questionnaire Responses', 'fair-form');
		const exportedLabel = __('Exported', 'fair-form');
		const responsesLabel = __('Responses', 'fair-form');
		const adminLinkLabel = __('Admin link', 'fair-form');

		const today = new Date().toISOString().split('T')[0];

		lines.push(`# ${heading}`);
		lines.push('');
		lines.push(`_${exportedLabel} ${today}_`);
		lines.push('');
		lines.push(`- ${responsesLabel}: ${responses.length}`);
		lines.push(`- ${adminLinkLabel}: ${window.location.href}`);
		lines.push('');

		responses.forEach((response) => {
			lines.push('---');
			lines.push('');
			lines.push(submissionToMarkdown(response));
		});

		return lines.join('\n');
	};

	const copyMarkdown = () => {
		if (!navigator.clipboard) {
			setCopyFeedback({
				status: 'error',
				message: __('Clipboard not available.', 'fair-form'),
			});
			return;
		}
		navigator.clipboard
			.writeText(buildMarkdown())
			.then(() => {
				setCopyFeedback({
					status: 'success',
					message: __(
						'Markdown copied to clipboard. Paste into Google Docs.',
						'fair-form'
					),
				});
			})
			.catch(() => {
				setCopyFeedback({
					status: 'error',
					message: __('Failed to copy.', 'fair-form'),
				});
			});
	};

	const exportCsv = () => {
		if (responses.length === 0) {
			return;
		}

		const headers = [
			__('Name', 'fair-form'),
			__('Email', 'fair-form'),
			__('Status', 'fair-form'),
			__('Mailing', 'fair-form'),
			__('Subscribed Categories', 'fair-form'),
			__('Date', 'fair-form'),
			...questionColumns.map((col) => col.text),
		];

		const rows = responses.map((response) => {
			const base = [
				response.participant_name,
				response.participant_email,
				response.participant_status,
				response.participant_mailing,
				(response.participant_categories || [])
					.map((c) => c.name)
					.join(', '),
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
		const bom = '﻿';
		const blob = new Blob([bom + csvContent], {
			type: 'text/csv;charset=utf-8;',
		});
		const url = URL.createObjectURL(blob);
		const link = document.createElement('a');
		link.href = url;
		const contextId = eventDateId || postId || formId || 'all';
		link.download = `questionnaire-responses-${contextId}.csv`;
		link.click();
		URL.revokeObjectURL(url);
	};

	return (
		<div className="wrap">
			<h1>{__('Questionnaire Responses', 'fair-form')}</h1>

			<p>
				<a href="admin.php?page=fair-form">
					&larr; {__('Back to Answers Overview', 'fair-form')}
				</a>
				{eventDateId && (
					<>
						{' | '}
						<a
							href={`admin.php?page=fair-events-manage-event&event_date_id=${eventDateId}`}
						>
							{__('Event edit page', 'fair-form')}
						</a>
					</>
				)}
				{postId && (
					<>
						{' | '}
						<a href={`post.php?post=${postId}&action=edit`}>
							{__('Post entry', 'fair-form')}
						</a>
					</>
				)}
			</p>

			<div
				style={{
					marginBottom: '16px',
					display: 'flex',
					gap: '8px',
				}}
			>
				<Button
					variant="primary"
					onClick={openGroupModal}
					disabled={uniqueParticipantIds.length === 0}
				>
					{__('Add participants to group', 'fair-form')}
				</Button>
				<Button
					variant="secondary"
					onClick={exportCsv}
					disabled={responses.length === 0}
				>
					{__('Export CSV', 'fair-form')}
				</Button>
				<Button
					variant="secondary"
					onClick={copyMarkdown}
					disabled={responses.length === 0}
				>
					{__('Copy Markdown', 'fair-form')}
				</Button>
			</div>

			{copyFeedback && (
				<Notice
					status={copyFeedback.status}
					onRemove={() => setCopyFeedback(null)}
				>
					{copyFeedback.message}
				</Notice>
			)}

			{isGroupModalOpen && (
				<Modal
					title={__('Add participants to group', 'fair-form')}
					onRequestClose={() => setIsGroupModalOpen(false)}
					style={{ maxWidth: '500px', width: '100%' }}
				>
					<p>
						{sprintf(
							// translators: %d: number of unique participants
							__(
								'%d unique participant(s) will be added.',
								'fair-form'
							),
							uniqueParticipantIds.length
						)}
					</p>

					<RadioControl
						label={__('Target group', 'fair-form')}
						selected={groupMode}
						options={[
							{
								label: __('Use existing group', 'fair-form'),
								value: 'existing',
							},
							{
								label: __('Create new group', 'fair-form'),
								value: 'new',
							},
						]}
						onChange={setGroupMode}
					/>

					{groupMode === 'existing' && (
						<SelectControl
							label={__('Group', 'fair-form')}
							value={selectedGroupId}
							onChange={setSelectedGroupId}
							options={[
								{
									label: groupsLoading
										? __('Loading...', 'fair-form')
										: __('— Select a group —', 'fair-form'),
									value: '',
								},
								...availableGroups.map((group) => ({
									label: `${group.name} (${group.member_count})`,
									value: String(group.id),
								})),
							]}
							disabled={groupsLoading}
						/>
					)}

					{groupMode === 'new' && (
						<>
							<TextControl
								label={__('Name', 'fair-form')}
								value={newGroupName}
								onChange={setNewGroupName}
								placeholder={__(
									'Enter group name...',
									'fair-form'
								)}
							/>
							<TextareaControl
								label={__('Description', 'fair-form')}
								value={newGroupDescription}
								onChange={setNewGroupDescription}
								placeholder={__(
									'Enter group description (optional)...',
									'fair-form'
								)}
							/>
						</>
					)}

					{groupFeedback && (
						<Notice
							status={groupFeedback.status}
							isDismissible={false}
						>
							{groupFeedback.message}
						</Notice>
					)}

					<div
						style={{
							display: 'flex',
							justifyContent: 'flex-end',
							gap: '8px',
							marginTop: '16px',
						}}
					>
						<Button
							variant="secondary"
							onClick={() => setIsGroupModalOpen(false)}
						>
							{__('Close', 'fair-form')}
						</Button>
						<Button
							variant="primary"
							onClick={handleSubmitGroup}
							disabled={!canSubmitGroup}
							isBusy={isSubmittingGroup}
						>
							{groupMode === 'new'
								? __('Create group and add', 'fair-form')
								: __('Add to group', 'fair-form')}
						</Button>
					</div>
				</Modal>
			)}

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
