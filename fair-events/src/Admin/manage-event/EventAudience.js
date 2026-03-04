import { useState, useEffect } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	__experimentalVStack as VStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

export default function EventAudience({ eventId, eventDateId, audienceUrl }) {
	const [counts, setCounts] = useState(null);
	const [loadingCounts, setLoadingCounts] = useState(true);
	const [questionnaireSummary, setQuestionnaireSummary] = useState(null);
	const [loadingQuestionnaire, setLoadingQuestionnaire] = useState(true);

	useEffect(() => {
		if (!eventId) {
			setLoadingCounts(false);
			return;
		}
		apiFetch({ path: `/fair-audience/v1/events/${eventId}` })
			.then((data) => {
				setCounts({
					signedUp: data.signed_up || 0,
					collaborators: data.collaborators || 0,
					interested: data.interested || 0,
				});
			})
			.catch(() => {
				setCounts(null);
			})
			.finally(() => setLoadingCounts(false));
	}, [eventId]);

	useEffect(() => {
		if (!eventDateId) {
			setLoadingQuestionnaire(false);
			return;
		}
		apiFetch({
			path: `/fair-audience/v1/questionnaire-responses?event_date_id=${eventDateId}`,
		})
			.then((data) => {
				if (!data || data.length === 0) {
					setQuestionnaireSummary(null);
				} else {
					// Aggregate answer counts per question.
					const questions = new Map();
					data.forEach((submission) => {
						(submission.answers || []).forEach((answer) => {
							if (!questions.has(answer.question_key)) {
								questions.set(answer.question_key, {
									text: answer.question_text,
									type: answer.question_type,
									counts: {},
								});
							}
							const q = questions.get(answer.question_key);
							const val = answer.answer_value || '';
							q.counts[val] = (q.counts[val] || 0) + 1;
						});
					});
					setQuestionnaireSummary({
						totalResponses: data.length,
						questions: Array.from(questions.values()),
					});
				}
			})
			.catch(() => {
				setQuestionnaireSummary(null);
			})
			.finally(() => setLoadingQuestionnaire(false));
	}, [eventDateId]);

	return (
		<>
			{eventId && (
				<Card style={{ marginTop: '16px' }}>
					<CardHeader>
						<h2>{__('Participants', 'fair-events')}</h2>
					</CardHeader>
					<CardBody>
						{loadingCounts ? (
							<Spinner />
						) : counts ? (
							<VStack spacing={3}>
								<p>
									{__('Signed up:', 'fair-events')}{' '}
									<strong>{counts.signedUp}</strong>
								</p>
								<p>
									{__('Collaborators:', 'fair-events')}{' '}
									<strong>{counts.collaborators}</strong>
								</p>
								<p>
									{__('Interested:', 'fair-events')}{' '}
									<strong>{counts.interested}</strong>
								</p>
								<Button
									variant="secondary"
									href={audienceUrl + eventId}
								>
									{__('View Participants', 'fair-events')}
								</Button>
							</VStack>
						) : (
							<p>
								{__(
									'No participant data available.',
									'fair-events'
								)}
							</p>
						)}
					</CardBody>
				</Card>
			)}

			<Card style={{ marginTop: '16px' }}>
				<CardHeader>
					<h2>{__('Questionnaire Responses', 'fair-events')}</h2>
				</CardHeader>
				<CardBody>
					{loadingQuestionnaire ? (
						<Spinner />
					) : questionnaireSummary ? (
						<VStack spacing={3}>
							<p>
								{__('Total responses:', 'fair-events')}{' '}
								<strong>
									{questionnaireSummary.totalResponses}
								</strong>
							</p>
							{questionnaireSummary.questions.map((q) => (
								<div key={q.text}>
									<p>
										<strong>{q.text}</strong>
									</p>
									<ul style={{ margin: '4px 0 0 20px' }}>
										{Object.entries(q.counts).map(
											([value, count]) => (
												<li key={value}>
													{value || '—'}: {count}
												</li>
											)
										)}
									</ul>
								</div>
							))}
							<Button
								variant="secondary"
								href={`admin.php?page=fair-audience-questionnaire-responses&event_date_id=${eventDateId}`}
							>
								{__('View All Responses', 'fair-events')}
							</Button>
						</VStack>
					) : (
						<p>
							{__(
								'No questionnaire responses yet.',
								'fair-events'
							)}
						</p>
					)}
				</CardBody>
			</Card>
		</>
	);
}
