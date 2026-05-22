/**
 * Event Mailings Tab
 *
 * Schedule and manage per-event mailings from the ManageEventApp. Mirrors the
 * custom-mail page UX where it makes sense; scheduled sends intentionally drop
 * the per-send skip list and immediate-send (stated in the form, not hidden).
 * Data is owned by fair-audience and reached over its REST API.
 *
 * @package FairEvents
 */

import { useState, useEffect, useCallback, useMemo } from '@wordpress/element';
import {
	Card,
	CardHeader,
	CardBody,
	Button,
	Spinner,
	Notice,
	TextControl,
	CheckboxControl,
	ToggleControl,
	FormTokenField,
	Modal,
	__experimentalVStack as VStack,
	__experimentalHStack as HStack,
} from '@wordpress/components';
import { __, sprintf } from '@wordpress/i18n';
import MailBodyEditor from './MailBodyEditor.js';
import AnchorOffsetPicker, {
	toOffsetMinutes,
	fromOffsetMinutes,
} from './AnchorOffsetPicker.js';
import {
	loadScheduledMessages,
	loadEventDates,
	loadGroups,
	createScheduledMessage,
	updateScheduledMessage,
	cancelScheduledMessage,
	previewDraftRecipients,
} from './mailings-api.js';

const LABEL_OPTIONS = [
	{ key: 'signed_up', label: __('Registered', 'fair-events') },
	{ key: 'interested', label: __('Interested', 'fair-events') },
	{ key: 'collaborator', label: __('Collaborators', 'fair-events') },
];

const STATUS_COLORS = {
	scheduled: '#2271b1',
	sending: '#dba617',
	sent: '#00a32a',
	canceled: '#757575',
	failed: '#d63638',
};

const emptyForm = (defaultAnchorRefId) => ({
	editingId: null,
	subject: '',
	body: '',
	anchorType: 'event_date_start',
	anchorRefId: defaultAnchorRefId,
	offsetValue: 1,
	offsetUnit: 'days',
	direction: 'before',
	labels: { signed_up: true, interested: false, collaborator: false },
	groupIds: [],
	isMarketing: false,
});

/**
 * Mailings tab.
 *
 * @param {Object} props             Component props.
 * @param {number} props.eventId      Event post ID.
 * @param {number} props.eventDateId  The event date currently being managed.
 * @return {JSX.Element} The tab.
 */
export default function EventMailings({ eventId, eventDateId }) {
	const [messages, setMessages] = useState([]);
	const [eventDates, setEventDates] = useState([]);
	const [groups, setGroups] = useState([]);
	const [loading, setLoading] = useState(true);
	const [notice, setNotice] = useState(null);
	const [isSaving, setIsSaving] = useState(false);

	const [form, setForm] = useState(emptyForm(eventDateId));

	const [recipientCount, setRecipientCount] = useState(null);
	const [recipientList, setRecipientList] = useState([]);
	const [showRecipients, setShowRecipients] = useState(false);

	const [cancelTarget, setCancelTarget] = useState(null);
	const [detailMessage, setDetailMessage] = useState(null);

	const updateForm = useCallback((patch) => {
		setForm((prev) => ({ ...prev, ...patch }));
	}, []);

	const reloadMessages = useCallback(() => {
		return loadScheduledMessages(eventId).then(setMessages);
	}, [eventId]);

	// Initial data load.
	useEffect(() => {
		let active = true;
		Promise.all([
			loadScheduledMessages(eventId),
			loadEventDates(eventId),
			loadGroups().catch(() => []),
		])
			.then(([msgs, dates, grps]) => {
				if (!active) {
					return;
				}
				setMessages(msgs);
				setEventDates(dates);
				setGroups(grps);
				// Default the anchor to the managed date when present.
				const hasManaged = dates.some((d) => d.id === eventDateId);
				const fallback = dates.length > 0 ? dates[0].id : eventDateId;
				updateForm({
					anchorRefId: hasManaged ? eventDateId : fallback,
				});
			})
			.catch(() => {
				if (active) {
					setNotice({
						status: 'error',
						message: __('Could not load mailings.', 'fair-events'),
					});
				}
			})
			.finally(() => active && setLoading(false));
		return () => {
			active = false;
		};
	}, [eventId, eventDateId, updateForm]);

	const selectedLabels = useMemo(
		() => LABEL_OPTIONS.filter((o) => form.labels[o.key]).map((o) => o.key),
		[form.labels]
	);

	const recipientsFilter = useMemo(
		() => ({
			labels: selectedLabels,
			group_ids: form.groupIds,
			is_marketing: form.isMarketing,
		}),
		[selectedLabels, form.groupIds, form.isMarketing]
	);

	// Live recipient preview (debounced) whenever the filter changes.
	useEffect(() => {
		if (selectedLabels.length === 0) {
			setRecipientCount(0);
			setRecipientList([]);
			return undefined;
		}
		const handle = setTimeout(() => {
			previewDraftRecipients(eventId, recipientsFilter)
				.then((list) => {
					setRecipientCount(list.length);
					setRecipientList(list);
				})
				.catch(() => {
					setRecipientCount(null);
					setRecipientList([]);
				});
		}, 400);
		return () => clearTimeout(handle);
	}, [eventId, recipientsFilter, selectedLabels.length]);

	const resetForm = useCallback(() => {
		const hasManaged = eventDates.some((d) => d.id === eventDateId);
		const fallback = eventDates.length > 0 ? eventDates[0].id : eventDateId;
		setForm(emptyForm(hasManaged ? eventDateId : fallback));
	}, [eventDates, eventDateId]);

	const startEdit = (message) => {
		const decomposed = fromOffsetMinutes(message.offset_minutes);
		const filter = message.recipients_filter || {};
		const filterLabels = filter.labels || [];
		setForm({
			editingId: message.id,
			subject: message.subject,
			body: message.body,
			anchorType: message.anchor_type,
			anchorRefId: message.anchor_ref_id || message.event_date_id,
			offsetValue: decomposed.value,
			offsetUnit: decomposed.unit,
			direction: decomposed.direction,
			labels: {
				signed_up: filterLabels.includes('signed_up'),
				interested: filterLabels.includes('interested'),
				collaborator: filterLabels.includes('collaborator'),
			},
			groupIds: filter.group_ids || [],
			isMarketing: !!filter.is_marketing,
		});
		window.scrollTo({ top: 0, behavior: 'smooth' });
	};

	const duplicate = (message) => {
		startEdit(message);
		updateForm({ editingId: null });
	};

	const handleSubmit = (e) => {
		e.preventDefault();
		if (!form.subject.trim()) {
			setNotice({
				status: 'error',
				message: __('Please enter a subject.', 'fair-events'),
			});
			return;
		}
		if (!form.body.trim()) {
			setNotice({
				status: 'error',
				message: __('Please enter a body.', 'fair-events'),
			});
			return;
		}
		if (selectedLabels.length === 0) {
			setNotice({
				status: 'error',
				message: __(
					'Please select at least one recipient type.',
					'fair-events'
				),
			});
			return;
		}

		const payload = {
			subject: form.subject.trim(),
			body: form.body,
			anchor_type: form.anchorType,
			anchor_ref_id: form.anchorRefId,
			offset_minutes: toOffsetMinutes(
				form.offsetValue,
				form.offsetUnit,
				form.direction
			),
			recipients_filter: recipientsFilter,
		};

		setIsSaving(true);
		setNotice(null);
		const request = form.editingId
			? updateScheduledMessage(form.editingId, payload)
			: createScheduledMessage(eventId, payload);

		request
			.then(() => reloadMessages())
			.then(() => {
				setNotice({
					status: 'success',
					message: form.editingId
						? __('Mailing updated.', 'fair-events')
						: __('Mailing scheduled.', 'fair-events'),
				});
				resetForm();
			})
			.catch((err) => {
				setNotice({
					status: 'error',
					message:
						err?.message ||
						__('Could not save the mailing.', 'fair-events'),
				});
			})
			.finally(() => setIsSaving(false));
	};

	const confirmCancel = () => {
		const id = cancelTarget.id;
		setCancelTarget(null);
		cancelScheduledMessage(id)
			.then(() => reloadMessages())
			.then(() =>
				setNotice({
					status: 'success',
					message: __('Mailing canceled.', 'fair-events'),
				})
			)
			.catch(() =>
				setNotice({
					status: 'error',
					message: __('Could not cancel the mailing.', 'fair-events'),
				})
			);
	};

	if (loading) {
		return (
			<Card style={{ marginTop: '16px' }}>
				<CardBody>
					<Spinner />
				</CardBody>
			</Card>
		);
	}

	const groupNameById = (id) => {
		const match = groups.find((g) => g.id === id);
		return match ? match.name : String(id);
	};
	const groupIdByName = (name) => {
		const match = groups.find((g) => g.name === name);
		return match ? match.id : null;
	};

	return (
		<>
			{notice && (
				<Notice
					status={notice.status}
					onRemove={() => setNotice(null)}
					style={{ marginTop: '16px' }}
				>
					{notice.message}
				</Notice>
			)}

			{/* Schedule / edit form */}
			<Card style={{ marginTop: '16px', marginBottom: '24px' }}>
				<CardHeader>
					<h2 style={{ margin: 0 }}>
						{form.editingId
							? __('Edit scheduled mailing', 'fair-events')
							: __('Schedule new mailing', 'fair-events')}
					</h2>
				</CardHeader>
				<CardBody>
					<form onSubmit={handleSubmit}>
						<TextControl
							label={__('Subject', 'fair-events')}
							value={form.subject}
							onChange={(value) => updateForm({ subject: value })}
							disabled={isSaving}
							__nextHasNoMarginBottom
						/>

						<MailBodyEditor
							value={form.body}
							onChange={(value) => updateForm({ body: value })}
							disabled={isSaving}
						/>

						<AnchorOffsetPicker
							eventDates={eventDates}
							anchorType={form.anchorType}
							anchorRefId={form.anchorRefId}
							offsetValue={form.offsetValue}
							offsetUnit={form.offsetUnit}
							direction={form.direction}
							onChange={updateForm}
							disabled={isSaving}
						/>

						<fieldset style={{ marginBottom: '16px' }}>
							<legend style={{ fontWeight: 600 }}>
								{__('Recipients', 'fair-events')}
							</legend>
							{LABEL_OPTIONS.map((opt) => (
								<CheckboxControl
									key={opt.key}
									label={opt.label}
									checked={form.labels[opt.key]}
									onChange={(checked) =>
										updateForm({
											labels: {
												...form.labels,
												[opt.key]: checked,
											},
										})
									}
									disabled={isSaving}
									__nextHasNoMarginBottom
								/>
							))}

							{groups.length > 0 && (
								<div style={{ marginTop: '8px' }}>
									<FormTokenField
										label={__(
											'Limit to groups (optional)',
											'fair-events'
										)}
										value={form.groupIds.map(groupNameById)}
										suggestions={groups.map((g) => g.name)}
										onChange={(names) =>
											updateForm({
												groupIds: names
													.map(groupIdByName)
													.filter(Boolean),
											})
										}
										__nextHasNoMarginBottom
									/>
								</div>
							)}

							<ToggleControl
								label={__(
									'Marketing email (respect opt-out)',
									'fair-events'
								)}
								checked={form.isMarketing}
								onChange={(checked) =>
									updateForm({ isMarketing: checked })
								}
								disabled={isSaving}
								__nextHasNoMarginBottom
							/>

							<p style={{ color: '#666', marginTop: '4px' }}>
								{recipientCount === null
									? __(
											'Recipient count unavailable.',
											'fair-events'
									  )
									: sprintf(
											/* translators: %d: recipient count */
											__(
												'%d recipient(s) match right now.',
												'fair-events'
											),
											recipientCount
									  )}{' '}
								{recipientList.length > 0 && (
									<Button
										variant="link"
										onClick={() =>
											setShowRecipients((v) => !v)
										}
									>
										{showRecipients
											? __('Hide list', 'fair-events')
											: __('View list', 'fair-events')}
									</Button>
								)}
							</p>

							{showRecipients && recipientList.length > 0 && (
								<ul
									style={{
										maxHeight: '160px',
										overflow: 'auto',
										border: '1px solid #ddd',
										padding: '8px 12px',
										margin: 0,
									}}
								>
									{recipientList.map((r) => (
										<li key={r.participant_id}>
											{r.name} {r.surname} &lt;
											{r.email ||
												__('no email', 'fair-events')}
											&gt;
											{r.would_skip_marketing &&
												` — ${__(
													'will skip (opted out)',
													'fair-events'
												)}`}
										</li>
									))}
								</ul>
							)}
						</fieldset>

						<p style={{ color: '#757575', fontStyle: 'italic' }}>
							{__(
								'Scheduled mailings send automatically at the computed time. There is no per-send skip list or immediate send here — use the Custom Mail page for ad-hoc sends.',
								'fair-events'
							)}
						</p>

						<HStack justify="flex-start" spacing={3}>
							<Button
								variant="primary"
								type="submit"
								isBusy={isSaving}
								disabled={isSaving}
							>
								{form.editingId
									? __('Update mailing', 'fair-events')
									: __('Schedule mailing', 'fair-events')}
							</Button>
							{form.editingId && (
								<Button
									variant="tertiary"
									onClick={resetForm}
									disabled={isSaving}
								>
									{__('Cancel edit', 'fair-events')}
								</Button>
							)}
						</HStack>
					</form>
				</CardBody>
			</Card>

			{/* Existing mailings */}
			<Card>
				<CardHeader>
					<h2 style={{ margin: 0 }}>
						{__('Scheduled & past mailings', 'fair-events')}
					</h2>
				</CardHeader>
				<CardBody>
					{messages.length === 0 ? (
						<p>{__('No mailings yet.', 'fair-events')}</p>
					) : (
						<VStack spacing={3}>
							{messages.map((m) => (
								<div
									key={m.id}
									style={{
										borderBottom: '1px solid #eee',
										paddingBottom: '12px',
									}}
								>
									<HStack justify="space-between">
										<strong>{m.subject}</strong>
										<span
											style={{
												color:
													STATUS_COLORS[m.status] ||
													'#333',
												fontWeight: 600,
												textTransform: 'capitalize',
											}}
										>
											{m.status}
										</span>
									</HStack>
									<div
										style={{
											color: '#666',
											fontSize: '13px',
										}}
									>
										{m.scheduled_for
											? sprintf(
													/* translators: %s: send date/time */
													__(
														'Sends: %s',
														'fair-events'
													),
													m.scheduled_for
											  )
											: __(
													'Send time pending',
													'fair-events'
											  )}
										{m.status === 'sent' &&
											sprintf(
												/* translators: 1: sent, 2: failed, 3: skipped */
												__(
													' · sent %1$d, failed %2$d, skipped %3$d',
													'fair-events'
												),
												m.sent_count,
												m.failed_count,
												m.skipped_count
											)}
									</div>

									<HStack
										justify="flex-start"
										spacing={2}
										style={{ marginTop: '6px' }}
									>
										{m.status === 'scheduled' && (
											<>
												<Button
													variant="secondary"
													isSmall
													onClick={() => startEdit(m)}
												>
													{__('Edit', 'fair-events')}
												</Button>
												<Button
													variant="tertiary"
													isSmall
													isDestructive
													onClick={() =>
														setCancelTarget(m)
													}
												>
													{__(
														'Cancel',
														'fair-events'
													)}
												</Button>
											</>
										)}
										{(m.status === 'sent' ||
											m.status === 'failed' ||
											m.status === 'canceled') && (
											<Button
												variant="secondary"
												isSmall
												onClick={() =>
													setDetailMessage(m)
												}
											>
												{__('View', 'fair-events')}
											</Button>
										)}
										{m.status === 'failed' && (
											<Button
												variant="tertiary"
												isSmall
												onClick={() => duplicate(m)}
											>
												{__('Duplicate', 'fair-events')}
											</Button>
										)}
									</HStack>
								</div>
							))}
						</VStack>
					)}
				</CardBody>
			</Card>

			{cancelTarget && (
				<Modal
					title={__('Cancel mailing?', 'fair-events')}
					onRequestClose={() => setCancelTarget(null)}
				>
					<p>
						{sprintf(
							/* translators: %s: mailing subject */
							__(
								'Cancel the scheduled mailing "%s"? It will not be sent.',
								'fair-events'
							),
							cancelTarget.subject
						)}
					</p>
					<HStack justify="flex-end" spacing={3}>
						<Button
							variant="tertiary"
							onClick={() => setCancelTarget(null)}
						>
							{__('Keep it', 'fair-events')}
						</Button>
						<Button
							variant="primary"
							isDestructive
							onClick={confirmCancel}
						>
							{__('Cancel mailing', 'fair-events')}
						</Button>
					</HStack>
				</Modal>
			)}

			{detailMessage && (
				<Modal
					title={detailMessage.subject}
					onRequestClose={() => setDetailMessage(null)}
				>
					<p style={{ color: '#666' }}>
						{sprintf(
							/* translators: 1: status, 2: send time */
							__('Status: %1$s · %2$s', 'fair-events'),
							detailMessage.status,
							detailMessage.sent_at ||
								detailMessage.scheduled_for ||
								''
						)}
					</p>
					{detailMessage.status === 'sent' && (
						<p>
							{sprintf(
								/* translators: 1: sent, 2: failed, 3: skipped */
								__(
									'Sent %1$d · failed %2$d · skipped %3$d',
									'fair-events'
								),
								detailMessage.sent_count,
								detailMessage.failed_count,
								detailMessage.skipped_count
							)}
						</p>
					)}
					{detailMessage.last_error && (
						<Notice status="error" isDismissible={false}>
							{detailMessage.last_error}
						</Notice>
					)}
					<div
						style={{
							border: '1px solid #ddd',
							padding: '12px',
							marginTop: '12px',
							maxHeight: '300px',
							overflow: 'auto',
						}}
						// eslint-disable-next-line react/no-danger
						dangerouslySetInnerHTML={{ __html: detailMessage.body }}
					/>
				</Modal>
			)}
		</>
	);
}
