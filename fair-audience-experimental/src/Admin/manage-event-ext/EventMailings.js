/**
 * Event Mailings Tab
 *
 * Schedule and manage per-event mailings, registered as a tab on fair-events'
 * ManageEventApp via the fairEvents.manageEvent.tabs filter. Mirrors the
 * custom-mail page UX where it makes sense; scheduled sends intentionally drop
 * the per-send skip list and immediate-send (stated in the form, not hidden).
 *
 * @package FairAudience
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
	loadGroups,
	createScheduledMessage,
	updateScheduledMessage,
	cancelScheduledMessage,
	previewDraftRecipients,
} from './mailings-api.js';

const LABEL_OPTIONS = [
	{ key: 'signed_up', label: __('Registered', 'fair-audience-experimental') },
	{
		key: 'interested',
		label: __('Interested', 'fair-audience-experimental'),
	},
	{
		key: 'collaborator',
		label: __('Collaborators', 'fair-audience-experimental'),
	},
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
 * Mailings are scoped to the single event date being managed; the anchor is
 * always that date (start or end), so there is no cross-date picker.
 *
 * @param {Object} props               Component props.
 * @param {number} props.eventDateId    The event date being managed.
 * @param {string} props.startDatetime  The date's start datetime (for the send-time preview).
 * @param {string} props.endDatetime    The date's end datetime (for the send-time preview).
 * @param {boolean} props.allDay         Whether the date is all-day.
 * @return {JSX.Element} The tab.
 */
export default function EventMailings({
	eventDateId,
	startDatetime,
	endDatetime,
	allDay,
}) {
	const [messages, setMessages] = useState([]);
	const [groups, setGroups] = useState([]);
	const [loading, setLoading] = useState(true);
	const [notice, setNotice] = useState(null);
	const [isSaving, setIsSaving] = useState(false);

	// The single date this tab manages, shaped for AnchorOffsetPicker. With one
	// entry the picker hides its "which date" dropdown and just uses it for the
	// send-time preview.
	const eventDates = useMemo(
		() => [
			{
				id: eventDateId,
				start_datetime: startDatetime,
				end_datetime: endDatetime,
				all_day: allDay,
			},
		],
		[eventDateId, startDatetime, endDatetime, allDay]
	);

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
		return loadScheduledMessages(eventDateId).then(setMessages);
	}, [eventDateId]);

	// Initial data load.
	useEffect(() => {
		let active = true;
		Promise.all([
			loadScheduledMessages(eventDateId),
			loadGroups().catch(() => []),
		])
			.then(([msgs, grps]) => {
				if (!active) {
					return;
				}
				setMessages(msgs);
				setGroups(grps);
			})
			.catch(() => {
				if (active) {
					setNotice({
						status: 'error',
						message: __(
							'Could not load mailings.',
							'fair-audience-experimental'
						),
					});
				}
			})
			.finally(() => active && setLoading(false));
		return () => {
			active = false;
		};
	}, [eventDateId]);

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
			previewDraftRecipients(eventDateId, recipientsFilter)
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
	}, [eventDateId, recipientsFilter, selectedLabels.length]);

	const resetForm = useCallback(() => {
		setForm(emptyForm(eventDateId));
	}, [eventDateId]);

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
				message: __(
					'Please enter a subject.',
					'fair-audience-experimental'
				),
			});
			return;
		}
		if (!form.body.trim()) {
			setNotice({
				status: 'error',
				message: __(
					'Please enter a body.',
					'fair-audience-experimental'
				),
			});
			return;
		}
		if (selectedLabels.length === 0) {
			setNotice({
				status: 'error',
				message: __(
					'Please select at least one recipient type.',
					'fair-audience-experimental'
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
			: createScheduledMessage(eventDateId, payload);

		request
			.then(() => reloadMessages())
			.then(() => {
				setNotice({
					status: 'success',
					message: form.editingId
						? __('Mailing updated.', 'fair-audience-experimental')
						: __(
								'Mailing scheduled.',
								'fair-audience-experimental'
						  ),
				});
				resetForm();
			})
			.catch((err) => {
				setNotice({
					status: 'error',
					message:
						err?.message ||
						__(
							'Could not save the mailing.',
							'fair-audience-experimental'
						),
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
					message: __(
						'Mailing canceled.',
						'fair-audience-experimental'
					),
				})
			)
			.catch(() =>
				setNotice({
					status: 'error',
					message: __(
						'Could not cancel the mailing.',
						'fair-audience-experimental'
					),
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
							? __(
									'Edit scheduled mailing',
									'fair-audience-experimental'
							  )
							: __(
									'Schedule new mailing',
									'fair-audience-experimental'
							  )}
					</h2>
				</CardHeader>
				<CardBody>
					<form onSubmit={handleSubmit}>
						<TextControl
							label={__('Subject', 'fair-audience-experimental')}
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
								{__('Recipients', 'fair-audience-experimental')}
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
											'fair-audience-experimental'
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
									'fair-audience-experimental'
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
											'fair-audience-experimental'
									  )
									: sprintf(
											/* translators: %d: recipient count */
											__(
												'%d recipient(s) match right now.',
												'fair-audience-experimental'
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
											? __(
													'Hide list',
													'fair-audience-experimental'
											  )
											: __(
													'View list',
													'fair-audience-experimental'
											  )}
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
												__(
													'no email',
													'fair-audience-experimental'
												)}
											&gt;
											{r.would_skip_marketing &&
												` — ${__(
													'will skip (opted out)',
													'fair-audience-experimental'
												)}`}
										</li>
									))}
								</ul>
							)}
						</fieldset>

						<p style={{ color: '#757575', fontStyle: 'italic' }}>
							{__(
								'Scheduled mailings send automatically at the computed time. There is no per-send skip list or immediate send here — use the Custom Mail page for ad-hoc sends.',
								'fair-audience-experimental'
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
									? __(
											'Update mailing',
											'fair-audience-experimental'
									  )
									: __(
											'Schedule mailing',
											'fair-audience-experimental'
									  )}
							</Button>
							{form.editingId && (
								<Button
									variant="tertiary"
									onClick={resetForm}
									disabled={isSaving}
								>
									{__(
										'Cancel edit',
										'fair-audience-experimental'
									)}
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
						{__(
							'Scheduled & past mailings',
							'fair-audience-experimental'
						)}
					</h2>
				</CardHeader>
				<CardBody>
					{messages.length === 0 ? (
						<p>
							{__(
								'No mailings yet.',
								'fair-audience-experimental'
							)}
						</p>
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
														'fair-audience-experimental'
													),
													m.scheduled_for
											  )
											: __(
													'Send time pending',
													'fair-audience-experimental'
											  )}
										{m.status === 'sent' &&
											sprintf(
												/* translators: 1: sent, 2: failed, 3: skipped */
												__(
													' · sent %1$d, failed %2$d, skipped %3$d',
													'fair-audience-experimental'
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
													{__(
														'Edit',
														'fair-audience-experimental'
													)}
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
														'fair-audience-experimental'
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
												{__(
													'View',
													'fair-audience-experimental'
												)}
											</Button>
										)}
										{m.status === 'failed' && (
											<Button
												variant="tertiary"
												isSmall
												onClick={() => duplicate(m)}
											>
												{__(
													'Duplicate',
													'fair-audience-experimental'
												)}
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
					title={__('Cancel mailing?', 'fair-audience-experimental')}
					onRequestClose={() => setCancelTarget(null)}
				>
					<p>
						{sprintf(
							/* translators: %s: mailing subject */
							__(
								'Cancel the scheduled mailing "%s"? It will not be sent.',
								'fair-audience-experimental'
							),
							cancelTarget.subject
						)}
					</p>
					<HStack justify="flex-end" spacing={3}>
						<Button
							variant="tertiary"
							onClick={() => setCancelTarget(null)}
						>
							{__('Keep it', 'fair-audience-experimental')}
						</Button>
						<Button
							variant="primary"
							isDestructive
							onClick={confirmCancel}
						>
							{__('Cancel mailing', 'fair-audience-experimental')}
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
							__(
								'Status: %1$s · %2$s',
								'fair-audience-experimental'
							),
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
									'fair-audience-experimental'
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
