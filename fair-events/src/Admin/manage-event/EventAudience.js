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
import { __, _n, sprintf } from '@wordpress/i18n';
import apiFetch from '@wordpress/api-fetch';

const LABEL_ORDER = { collaborator: 0, signed_up: 1, interested: 2 };

const LABEL_DISPLAY = {
	collaborator: __('Collaborator', 'fair-events'),
	signed_up: __('Signed up', 'fair-events'),
	interested: __('Interested', 'fair-events'),
};

// A pending_payment row is "stale" once its hold has lapsed: capacity counters
// stop including it (matching the registration block) and the row needs admin
// triage — confirm (cash payment etc.) or cancel.
const isStalePendingPayment = (p) => {
	if (!p || p.label !== 'pending_payment') return false;
	if (!p.payment_expires_at) return true;
	return new Date(p.payment_expires_at).getTime() <= Date.now();
};

// Whether a participant currently occupies a seat for capacity purposes.
// Mirrors EventParticipantRepository::count_seats_for_ticket_option in PHP.
const occupiesSeat = (p) => {
	if (!p) return false;
	if (p.label === 'signed_up') return true;
	if (p.label === 'pending_payment') return !isStalePendingPayment(p);
	return false;
};

export default function EventAudience({
	eventId,
	eventDateId,
	audienceUrl,
	eventTitle,
}) {
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

	// Mailing-list (verbal consent) modal state
	const [mailingModalOpen, setMailingModalOpen] = useState(false);
	const [mailingSearch, setMailingSearch] = useState('');
	const [selectedForMailing, setSelectedForMailing] = useState(new Set());
	const [isUpgrading, setIsUpgrading] = useState(false);

	// Invite groups state
	const [invitedGroups, setInvitedGroups] = useState([]);
	const [inviteModalOpen, setInviteModalOpen] = useState(false);
	const [isSendingInvitations, setIsSendingInvitations] = useState(false);

	// Edit options modal state
	const [editingParticipant, setEditingParticipant] = useState(null);
	const [editOptionIds, setEditOptionIds] = useState([]);
	const [editTicketTypeId, setEditTicketTypeId] = useState(null);
	const [editAdminComment, setEditAdminComment] = useState('');
	const [editStaleDecision, setEditStaleDecision] = useState(null);
	const [editLabel, setEditLabel] = useState('signed_up');
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
		if (!eventDateId) return;
		Promise.all([
			apiFetch({
				path: `/fair-events/v1/event-dates/${eventDateId}/group-permission-rules`,
			}),
			apiFetch({ path: '/fair-audience/v1/groups' }),
		])
			.then(([rules, groups]) => {
				const invitedIds = new Set(
					(rules || [])
						.filter((r) => r.permission_type === 'invited')
						.map((r) => r.group_id)
				);
				setInvitedGroups(
					(groups || []).filter((g) => invitedIds.has(g.id))
				);
			})
			.catch(() => setInvitedGroups([]));
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

	const stalePending = useMemo(
		() => participants.filter(isStalePendingPayment),
		[participants]
	);

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

	// Participants eligible for a marketing-list upgrade: currently on the
	// "minimal" email profile and reachable (have an email address).
	const mailingEligible = useMemo(
		() =>
			participants.filter(
				(p) => p.email_profile === 'minimal' && p.participant_email
			),
		[participants]
	);

	const filteredMailingEligible = useMemo(() => {
		if (!mailingSearch) return mailingEligible;
		const term = mailingSearch.toLowerCase();
		return mailingEligible.filter(
			(p) =>
				(p.name || '').toLowerCase().includes(term) ||
				(p.surname || '').toLowerCase().includes(term) ||
				(p.participant_email || '').toLowerCase().includes(term)
		);
	}, [mailingEligible, mailingSearch]);

	const handleOpenMailingModal = () => {
		setMailingModalOpen(true);
		setSelectedForMailing(new Set());
		setMailingSearch('');
	};

	const handleCloseMailingModal = () => {
		setMailingModalOpen(false);
		setSelectedForMailing(new Set());
		setMailingSearch('');
	};

	const handleToggleMailing = (participantId) => {
		const next = new Set(selectedForMailing);
		if (next.has(participantId)) {
			next.delete(participantId);
		} else {
			next.add(participantId);
		}
		setSelectedForMailing(next);
	};

	const handleSelectAllMailing = () => {
		const shownIds = filteredMailingEligible.map((p) => p.participant_id);
		const allSelected = shownIds.every((id) => selectedForMailing.has(id));
		const next = new Set(selectedForMailing);
		if (allSelected) {
			shownIds.forEach((id) => next.delete(id));
		} else {
			shownIds.forEach((id) => next.add(id));
		}
		setSelectedForMailing(next);
	};

	const handleUpgradeToMarketing = async () => {
		if (selectedForMailing.size === 0) return;
		setIsUpgrading(true);
		try {
			const response = await apiFetch({
				path: `/fair-audience/v1/event-dates/${eventDateId}/participants/marketing-upgrade`,
				method: 'POST',
				data: { participant_ids: Array.from(selectedForMailing) },
			});
			handleCloseMailingModal();
			loadParticipants();
			const upgraded = response.upgraded ?? 0;
			const skipped = response.skipped ?? 0;
			const emailFailed = response.email_failed ?? 0;
			showToast(
				sprintf(
					/* translators: 1: number upgraded, 2: number skipped, 3: number of failed emails */
					__(
						'Added %1$d to the mailing list. Skipped %2$d, %3$d email(s) failed.',
						'fair-events'
					),
					upgraded,
					skipped,
					emailFailed
				),
				emailFailed > 0 ? 'error' : 'success'
			);
		} catch (err) {
			showToast(
				__('Error updating mailing list: ', 'fair-events') +
					err.message,
				'error'
			);
		} finally {
			setIsUpgrading(false);
		}
	};

	const totalInvitees = useMemo(
		() => invitedGroups.reduce((acc, g) => acc + (g.member_count || 0), 0),
		[invitedGroups]
	);

	const handleSendInvitations = async () => {
		if (invitedGroups.length === 0) return;
		setIsSendingInvitations(true);
		try {
			const response = await apiFetch({
				path: `/fair-audience/v1/event-dates/${eventDateId}/event-invitations`,
				method: 'POST',
				data: { group_ids: invitedGroups.map((g) => g.id) },
			});
			setInviteModalOpen(false);
			const sent = response.sent_count ?? 0;
			const skipped = response.skipped_count ?? 0;
			const failed = Array.isArray(response.failed)
				? response.failed.length
				: 0;
			showToast(
				sprintf(
					/* translators: 1: number of sent invitations, 2: number of skipped recipients, 3: number of failures */
					__(
						'Sent %1$d invitation(s). Skipped %2$d, failed %3$d.',
						'fair-events'
					),
					sent,
					skipped,
					failed
				),
				failed > 0 ? 'error' : 'success'
			);
		} catch (err) {
			showToast(
				__('Error sending invitations: ', 'fair-events') + err.message,
				'error'
			);
		} finally {
			setIsSendingInvitations(false);
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
		setEditStaleDecision(null);
		// Only the three editable roles are exposed here. Transient states
		// such as pending_payment fall back to signed_up — the stale-payment
		// resolver below takes over when applicable.
		setEditLabel(
			['collaborator', 'signed_up', 'interested'].includes(
				participant.label
			)
				? participant.label
				: 'signed_up'
		);
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
			const data = {
				ticket_option_ids: editOptionIds,
				ticket_type_id: editTicketTypeId,
				admin_comment: editAdminComment,
			};
			if (editLabel && editLabel !== editingParticipant.label) {
				data.label = editLabel;
			}
			const stalenessResolved =
				isStalePendingPayment(editingParticipant) &&
				editStaleDecision !== null;
			if (stalenessResolved) {
				// Stale-payment resolver overrides any role pick — Confirm /
				// Cancel signup map to the two terminal states for an
				// expired hold.
				data.label =
					editStaleDecision === 'confirm'
						? 'signed_up'
						: 'interested';
			}
			const response = await apiFetch({
				path: `/fair-audience/v1/event-dates/${eventDateId}/participants/${editingParticipant.participant_id}`,
				method: 'PUT',
				data,
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
								...(stalenessResolved
									? {
											label: data.label,
											payment_expires_at: null,
									  }
									: data.label
									? { label: response.label ?? data.label }
									: {}),
						  }
						: p
				)
			);
			setEditingParticipant(null);
			if (stalenessResolved) {
				showToast(
					editStaleDecision === 'confirm'
						? __('Signup confirmed.', 'fair-events')
						: __(
								'Expired signup moved to Interested.',
								'fair-events'
						  )
				);
			}
		} catch (err) {
			showToast(
				__('Error saving options: ', 'fair-events') + err.message,
				'error'
			);
		} finally {
			setIsSavingOptions(false);
		}
	};

	const handlePrintList = () => {
		const escape = (str) =>
			String(str ?? '').replace(
				/[&<>"']/g,
				(c) =>
					({
						'&': '&amp;',
						'<': '&lt;',
						'>': '&gt;',
						'"': '&quot;',
						"'": '&#39;',
					}[c])
			);

		const headerTitle = eventTitle
			? `${eventTitle}`
			: __('Event', 'fair-events');
		const dateLabel = new Date().toLocaleDateString();

		const optionLabelById = new Map(
			ticketOptions.map((o) => [o.id, o.short_name || o.name || ''])
		);
		const optionLabelByName = new Map(
			ticketOptions.map((o) => [o.name, o.short_name || o.name || ''])
		);

		const rows = filteredParticipants
			.map((p, index) => {
				const name = escape(p.participant_name || '');
				const role = escape(LABEL_DISPLAY[p.label] || p.label || '');
				const ticketType = escape(p.ticket_type_name || '');
				const ids = Array.isArray(p.ticket_option_ids)
					? p.ticket_option_ids
					: [];
				const names = Array.isArray(p.ticket_option_names)
					? p.ticket_option_names
					: [];
				const labels = ids.length
					? ids.map((id) => optionLabelById.get(id) || '')
					: names.map((n) => optionLabelByName.get(n) || n);
				const activities = escape(labels.filter(Boolean).join(', '));
				const comment = escape(p.admin_comment || '');
				const onMailingList = p.email_profile === 'marketing';
				return `
					<tr>
						<td class="num">${index + 1}</td>
						<td class="name">${name}</td>
						<td class="role">${role}</td>
						<td class="ticket-type">${ticketType}</td>
						<td class="activities">${activities}</td>
						<td class="admin-comment">${comment}</td>
						<td class="checkbox"></td>
						<td class="checkbox">${onMailingList ? '✓' : ''}</td>
						<td class="notes"></td>
					</tr>`;
			})
			.join('');

		const html = `<!DOCTYPE html>
<html lang="en">
<head>
	<meta charset="utf-8" />
	<title>${escape(headerTitle)} — ${escape(
			__('Participant list', 'fair-events')
		)}</title>
	<style>
		* { box-sizing: border-box; }
		body {
			font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Helvetica, Arial, sans-serif;
			margin: 24px;
			color: #111;
		}
		header { margin-bottom: 16px; }
		header h1 { margin: 0 0 4px; font-size: 18pt; }
		header .meta { color: #555; font-size: 10pt; }
		table { width: 100%; border-collapse: collapse; font-size: 10pt; }
		th, td {
			border: 1px solid #555;
			padding: 6px 8px;
			vertical-align: top;
			text-align: left;
		}
		th { background: #eee; }
		th.num, td.num { width: 28px; text-align: right; color: #555; }
		td.checkbox { width: 28px; text-align: center; }
		td.notes { min-width: 140px; }
		td.activities, td.admin-comment { width: 14%; }
		td.role, td.ticket-type { width: 11%; }
		td.name { width: 15%; font-weight: 600; }
		tbody tr { page-break-inside: avoid; height: 38px; }
		.toolbar { margin-bottom: 12px; }
		.toolbar button {
			padding: 6px 12px;
			font-size: 11pt;
			cursor: pointer;
		}
		@media print {
			.toolbar { display: none; }
			body { margin: 12mm; }
		}
	</style>
</head>
<body>
	<div class="toolbar">
		<button type="button" onclick="window.print()">${escape(
			__('Print', 'fair-events')
		)}</button>
	</div>
	<header>
		<h1>${escape(headerTitle)}</h1>
		<div class="meta">${escape(__('Participant list', 'fair-events'))} — ${escape(
			dateLabel
		)} (${filteredParticipants.length})</div>
	</header>
	<table>
		<thead>
			<tr>
				<th class="num">#</th>
				<th>${escape(__('Name', 'fair-events'))}</th>
				<th>${escape(__('Role', 'fair-events'))}</th>
				<th>${escape(__('Ticket type', 'fair-events'))}</th>
				<th>${escape(__('Activities', 'fair-events'))}</th>
				<th>${escape(__('Admin comment', 'fair-events'))}</th>
				<th>${escape(__('Present', 'fair-events'))}</th>
				<th>${escape(__('Mailing list', 'fair-events'))}</th>
				<th>${escape(__('Notes', 'fair-events'))}</th>
			</tr>
		</thead>
		<tbody>${rows}</tbody>
	</table>
</body>
</html>`;

		const printWindow = window.open('', '_blank');
		if (!printWindow) {
			showToast(
				__(
					'Could not open print window. Please allow pop-ups.',
					'fair-events'
				),
				'error'
			);
			return;
		}
		printWindow.document.open();
		printWindow.document.write(html);
		printWindow.document.close();
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
				const count = filteredParticipants.filter(
					(p) => participantHasOption(p, opt) && occupiesSeat(p)
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

	const formatExpiredAgo = (iso) => {
		if (!iso) return __('no expiry set', 'fair-events');
		const ts = new Date(iso).getTime();
		if (Number.isNaN(ts)) return iso;
		const diffMs = Date.now() - ts;
		if (diffMs < 0) return new Date(iso).toLocaleString();
		const minutes = Math.floor(diffMs / 60000);
		if (minutes < 60) {
			/* translators: %d: number of minutes */
			return sprintf(__('expired %d min ago', 'fair-events'), minutes);
		}
		const hours = Math.floor(minutes / 60);
		if (hours < 24) {
			/* translators: %d: number of hours */
			return sprintf(__('expired %d h ago', 'fair-events'), hours);
		}
		const days = Math.floor(hours / 24);
		/* translators: %d: number of days */
		return sprintf(__('expired %d d ago', 'fair-events'), days);
	};

	const renderActivitiesForParticipant = (p) => {
		const ids = p.ticket_option_ids || [];
		const names = p.ticket_option_names || [];
		const labels = ticketOptions
			.filter((opt) => ids.includes(opt.id) || names.includes(opt.name))
			.map((opt) => opt.short_name || opt.name);
		return labels.length > 0 ? labels.join(', ') : __('—', 'fair-events');
	};

	return (
		<>
			{eventId && stalePending.length > 0 && (
				<Card style={{ marginTop: '16px' }}>
					<CardHeader>
						<h2>
							{__('Pending review', 'fair-events')}{' '}
							<span
								style={{
									display: 'inline-block',
									marginLeft: '8px',
									padding: '2px 8px',
									borderRadius: '10px',
									backgroundColor: '#fcf0d6',
									color: '#8a6914',
									fontSize: '12px',
									fontWeight: 600,
									verticalAlign: 'middle',
								}}
							>
								{stalePending.length}
							</span>
						</h2>
					</CardHeader>
					<CardBody>
						<p style={{ marginTop: 0 }}>
							{__(
								'These signups had a payment hold that expired. They are not counted toward activity capacity until reviewed. Open a row to confirm (e.g. cash payment promised) or cancel.',
								'fair-events'
							)}
						</p>
						<div style={{ overflowX: 'auto' }}>
							<table className="wp-list-table widefat striped">
								<thead>
									<tr>
										<th>
											{__('Participant', 'fair-events')}
										</th>
										<th>
											{__('Ticket type', 'fair-events')}
										</th>
										<th>
											{__('Activities', 'fair-events')}
										</th>
										<th>{__('Status', 'fair-events')}</th>
										<th />
									</tr>
								</thead>
								<tbody>
									{stalePending.map((p) => (
										<tr key={p.id}>
											<td>{p.participant_name || '—'}</td>
											<td>
												{p.ticket_type_name ||
													__('—', 'fair-events')}
											</td>
											<td>
												{renderActivitiesForParticipant(
													p
												)}
											</td>
											<td>
												{formatExpiredAgo(
													p.payment_expires_at
												)}
											</td>
											<td>
												<Button
													variant="secondary"
													onClick={() =>
														handleOpenEditOptions(p)
													}
												>
													{__(
														'Review',
														'fair-events'
													)}
												</Button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
					</CardBody>
				</Card>
			)}

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
									{stalePending.length > 0 && (
										<span
											style={{
												padding: '2px 8px',
												borderRadius: '10px',
												backgroundColor: '#fcf0d6',
												color: '#8a6914',
												fontSize: '12px',
												fontWeight: 600,
											}}
											title={__(
												'Pending_payment signups whose hold expired. They do not count toward activity capacity until reviewed.',
												'fair-events'
											)}
										>
											{sprintf(
												/* translators: %d: number of stale pending_payment signups */
												__(
													'%d stale held',
													'fair-events'
												),
												stalePending.length
											)}
										</span>
									)}
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
																				(hasOption &&
																				occupiesSeat(
																					p
																				)
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
									<Button
										variant="secondary"
										onClick={handlePrintList}
										disabled={
											filteredParticipants.length === 0
										}
									>
										{__('Print list', 'fair-events')}
									</Button>
									{invitedGroups.length > 0 && (
										<Button
											variant="secondary"
											onClick={() =>
												setInviteModalOpen(true)
											}
										>
											{__(
												'Send Invitations',
												'fair-events'
											)}
										</Button>
									)}
									<Button
										variant="secondary"
										onClick={handleOpenMailingModal}
										disabled={mailingEligible.length === 0}
									>
										{__(
											'Add to mailing list (verbal consent)',
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

			{inviteModalOpen && (
				<Modal
					title={__('Send Invitations', 'fair-events')}
					onRequestClose={() => setInviteModalOpen(false)}
					style={{ maxWidth: '480px', width: '100%' }}
				>
					<VStack spacing={3}>
						<p style={{ margin: 0 }}>
							{__(
								'Send event invitation emails to members of the following groups? Participants who are already signed up will be skipped.',
								'fair-events'
							)}
						</p>
						<ul style={{ margin: 0, paddingLeft: '20px' }}>
							{invitedGroups.map((g) => (
								<li key={g.id}>
									<strong>{g.name}</strong>
									{' — '}
									{sprintf(
										/* translators: %d: number of group members */
										_n(
											'%d member',
											'%d members',
											g.member_count || 0,
											'fair-events'
										),
										g.member_count || 0
									)}
								</li>
							))}
						</ul>
						<p style={{ margin: 0 }}>
							<strong>
								{sprintf(
									/* translators: %d: total number of potential invitees */
									__(
										'Total: up to %d invitations',
										'fair-events'
									),
									totalInvitees
								)}
							</strong>
						</p>
						<HStack
							spacing={3}
							style={{ justifyContent: 'flex-end' }}
						>
							<Button
								variant="secondary"
								onClick={() => setInviteModalOpen(false)}
								disabled={isSendingInvitations}
							>
								{__('Cancel', 'fair-events')}
							</Button>
							<Button
								variant="primary"
								onClick={handleSendInvitations}
								isBusy={isSendingInvitations}
								disabled={
									isSendingInvitations || totalInvitees === 0
								}
							>
								{isSendingInvitations
									? __('Sending…', 'fair-events')
									: __('Send Invitations', 'fair-events')}
							</Button>
						</HStack>
					</VStack>
				</Modal>
			)}

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

			{mailingModalOpen && (
				<Modal
					title={__(
						'Add to mailing list (verbal consent)',
						'fair-events'
					)}
					onRequestClose={handleCloseMailingModal}
					style={{ maxWidth: '640px', width: '100%' }}
				>
					{mailingEligible.length === 0 ? (
						<p>
							{__(
								'No participants are eligible. People are listed here when they have an email address and are not already on the marketing list.',
								'fair-events'
							)}
						</p>
					) : (
						<>
							<p style={{ marginTop: 0, color: '#666' }}>
								{__(
									'Tick the people who gave you their consent in person. They will be added to the marketing list and emailed a welcome message with an unsubscribe link.',
									'fair-events'
								)}
							</p>

							<div
								style={{
									display: 'flex',
									gap: '10px',
									marginBottom: '10px',
									alignItems: 'center',
								}}
							>
								<input
									type="text"
									placeholder={__(
										'Search by name or email…',
										'fair-events'
									)}
									value={mailingSearch}
									onChange={(e) =>
										setMailingSearch(e.target.value)
									}
									style={{
										flex: 1,
										padding: '8px 12px',
										border: '1px solid #ddd',
										borderRadius: '4px',
									}}
								/>
								<Button
									variant="link"
									onClick={handleSelectAllMailing}
									disabled={
										filteredMailingEligible.length === 0
									}
								>
									{filteredMailingEligible.length > 0 &&
									filteredMailingEligible.every((p) =>
										selectedForMailing.has(p.participant_id)
									)
										? __('Deselect all', 'fair-events')
										: __('Select all', 'fair-events')}
								</Button>
							</div>

							<div
								style={{
									marginBottom: '10px',
									fontSize: '12px',
									color: '#666',
								}}
							>
								{sprintf(
									/* translators: 1: selected count, 2: shown count */
									__(
										'%1$d selected, %2$d shown',
										'fair-events'
									),
									selectedForMailing.size,
									filteredMailingEligible.length
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
								{filteredMailingEligible.map((p) => (
									<div
										key={p.participant_id}
										style={{
											padding: '10px 15px',
											borderBottom: '1px solid #eee',
											display: 'flex',
											alignItems: 'center',
											gap: '10px',
										}}
									>
										<CheckboxControl
											checked={selectedForMailing.has(
												p.participant_id
											)}
											onChange={() =>
												handleToggleMailing(
													p.participant_id
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
												{p.participant_email}
											</span>
										</div>
									</div>
								))}
								{filteredMailingEligible.length === 0 && (
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
									onClick={handleCloseMailingModal}
								>
									{__('Cancel', 'fair-events')}
								</Button>
								<Button
									variant="primary"
									onClick={handleUpgradeToMarketing}
									disabled={
										selectedForMailing.size === 0 ||
										isUpgrading
									}
								>
									{isUpgrading
										? __('Adding…', 'fair-events')
										: sprintf(
												/* translators: %d: number of selected participants */
												__(
													'Add %d to mailing list',
													'fair-events'
												),
												selectedForMailing.size
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
						{isStalePendingPayment(editingParticipant) && (
							<div
								style={{
									padding: '12px',
									borderRadius: '4px',
									backgroundColor: '#fcf0d6',
									border: '1px solid #f0c33c',
								}}
							>
								<p
									style={{
										margin: '0 0 8px 0',
										fontWeight: 600,
									}}
								>
									{__(
										'Pending payment hold expired',
										'fair-events'
									)}
								</p>
								<p
									style={{
										margin: '0 0 12px 0',
										fontSize: '13px',
									}}
								>
									{editStaleDecision === 'confirm'
										? __(
												'Will mark as Signed up and count toward activity capacity. Click Save to apply.',
												'fair-events'
										  )
										: editStaleDecision === 'cancel'
										? __(
												'Will mark as Interested and free the seat (record kept for history). Click Save to apply.',
												'fair-events'
										  )
										: __(
												'Pick how to resolve this expired hold, edit any other fields below, then Save to apply everything in one go.',
												'fair-events'
										  )}
								</p>
								<HStack spacing={2}>
									<Button
										variant={
											editStaleDecision === 'confirm'
												? 'primary'
												: 'secondary'
										}
										onClick={() =>
											setEditStaleDecision(
												editStaleDecision === 'confirm'
													? null
													: 'confirm'
											)
										}
									>
										{__('Confirm signup', 'fair-events')}
									</Button>
									<Button
										variant={
											editStaleDecision === 'cancel'
												? 'primary'
												: 'secondary'
										}
										isDestructive={
											editStaleDecision !== 'cancel'
										}
										onClick={() =>
											setEditStaleDecision(
												editStaleDecision === 'cancel'
													? null
													: 'cancel'
											)
										}
									>
										{__('Cancel signup', 'fair-events')}
									</Button>
								</HStack>
							</div>
						)}
						{!isStalePendingPayment(editingParticipant) && (
							<SelectControl
								label={__('Role', 'fair-events')}
								value={editLabel}
								options={[
									{
										label: LABEL_DISPLAY.collaborator,
										value: 'collaborator',
									},
									{
										label: LABEL_DISPLAY.signed_up,
										value: 'signed_up',
									},
									{
										label: LABEL_DISPLAY.interested,
										value: 'interested',
									},
								]}
								onChange={(value) => setEditLabel(value)}
								__nextHasNoMarginBottom
							/>
						)}
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
