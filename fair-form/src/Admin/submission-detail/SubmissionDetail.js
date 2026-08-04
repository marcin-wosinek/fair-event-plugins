import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardBody,
	CardHeader,
	Spinner,
	Notice,
	Button,
	SelectControl,
} from '@wordpress/components';
import { submissionToMarkdown } from '../utils/submission-markdown.js';
import { formatDate } from '../utils/format-date.js';
import { formatSiteLocalDatetime, formatDateOnly } from 'fair-events-shared';

function EventDetails({ details }) {
	const { title, start_datetime, end_datetime, all_day, location } = details;

	const formatWhen = (value) =>
		all_day ? formatDateOnly(value) : formatSiteLocalDatetime(value);

	return (
		<div className="fair-form-submission-detail__event-details">
			<span className="fair-form-submission-detail__event-details-label">
				{__('Read from the linked page:', 'fair-form')}
			</span>
			<ul>
				{title && <li>{title}</li>}
				{start_datetime && (
					<li>
						{end_datetime
							? sprintf(
									/* translators: 1: start date/time, 2: end date/time */
									__('%1$s – %2$s', 'fair-form'),
									formatWhen(start_datetime),
									formatWhen(end_datetime)
							  )
							: formatWhen(start_datetime)}
					</li>
				)}
				{location && <li>{location}</li>}
			</ul>
		</div>
	);
}

function AnswerDisplay({ answer }) {
	const { question_type, answer_value, file_url, event_details } = answer;

	if (question_type === 'file_upload' && file_url) {
		return (
			<div>
				<a href={file_url} target="_blank" rel="noopener noreferrer">
					{answer.is_image ? (
						<img
							src={file_url}
							alt={answer.question_text}
							style={{
								maxWidth: '100%',
								maxHeight: '200px',
								display: 'block',
								marginTop: '4px',
							}}
						/>
					) : (
						__('View file', 'fair-form')
					)}
				</a>
			</div>
		);
	}

	if (
		question_type === 'url' &&
		answer_value &&
		/^https?:\/\//.test(answer_value)
	) {
		return (
			<div>
				<a
					href={answer_value}
					target="_blank"
					rel="noopener noreferrer"
				>
					{answer_value}
				</a>
				{event_details && <EventDetails details={event_details} />}
			</div>
		);
	}

	if (question_type === 'multiselect' && answer_value) {
		try {
			const values = JSON.parse(answer_value);
			if (Array.isArray(values)) {
				return <span>{values.join(', ')}</span>;
			}
		} catch {
			// Fall through to default.
		}
	}

	if (question_type === 'checkbox') {
		return (
			<span>
				{answer_value === '1'
					? __('Yes', 'fair-form')
					: __('No', 'fair-form')}
			</span>
		);
	}

	return <span>{answer_value || '—'}</span>;
}

function EventField({ submission, onUpdate }) {
	const [isEditing, setIsEditing] = useState(false);
	const [eventDates, setEventDates] = useState([]);
	const [selectedEventDateId, setSelectedEventDateId] = useState(
		submission.event_date_id ? String(submission.event_date_id) : ''
	);
	const [isSaving, setIsSaving] = useState(false);

	const loadEventDates = () => {
		if (eventDates.length > 0) {
			return;
		}
		apiFetch({
			path: '/fair-form/v1/questionnaire-responses/grouped?by=event',
		})
			.then((data) => {
				setEventDates(data);
			})
			.catch((err) => {
				// eslint-disable-next-line no-console
				console.error('Error loading event dates:', err);
			});
	};

	const handleEdit = () => {
		setIsEditing(true);
		loadEventDates();
	};

	const handleSave = () => {
		setIsSaving(true);
		apiFetch({
			path: `/fair-form/v1/questionnaire-responses/${submission.id}`,
			method: 'PUT',
			data: {
				event_date_id: selectedEventDateId
					? parseInt(selectedEventDateId, 10)
					: 0,
			},
		})
			.then((updated) => {
				onUpdate(updated);
				setIsEditing(false);
			})
			.catch((err) => {
				// eslint-disable-next-line no-undef
				alert(
					__('Error: ', 'fair-form') +
						(err.message || __('Failed to update.', 'fair-form'))
				);
			})
			.finally(() => {
				setIsSaving(false);
			});
	};

	const eventDateOptions = [
		{ label: __('— None —', 'fair-form'), value: '' },
		...eventDates
			.filter((ed) => ed.event_date_id)
			.map((ed) => ({
				label: `${ed.label} (${ed.count})`,
				value: String(ed.event_date_id),
			})),
	];

	if (!isEditing) {
		return (
			<td>
				{submission.event_name || '—'}
				<Button
					variant="link"
					onClick={handleEdit}
					style={{ marginLeft: '8px' }}
				>
					{__('Edit', 'fair-form')}
				</Button>
			</td>
		);
	}

	return (
		<td>
			<div className="fair-form-submission-detail__event-edit">
				<SelectControl
					value={selectedEventDateId}
					options={eventDateOptions}
					onChange={setSelectedEventDateId}
					__nextHasNoMarginBottom
				/>
				<Button
					variant="primary"
					onClick={handleSave}
					isBusy={isSaving}
					disabled={isSaving}
				>
					{__('Save', 'fair-form')}
				</Button>
				<Button variant="tertiary" onClick={() => setIsEditing(false)}>
					{__('Cancel', 'fair-form')}
				</Button>
			</div>
		</td>
	);
}

export default function SubmissionDetail() {
	const urlParams = new URLSearchParams(window.location.search);
	const submissionId = urlParams.get('submission_id');

	const [submission, setSubmission] = useState(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState(null);
	const [copyFeedback, setCopyFeedback] = useState(null);

	const copyMarkdown = () => {
		if (!navigator.clipboard) {
			setCopyFeedback({
				status: 'error',
				message: __('Clipboard not available.', 'fair-form'),
			});
			return;
		}
		navigator.clipboard
			.writeText(submissionToMarkdown(submission))
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

	useEffect(() => {
		if (!submissionId) {
			setIsLoading(false);
			setError(__('No submission ID provided.', 'fair-form'));
			return;
		}

		apiFetch({
			path: `/fair-form/v1/questionnaire-responses/${submissionId}`,
		})
			.then((data) => {
				setSubmission(data);
			})
			.catch(() => {
				setError(__('Submission not found.', 'fair-form'));
			})
			.finally(() => {
				setIsLoading(false);
			});
	}, [submissionId]);

	if (isLoading) {
		return (
			<div
				className="wrap fair-form-submission-detail"
				style={{ textAlign: 'center' }}
			>
				<Spinner />
			</div>
		);
	}

	if (error) {
		return (
			<div className="wrap fair-form-submission-detail">
				<Notice status="error" isDismissible={false}>
					{error}
				</Notice>
			</div>
		);
	}

	if (!submission) {
		return null;
	}

	return (
		<div className="wrap fair-form-submission-detail">
			<div className="fair-form-submission-detail__header">
				<h1>
					{submission.title || __('Form Submission', 'fair-form')}
				</h1>
				<Button variant="secondary" onClick={copyMarkdown}>
					{__('Copy markdown', 'fair-form')}
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

			<Card style={{ marginBottom: '16px' }}>
				<CardHeader>
					<h2 style={{ margin: 0 }}>
						{__('Submission Info', 'fair-form')}
					</h2>
				</CardHeader>
				<CardBody>
					<table
						className="widefat striped fair-form-submission-detail__info-table"
						style={{ border: 'none' }}
					>
						<tbody>
							<tr>
								<th>{__('Submitted by', 'fair-form')}</th>
								<td>
									{submission.participant_id ? (
										// TODO(phase-3): retarget to fair-form participant detail once it exists.
										<a
											href={`admin.php?page=fair-audience-participant-detail&participant_id=${submission.participant_id}`}
										>
											{submission.participant_name}
										</a>
									) : (
										submission.participant_name
									)}
								</td>
							</tr>
							<tr>
								<th>{__('Email', 'fair-form')}</th>
								<td>{submission.participant_email}</td>
							</tr>
							<tr>
								<th>{__('Date', 'fair-form')}</th>
								<td>{formatDate(submission.created_at)}</td>
							</tr>
							<tr>
								<th>{__('Event', 'fair-form')}</th>
								<EventField
									submission={submission}
									onUpdate={setSubmission}
								/>
							</tr>
						</tbody>
					</table>
				</CardBody>
			</Card>

			<Card>
				<CardHeader>
					<h2 style={{ margin: 0 }}>{__('Answers', 'fair-form')}</h2>
				</CardHeader>
				<CardBody>
					{submission.answers.length === 0 ? (
						<p>{__('No answers recorded.', 'fair-form')}</p>
					) : (
						<table
							className="widefat striped fair-form-submission-detail__answers-table"
							style={{ border: 'none' }}
						>
							<thead>
								<tr>
									<th>{__('Question', 'fair-form')}</th>
									<th>{__('Answer', 'fair-form')}</th>
								</tr>
							</thead>
							<tbody>
								{submission.answers.map((answer, index) => (
									<tr key={index}>
										<td>
											<strong>
												{answer.question_text}
											</strong>
										</td>
										<td>
											<AnswerDisplay answer={answer} />
										</td>
									</tr>
								))}
							</tbody>
						</table>
					)}
				</CardBody>
			</Card>
		</div>
	);
}
