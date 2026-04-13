import { useState, useEffect, useMemo } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	SelectControl,
	TextControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __ } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

const LABEL_ORDER = { collaborator: 0, signed_up: 1, interested: 2 };

const LABEL_DISPLAY = {
	collaborator: __('Collaborator', 'fair-events'),
	signed_up: __('Signed up', 'fair-events'),
	interested: __('Interested', 'fair-events'),
};

export default function EventAudience({ eventId, eventDateId, audienceUrl }) {
	const [participants, setParticipants] = useState([]);
	const [loadingParticipants, setLoadingParticipants] = useState(true);
	const [questionnaireSummary, setQuestionnaireSummary] = useState(null);
	const [loadingQuestionnaire, setLoadingQuestionnaire] = useState(true);
	const [formsSummary, setFormsSummary] = useState([]);
	const [loadingForms, setLoadingForms] = useState(true);

	// Filter & sort state
	const [filterRole, setFilterRole] = useState('all');
	const [searchText, setSearchText] = useState('');
	const [sortBy, setSortBy] = useState('role');
	const [sortOrder, setSortOrder] = useState('asc');

	useEffect(() => {
		if (!eventDateId) {
			setLoadingParticipants(false);
			return;
		}
		apiFetch({
			path: `/fair-audience/v1/event-dates/${eventDateId}/participants`,
		})
			.then((data) => {
				setParticipants(Array.isArray(data) ? data : []);
			})
			.catch(() => {
				setParticipants([]);
			})
			.finally(() => setLoadingParticipants(false));
	}, [eventDateId]);

	useEffect(() => {
		if (!eventDateId) {
			setLoadingForms(false);
			return;
		}
		apiFetch({
			path: `/fair-audience/v1/questionnaire-responses/forms-summary?event_date_id=${eventDateId}`,
		})
			.then((data) => {
				setFormsSummary(Array.isArray(data) ? data : []);
			})
			.catch(() => {
				setFormsSummary([]);
			})
			.finally(() => setLoadingForms(false));
	}, [eventDateId]);

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

	const filteredParticipants = useMemo(() => {
		let list = participants;

		if (filterRole !== 'all') {
			list = list.filter((p) => p.label === filterRole);
		}

		if (searchText) {
			const term = searchText.toLowerCase();
			list = list.filter((p) =>
				(p.participant_name || '').toLowerCase().includes(term)
			);
		}

		list = [...list].sort((a, b) => {
			let cmp = 0;
			if (sortBy === 'role') {
				cmp = (LABEL_ORDER[a.label] ?? 3) - (LABEL_ORDER[b.label] ?? 3);
				if (cmp === 0) {
					cmp = (a.participant_name || '').localeCompare(
						b.participant_name || ''
					);
				}
			} else {
				cmp = (a.participant_name || '').localeCompare(
					b.participant_name || ''
				);
				if (cmp === 0) {
					cmp =
						(LABEL_ORDER[a.label] ?? 3) -
						(LABEL_ORDER[b.label] ?? 3);
				}
			}
			return sortOrder === 'desc' ? -cmp : cmp;
		});

		return list;
	}, [participants, filterRole, searchText, sortBy, sortOrder]);

	const counts = useMemo(() => {
		const c = { collaborator: 0, signed_up: 0, interested: 0 };
		participants.forEach((p) => {
			if (c[p.label] !== undefined) {
				c[p.label]++;
			}
		});
		return c;
	}, [participants]);

	const handleSort = (column) => {
		if (sortBy === column) {
			setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
		} else {
			setSortBy(column);
			setSortOrder('asc');
		}
	};

	const sortIndicator = (column) => {
		if (sortBy !== column) return '';
		return sortOrder === 'asc' ? ' \u25B2' : ' \u25BC';
	};

	return (
		<>
			{eventId && (
				<Card style={{ marginTop: '16px' }}>
					<CardHeader>
						<h2>{__('Participants', 'fair-events')}</h2>
					</CardHeader>
					<CardBody>
						{loadingParticipants ? (
							<Spinner />
						) : (
							<VStack spacing={4}>
								<HStack spacing={4} wrap>
									<span>
										{__('Collaborators:', 'fair-events')}{' '}
										<strong>{counts.collaborator}</strong>
									</span>
									<span>
										{__('Signed up:', 'fair-events')}{' '}
										<strong>{counts.signed_up}</strong>
									</span>
									<span>
										{__('Interested:', 'fair-events')}{' '}
										<strong>{counts.interested}</strong>
									</span>
									<span>
										{__('Total:', 'fair-events')}{' '}
										<strong>{participants.length}</strong>
									</span>
								</HStack>

								<HStack spacing={4} wrap alignment="bottom">
									<TextControl
										label={__('Search', 'fair-events')}
										value={searchText}
										onChange={setSearchText}
										placeholder={__(
											'Filter by name…',
											'fair-events'
										)}
										__nextHasNoMarginBottom
									/>
									<SelectControl
										label={__('Role', 'fair-events')}
										value={filterRole}
										options={[
											{
												label: __(
													'All roles',
													'fair-events'
												),
												value: 'all',
											},
											{
												label: __(
													'Collaborator',
													'fair-events'
												),
												value: 'collaborator',
											},
											{
												label: __(
													'Signed up',
													'fair-events'
												),
												value: 'signed_up',
											},
											{
												label: __(
													'Interested',
													'fair-events'
												),
												value: 'interested',
											},
										]}
										onChange={setFilterRole}
										__nextHasNoMarginBottom
									/>
								</HStack>

								{filteredParticipants.length > 0 ? (
									<div style={{ overflowX: 'auto' }}>
										<table className="wp-list-table widefat striped">
											<thead>
												<tr>
													<th
														style={{
															cursor: 'pointer',
														}}
														onClick={() =>
															handleSort('name')
														}
													>
														{__(
															'Name',
															'fair-events'
														)}
														{sortIndicator('name')}
													</th>
													<th
														style={{
															cursor: 'pointer',
														}}
														onClick={() =>
															handleSort('role')
														}
													>
														{__(
															'Role',
															'fair-events'
														)}
														{sortIndicator('role')}
													</th>
												</tr>
											</thead>
											<tbody>
												{filteredParticipants.map(
													(p) => (
														<tr key={p.id}>
															<td>
																{p.participant_id ? (
																	<a
																		href={`admin.php?page=fair-audience-participant-detail&participant_id=${p.participant_id}`}
																	>
																		{p.participant_name ||
																			'—'}
																	</a>
																) : (
																	p.participant_name ||
																	'—'
																)}
															</td>
															<td>
																{LABEL_DISPLAY[
																	p.label
																] || p.label}
															</td>
														</tr>
													)
												)}
											</tbody>
										</table>
									</div>
								) : (
									<p
										style={{
											textAlign: 'center',
											color: '#666',
										}}
									>
										{participants.length === 0
											? __(
													'No participants yet.',
													'fair-events'
											  )
											: __(
													'No participants match the current filters.',
													'fair-events'
											  )}
									</p>
								)}

								<Button
									variant="secondary"
									href={audienceUrl + eventDateId}
								>
									{__('Manage Participants', 'fair-events')}
								</Button>
							</VStack>
						)}
					</CardBody>
				</Card>
			)}

			<Card style={{ marginTop: '16px' }}>
				<CardHeader>
					<h2>{__('Forms', 'fair-events')}</h2>
				</CardHeader>
				<CardBody>
					{loadingForms ? (
						<Spinner />
					) : formsSummary.length > 0 ? (
						<div style={{ overflowX: 'auto' }}>
							<table className="wp-list-table widefat striped">
								<thead>
									<tr>
										<th>{__('Form', 'fair-events')}</th>
										<th>
											{__('Responses', 'fair-events')}
										</th>
										<th>{__('Actions', 'fair-events')}</th>
									</tr>
								</thead>
								<tbody>
									{formsSummary.map((form, index) => (
										<tr key={form.post_id || index}>
											<td>
												{form.post_title ||
													form.title ||
													'—'}
											</td>
											<td>{form.submission_count}</td>
											<td>
												<Button
													variant="link"
													href={`admin.php?page=fair-audience-questionnaire-responses&event_date_id=${eventDateId}${
														form.post_id
															? `&post_id=${form.post_id}`
															: `&title=${encodeURIComponent(
																	form.title
															  )}`
													}`}
												>
													{__(
														'View Responses',
														'fair-events'
													)}
												</Button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					) : (
						<p>{__('No form submissions yet.', 'fair-events')}</p>
					)}
				</CardBody>
			</Card>

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
