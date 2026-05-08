import { useState, useEffect, useMemo, useRef } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	CheckboxControl,
	Modal,
	Spinner,
	SelectControl,
	TextControl,
	TextareaControl,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
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
	const [ticketOptions, setTicketOptions] = useState([]);
	const [ticketTypes, setTicketTypes] = useState([]);
	const [questionnaireSummary, setQuestionnaireSummary] = useState(null);
	const [loadingQuestionnaire, setLoadingQuestionnaire] = useState(true);
	const [formsSummary, setFormsSummary] = useState([]);
	const [loadingForms, setLoadingForms] = useState(true);

	// Filter & sort state
	const [filterRole, setFilterRole] = useState('all');
	const [searchText, setSearchText] = useState('');
	const [sortBy, setSortBy] = useState('role');
	const [sortOrder, setSortOrder] = useState('asc');

	// Add participant modal state
	const [addModalOpen, setAddModalOpen] = useState(false);
	const [addModalLabel, setAddModalLabel] = useState('signed_up');
	const [allParticipants, setAllParticipants] = useState([]);
	const [loadingAllParticipants, setLoadingAllParticipants] = useState(false);
	const [addSearch, setAddSearch] = useState('');
	const [selectedToAdd, setSelectedToAdd] = useState(new Set());
	const [isAdding, setIsAdding] = useState(false);

	// Edit options modal state
	const [editingParticipant, setEditingParticipant] = useState(null);
	const [editOptionIds, setEditOptionIds] = useState([]);
	const [editTicketTypeId, setEditTicketTypeId] = useState(null);
	const [editAdminComment, setEditAdminComment] = useState('');
	const [isSavingOptions, setIsSavingOptions] = useState(false);

	const [toast, setToast] = useState(null);
	const toastTimerRef = useRef(null);
	const showToast = (message, type = 'success') => {
		if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
		setToast({ message, type });
		toastTimerRef.current = setTimeout(() => setToast(null), 3500);
	};
	useEffect(
		() => () => {
			if (toastTimerRef.current) clearTimeout(toastTimerRef.current);
		},
		[]
	);

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
		if (!eventDateId) return;
		apiFetch({
			path: `/fair-events/v1/event-dates/${eventDateId}/tickets`,
		})
			.then((data) => {
				setTicketOptions(
					Array.isArray(data?.options) ? data.options : []
				);
				setTicketTypes(
					Array.isArray(data?.ticket_types) ? data.ticket_types : []
				);
			})
			.catch(() => {
				setTicketOptions([]);
				setTicketTypes([]);
			});
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
			} else if (sortBy === 'ticket_type') {
				const ttA = a.ticket_type_name || '';
				const ttB = b.ticket_type_name || '';
				if (ttA === '' && ttB !== '') {
					cmp = 1; // empty values sort to the end
				} else if (ttA !== '' && ttB === '') {
					cmp = -1;
				} else {
					cmp = ttA.localeCompare(ttB);
				}
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

	const loadParticipants = () => {
		apiFetch({
			path: `/fair-audience/v1/event-dates/${eventDateId}/participants`,
		})
			.then((data) => {
				setParticipants(Array.isArray(data) ? data : []);
			})
			.catch(() => {
				setParticipants([]);
			});
	};

	const handleOpenAddModal = () => {
		setAddModalOpen(true);
		setSelectedToAdd(new Set());
		setAddSearch('');
		setAddModalLabel('signed_up');
		setLoadingAllParticipants(true);
		apiFetch({ path: '/fair-audience/v1/participants?per_page=0' })
			.then((data) => {
				setAllParticipants(Array.isArray(data) ? data : []);
			})
			.catch(() => {
				setAllParticipants([]);
			})
			.finally(() => setLoadingAllParticipants(false));
	};

	const handleCloseAddModal = () => {
		setAddModalOpen(false);
		setSelectedToAdd(new Set());
		setAddSearch('');
	};

	const availableParticipants = useMemo(() => {
		const existingIds = new Set(participants.map((p) => p.participant_id));
		return allParticipants.filter((p) => !existingIds.has(p.id));
	}, [allParticipants, participants]);

	const filteredAvailableParticipants = useMemo(() => {
		if (!addSearch) return availableParticipants;
		const term = addSearch.toLowerCase();
		return availableParticipants.filter(
			(p) =>
				(p.name || '').toLowerCase().includes(term) ||
				(p.surname || '').toLowerCase().includes(term) ||
				(p.email || '').toLowerCase().includes(term)
		);
	}, [availableParticipants, addSearch]);

	const handleToggleParticipantToAdd = (participantId) => {
		const next = new Set(selectedToAdd);
		if (next.has(participantId)) {
			next.delete(participantId);
		} else {
			next.add(participantId);
		}
		setSelectedToAdd(next);
	};

	const handleBatchAdd = async () => {
		if (selectedToAdd.size === 0) return;
		setIsAdding(true);
		try {
			await apiFetch({
				path: `/fair-audience/v1/event-dates/${eventDateId}/participants/batch`,
				method: 'POST',
				data: {
					participant_ids: Array.from(selectedToAdd),
					label: addModalLabel,
				},
			});
			handleCloseAddModal();
			loadParticipants();
		} catch (err) {
			showToast(
				__('Error adding participants: ', 'fair-events') + err.message,
				'error'
			);
		} finally {
			setIsAdding(false);
		}
	};

	const handleToggleAttended = (participant, attended) => {
		setParticipants((current) =>
			current.map((p) =>
				p.id === participant.id
					? {
							...p,
							attended_at: attended
								? p.attended_at || new Date().toISOString()
								: null,
					  }
					: p
			)
		);

		apiFetch({
			path: `/fair-audience/v1/event-dates/${eventDateId}/participants/${participant.participant_id}`,
			method: 'PUT',
			data: { attended },
		})
			.then((response) => {
				setParticipants((current) =>
					current.map((p) =>
						p.id === participant.id
							? { ...p, attended_at: response.attended_at }
							: p
					)
				);
			})
			.catch(() => {
				setParticipants((current) =>
					current.map((p) =>
						p.id === participant.id
							? { ...p, attended_at: participant.attended_at }
							: p
					)
				);
			});
	};

	const handleDeleteParticipant = (participant) => {
		const confirmMessage = sprintf(
			/* translators: %s: participant name */
			__(
				'Delete %s’s registration for this event date? This cannot be undone.',
				'fair-events'
			),
			participant.participant_name ||
				__('this participant', 'fair-events')
		);
		if (!window.confirm(confirmMessage)) {
			return;
		}

		const previous = participants;
		setParticipants((list) => list.filter((p) => p.id !== participant.id));

		apiFetch({
			path: `/fair-audience/v1/event-dates/${eventDateId}/participants/${participant.participant_id}`,
			method: 'DELETE',
		}).catch((err) => {
			setParticipants(previous);
			showToast(
				__('Error deleting registration: ', 'fair-events') +
					(err.message || ''),
				'error'
			);
		});
	};

	const handleOpenEditOptions = (participant) => {
		setEditingParticipant(participant);
		const initialIds = Array.isArray(participant.ticket_option_ids)
			? participant.ticket_option_ids
			: [];
		// Backfill from names for any rows missing an id link.
		const names = participant.ticket_option_names || [];
		const namesAsIds = names
			.map((name) => {
				const match = ticketOptions.find((o) => o.name === name);
				return match ? match.id : null;
			})
			.filter((id) => id !== null);
		setEditOptionIds([...new Set([...initialIds, ...namesAsIds])]);
		setEditTicketTypeId(
			participant.ticket_type_id
				? Number(participant.ticket_type_id)
				: null
		);
		setEditAdminComment(participant.admin_comment || '');
	};

	const handleToggleOptionId = (id) => {
		setEditOptionIds((current) =>
			current.includes(id)
				? current.filter((n) => n !== id)
				: [...current, id]
		);
	};

	const handleSaveOptions = async () => {
		if (!editingParticipant) return;
		setIsSavingOptions(true);
		try {
			const response = await apiFetch({
				path: `/fair-audience/v1/event-dates/${eventDateId}/participants/${editingParticipant.participant_id}`,
				method: 'PUT',
				data: {
					ticket_option_ids: editOptionIds,
					ticket_type_id: editTicketTypeId,
					admin_comment: editAdminComment,
				},
			});
			setParticipants((current) =>
				current.map((p) =>
					p.id === editingParticipant.id
						? {
								...p,
								ticket_option_ids:
									response.ticket_option_ids ?? editOptionIds,
								ticket_option_names:
									response.ticket_option_names ??
									p.ticket_option_names,
								ticket_type_id:
									response.ticket_type_id ?? editTicketTypeId,
								ticket_type_name:
									response.ticket_type_name ??
									p.ticket_type_name,
								admin_comment:
									response.admin_comment ?? editAdminComment,
						  }
						: p
				)
			);
			setEditingParticipant(null);
		} catch (err) {
			showToast(
				__('Error saving options: ', 'fair-events') + err.message,
				'error'
			);
		} finally {
			setIsSavingOptions(false);
		}
	};

	const copyToClipboard = async (text, successMessage) => {
		try {
			await navigator.clipboard.writeText(text);
			showToast(successMessage, 'success');
		} catch (err) {
			showToast(
				__('Error copying to clipboard: ', 'fair-events') + err.message,
				'error'
			);
		}
	};

	const participantHasOption = (p, opt) => {
		const ids = p.ticket_option_ids || [];
		const names = p.ticket_option_names || [];
		return ids.includes(opt.id) || names.includes(opt.name);
	};

	const buildCopyByTicketType = () => {
		const groups = new Map();
		filteredParticipants.forEach((p) => {
			const key =
				p.ticket_type_name || __('No ticket type', 'fair-events');
			if (!groups.has(key)) groups.set(key, []);
			groups.get(key).push(p.participant_name || '—');
		});
		const sortedKeys = Array.from(groups.keys()).sort((a, b) =>
			a.localeCompare(b)
		);
		return sortedKeys
			.map((key) => {
				const names = groups
					.get(key)
					.sort((a, b) => a.localeCompare(b));
				return `*${key}* (${names.length})\n${names
					.map((n) => `- ${n}`)
					.join('\n')}`;
			})
			.join('\n\n');
	};

	const buildCopyByActivity = () => {
		if (ticketOptions.length === 0) return '';
		return ticketOptions
			.map((opt) => {
				const names = filteredParticipants
					.filter((p) => participantHasOption(p, opt))
					.map((p) => p.participant_name || '—')
					.sort((a, b) => a.localeCompare(b));
				return `*${opt.name}* (${names.length})\n${
					names.length > 0
						? names.map((n) => `- ${n}`).join('\n')
						: `- ${__('(none)', 'fair-events')}`
				}`;
			})
			.join('\n\n');
	};

	const buildActivitySummary = () => {
		if (ticketOptions.length === 0) return '';
		return ticketOptions
			.map((opt) => {
				const count = filteredParticipants.filter((p) =>
					participantHasOption(p, opt)
				).length;
				return `- ${opt.name}: ${count}`;
			})
			.join('\n');
	};

	const buildCopyByParticipant = () => {
		const sorted = [...filteredParticipants].sort((a, b) =>
			(a.participant_name || '').localeCompare(b.participant_name || '')
		);
		return sorted
			.map((p) => {
				const lines = [`*${p.participant_name || '—'}*`];
				if (p.ticket_type_name) lines.push(p.ticket_type_name);
				const activities = ticketOptions
					.filter((opt) => participantHasOption(p, opt))
					.map((opt) => `- ${opt.name}`);
				if (activities.length > 0) lines.push(...activities);
				return lines.join('\n');
			})
			.join('\n\n');
	};

	return (
		<>
			{eventId && (
				<Card style={{ marginTop: '16px' }}>
					<CardHeader>
						<h2>{__('Participants', 'fair-events')}</h2>
					</CardHeader>
					<CardBody>
						<HStack
							spacing={3}
							wrap
							alignment="left"
							style={{ marginBottom: '16px' }}
						>
							<span
								style={{
									color: '#757575',
									fontSize: '13px',
									fontWeight: 500,
								}}
							>
								{__('Copy lists:', 'fair-events')}
							</span>
							<Button
								variant="secondary"
								onClick={() =>
									copyToClipboard(
										buildCopyByTicketType(),
										__(
											'Copied list by ticket type',
											'fair-events'
										)
									)
								}
								disabled={filteredParticipants.length === 0}
							>
								{__('Ticket type', 'fair-events')}
							</Button>
							<Button
								variant="secondary"
								onClick={() =>
									copyToClipboard(
										buildCopyByActivity(),
										__(
											'Copied list by activity',
											'fair-events'
										)
									)
								}
								disabled={
									filteredParticipants.length === 0 ||
									ticketOptions.length === 0
								}
							>
								{__('Activity', 'fair-events')}
							</Button>
							<Button
								variant="secondary"
								onClick={() =>
									copyToClipboard(
										buildActivitySummary(),
										__(
											'Copied activity summary',
											'fair-events'
										)
									)
								}
								disabled={
									filteredParticipants.length === 0 ||
									ticketOptions.length === 0
								}
							>
								{__('Activity summary', 'fair-events')}
							</Button>
							<Button
								variant="secondary"
								onClick={() =>
									copyToClipboard(
										buildCopyByParticipant(),
										__(
											'Copied list by participant',
											'fair-events'
										)
									)
								}
								disabled={filteredParticipants.length === 0}
							>
								{__('Participant', 'fair-events')}
							</Button>
						</HStack>
						{loadingParticipants ? (
							<Spinner />
						) : (
							<VStack spacing={4} style={{ maxWidth: '100%' }}>
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
									<div
										style={{
											overflowX: 'auto',
											width: '100%',
										}}
									>
										<table className="wp-list-table widefat striped">
											<thead>
												<tr>
													<th
														style={{
															width: '1%',
															whiteSpace:
																'nowrap',
															textAlign: 'right',
														}}
													>
														#
													</th>
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
													<th
														style={{
															cursor: 'pointer',
														}}
														onClick={() =>
															handleSort(
																'ticket_type'
															)
														}
													>
														{__(
															'Ticket type',
															'fair-events'
														)}
														{sortIndicator(
															'ticket_type'
														)}
													</th>
													{ticketOptions.map(
														(opt) => (
															<th key={opt.id}>
																{opt.short_name ||
																	opt.name}
															</th>
														)
													)}
													<th>
														{__(
															'Shown up',
															'fair-events'
														)}
													</th>
													<th>
														{__(
															'Actions',
															'fair-events'
														)}
													</th>
												</tr>
											</thead>
											<tbody>
												{filteredParticipants.map(
													(p, index) => (
														<tr key={p.id}>
															<td
																style={{
																	textAlign:
																		'right',
																	color: '#666',
																}}
															>
																{index + 1}
															</td>
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
															<td>
																{p.ticket_type_name ||
																	'—'}
															</td>
															{ticketOptions.map(
																(opt) => {
																	const ids =
																		p.ticket_option_ids ||
																		[];
																	const names =
																		p.ticket_option_names ||
																		[];
																	const hasOption =
																		ids.includes(
																			opt.id
																		) ||
																		names.includes(
																			opt.name
																		);
																	return (
																		<td
																			key={
																				opt.id
																			}
																			style={{
																				textAlign:
																					'center',
																			}}
																		>
																			{hasOption
																				? '✓'
																				: ''}
																		</td>
																	);
																}
															)}
															<td>
																<input
																	type="checkbox"
																	aria-label={__(
																		'Shown up',
																		'fair-events'
																	)}
																	checked={
																		!!p.attended_at
																	}
																	onChange={(
																		e
																	) =>
																		handleToggleAttended(
																			p,
																			e
																				.target
																				.checked
																		)
																	}
																/>
															</td>
															<td>
																<HStack
																	spacing={2}
																	justify="flex-start"
																>
																	{ticketOptions.length >
																		0 && (
																		<Button
																			variant="link"
																			onClick={() =>
																				handleOpenEditOptions(
																					p
																				)
																			}
																		>
																			{__(
																				'Edit',
																				'fair-events'
																			)}
																		</Button>
																	)}
																	<Button
																		variant="link"
																		isDestructive
																		onClick={() =>
																			handleDeleteParticipant(
																				p
																			)
																		}
																	>
																		{__(
																			'Delete',
																			'fair-events'
																		)}
																	</Button>
																</HStack>
															</td>
														</tr>
													)
												)}
											</tbody>
											{ticketOptions.length > 0 && (
												<tfoot>
													<tr>
														<th />
														<th
															colSpan={3}
															style={{
																textAlign:
																	'right',
															}}
														>
															{__(
																'Total',
																'fair-events'
															)}
														</th>
														{ticketOptions.map(
															(opt) => {
																const total =
																	filteredParticipants.reduce(
																		(
																			acc,
																			p
																		) => {
																			const ids =
																				p.ticket_option_ids ||
																				[];
																			const names =
																				p.ticket_option_names ||
																				[];
																			const hasOption =
																				ids.includes(
																					opt.id
																				) ||
																				names.includes(
																					opt.name
																				);
																			return (
																				acc +
																				(hasOption
																					? 1
																					: 0)
																			);
																		},
																		0
																	);
																return (
																	<th
																		key={
																			opt.id
																		}
																		style={{
																			textAlign:
																				'center',
																		}}
																	>
																		{total}
																	</th>
																);
															}
														)}
														<th />
														<th />
													</tr>
												</tfoot>
											)}
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

								<HStack spacing={3} wrap>
									<Button
										variant="primary"
										onClick={handleOpenAddModal}
									>
										{__('Add Participants', 'fair-events')}
									</Button>
									<Button
										variant="secondary"
										href={audienceUrl + eventDateId}
									>
										{__(
											'Manage Participants',
											'fair-events'
										)}
									</Button>
								</HStack>
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

			{addModalOpen && (
				<Modal
					title={__('Add Participants', 'fair-events')}
					onRequestClose={handleCloseAddModal}
					style={{ maxWidth: '640px', width: '100%' }}
				>
					{loadingAllParticipants ? (
						<Spinner />
					) : availableParticipants.length === 0 ? (
						<p>
							{__(
								'All participants are already added to this event.',
								'fair-events'
							)}
						</p>
					) : (
						<>
							<div
								style={{
									display: 'flex',
									gap: '10px',
									marginBottom: '10px',
								}}
							>
								<input
									type="text"
									placeholder={__(
										'Search by name or email…',
										'fair-events'
									)}
									value={addSearch}
									onChange={(e) =>
										setAddSearch(e.target.value)
									}
									style={{
										flex: 1,
										padding: '8px 12px',
										border: '1px solid #ddd',
										borderRadius: '4px',
									}}
								/>
								<SelectControl
									value={addModalLabel}
									options={[
										{
											label: __(
												'Signed up',
												'fair-events'
											),
											value: 'signed_up',
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
												'Interested',
												'fair-events'
											),
											value: 'interested',
										},
									]}
									onChange={setAddModalLabel}
									__nextHasNoMarginBottom
								/>
							</div>

							<div
								style={{
									marginBottom: '10px',
									fontSize: '12px',
									color: '#666',
								}}
							>
								{selectedToAdd.size > 0
									? sprintf(
											/* translators: 1: selected count, 2: shown count */
											__(
												'%1$d selected, %2$d shown',
												'fair-events'
											),
											selectedToAdd.size,
											filteredAvailableParticipants.length
									  )
									: sprintf(
											/* translators: %d: number of available participants */
											__(
												'%d participant(s) available',
												'fair-events'
											),
											filteredAvailableParticipants.length
									  )}
							</div>

							<div
								style={{
									maxHeight: '400px',
									overflowY: 'auto',
									border: '1px solid #ddd',
									borderRadius: '4px',
								}}
							>
								{filteredAvailableParticipants.map((p) => (
									<div
										key={p.id}
										style={{
											padding: '10px 15px',
											borderBottom: '1px solid #eee',
											display: 'flex',
											alignItems: 'center',
											gap: '10px',
										}}
									>
										<CheckboxControl
											checked={selectedToAdd.has(p.id)}
											onChange={() =>
												handleToggleParticipantToAdd(
													p.id
												)
											}
											__nextHasNoMarginBottom
										/>
										<div>
											<strong>
												{p.name} {p.surname}
											</strong>
											<br />
											<span
												style={{
													color: '#666',
													fontSize: '12px',
												}}
											>
												{p.email}
											</span>
										</div>
									</div>
								))}
								{filteredAvailableParticipants.length === 0 && (
									<p
										style={{
											padding: '15px',
											color: '#666',
										}}
									>
										{__(
											'No participants match your search.',
											'fair-events'
										)}
									</p>
								)}
							</div>

							<div
								style={{
									marginTop: '20px',
									display: 'flex',
									justifyContent: 'flex-end',
									gap: '10px',
								}}
							>
								<Button
									variant="secondary"
									onClick={handleCloseAddModal}
								>
									{__('Cancel', 'fair-events')}
								</Button>
								<Button
									variant="primary"
									onClick={handleBatchAdd}
									disabled={
										selectedToAdd.size === 0 || isAdding
									}
								>
									{isAdding
										? __('Adding…', 'fair-events')
										: sprintf(
												/* translators: %d: number of selected participants */
												__(
													'Add %d Selected',
													'fair-events'
												),
												selectedToAdd.size
										  )}
								</Button>
							</div>
						</>
					)}
				</Modal>
			)}

			{editingParticipant && (
				<Modal
					title={sprintf(
						/* translators: %s: participant name */
						__('Edit options — %s', 'fair-events'),
						editingParticipant.participant_name
					)}
					onRequestClose={() => setEditingParticipant(null)}
					style={{ maxWidth: '480px', width: '100%' }}
				>
					<VStack spacing={3}>
						{ticketTypes.length > 0 && (
							<SelectControl
								label={__('Ticket type', 'fair-events')}
								value={
									editTicketTypeId === null
										? ''
										: String(editTicketTypeId)
								}
								options={[
									{
										label: __('— None —', 'fair-events'),
										value: '',
									},
									...ticketTypes.map((tt) => ({
										label: tt.name || `#${tt.id}`,
										value: String(tt.id),
									})),
								]}
								onChange={(value) =>
									setEditTicketTypeId(
										value === '' ? null : Number(value)
									)
								}
								__nextHasNoMarginBottom
							/>
						)}
						{ticketOptions.map((opt) => (
							<CheckboxControl
								key={opt.id}
								label={opt.name}
								checked={editOptionIds.includes(opt.id)}
								onChange={() => handleToggleOptionId(opt.id)}
								__nextHasNoMarginBottom
							/>
						))}
						<TextareaControl
							label={__('Admin comment', 'fair-events')}
							help={__(
								'Internal note about this signup (e.g. "pending 10€ payment"). Only visible to admins.',
								'fair-events'
							)}
							value={editAdminComment}
							onChange={setEditAdminComment}
							rows={3}
							__nextHasNoMarginBottom
						/>
						<HStack
							spacing={3}
							style={{ justifyContent: 'flex-end' }}
						>
							<Button
								variant="secondary"
								onClick={() => setEditingParticipant(null)}
							>
								{__('Cancel', 'fair-events')}
							</Button>
							<Button
								variant="primary"
								onClick={handleSaveOptions}
								disabled={isSavingOptions}
							>
								{isSavingOptions
									? __('Saving…', 'fair-events')
									: __('Save', 'fair-events')}
							</Button>
						</HStack>
					</VStack>
				</Modal>
			)}

			{toast && (
				<div
					role="status"
					aria-live="polite"
					onClick={() => setToast(null)}
					style={{
						position: 'fixed',
						bottom: '20px',
						right: '20px',
						padding: '12px 18px',
						borderRadius: '4px',
						color: 'white',
						fontWeight: 500,
						zIndex: 100000,
						maxWidth: '400px',
						boxShadow: '0 4px 12px rgba(0,0,0,0.15)',
						cursor: 'pointer',
						backgroundColor:
							toast.type === 'error' ? '#d63638' : '#00a32a',
					}}
				>
					{toast.message}
				</div>
			)}
		</>
	);
}
