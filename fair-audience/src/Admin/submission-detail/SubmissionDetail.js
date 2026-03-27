import { __ } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Card,
	CardBody,
	CardHeader,
	Spinner,
	Notice,
} from '@wordpress/components';

function formatDate(dateString) {
	if (!dateString) {
		return '';
	}
	const date = new Date(dateString + 'Z');
	return date.toLocaleString();
}

function AnswerDisplay({ answer }) {
	const { question_type, answer_value, file_url } = answer;

	if (question_type === 'file_upload' && file_url) {
		return (
			<div>
				<a href={file_url} target="_blank" rel="noopener noreferrer">
					{file_url.match(/\.(jpg|jpeg|png|gif|webp)$/i) ? (
						<img
							src={file_url}
							alt={answer.question_text}
							style={{
								maxWidth: '300px',
								maxHeight: '200px',
								display: 'block',
								marginTop: '4px',
							}}
						/>
					) : (
						__('View file', 'fair-audience')
					)}
				</a>
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

	return <span>{answer_value || '—'}</span>;
}

export default function SubmissionDetail() {
	const urlParams = new URLSearchParams(window.location.search);
	const submissionId = urlParams.get('submission_id');

	const [submission, setSubmission] = useState(null);
	const [isLoading, setIsLoading] = useState(true);
	const [error, setError] = useState(null);

	useEffect(() => {
		if (!submissionId) {
			setIsLoading(false);
			setError(__('No submission ID provided.', 'fair-audience'));
			return;
		}

		apiFetch({
			path: `/fair-audience/v1/questionnaire-responses/${submissionId}`,
		})
			.then((data) => {
				setSubmission(data);
			})
			.catch(() => {
				setError(__('Submission not found.', 'fair-audience'));
			})
			.finally(() => {
				setIsLoading(false);
			});
	}, [submissionId]);

	if (isLoading) {
		return (
			<div style={{ padding: '20px', textAlign: 'center' }}>
				<Spinner />
			</div>
		);
	}

	if (error) {
		return (
			<div style={{ maxWidth: '800px', margin: '20px 0' }}>
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
		<div style={{ maxWidth: '800px', margin: '20px 0' }}>
			<h1>
				{submission.title || __('Form Submission', 'fair-audience')}
			</h1>

			<Card style={{ marginBottom: '16px' }}>
				<CardHeader>
					<h2 style={{ margin: 0 }}>
						{__('Submission Info', 'fair-audience')}
					</h2>
				</CardHeader>
				<CardBody>
					<table
						className="widefat striped"
						style={{ border: 'none' }}
					>
						<tbody>
							<tr>
								<th style={{ width: '200px' }}>
									{__('Submitted by', 'fair-audience')}
								</th>
								<td>{submission.participant_name}</td>
							</tr>
							<tr>
								<th>{__('Email', 'fair-audience')}</th>
								<td>{submission.participant_email}</td>
							</tr>
							<tr>
								<th>{__('Date', 'fair-audience')}</th>
								<td>{formatDate(submission.created_at)}</td>
							</tr>
						</tbody>
					</table>
				</CardBody>
			</Card>

			<Card>
				<CardHeader>
					<h2 style={{ margin: 0 }}>
						{__('Answers', 'fair-audience')}
					</h2>
				</CardHeader>
				<CardBody>
					{submission.answers.length === 0 ? (
						<p>{__('No answers recorded.', 'fair-audience')}</p>
					) : (
						<table
							className="widefat striped"
							style={{ border: 'none' }}
						>
							<thead>
								<tr>
									<th style={{ width: '40%' }}>
										{__('Question', 'fair-audience')}
									</th>
									<th>{__('Answer', 'fair-audience')}</th>
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
