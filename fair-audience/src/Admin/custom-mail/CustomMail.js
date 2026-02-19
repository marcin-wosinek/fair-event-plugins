/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect, useRef } from '@wordpress/element';
import {
	Button,
	Card,
	CardBody,
	CardHeader,
	TextControl,
	SelectControl,
	CheckboxControl,
	Notice,
	Spinner,
} from '@wordpress/components';

/**
 * Internal dependencies
 */
import {
	loadCustomMails,
	sendCustomMail,
	loadEventDates,
	deleteCustomMail,
	previewRecipients,
} from './custom-mail-api.js';

/**
 * Custom Mail page component
 *
 * @return {JSX.Element} The custom mail page
 */
export default function CustomMail() {
	const [mails, setMails] = useState([]);
	const [eventDates, setEventDates] = useState([]);
	const [isLoading, setIsLoading] = useState(true);
	const [isSending, setIsSending] = useState(false);
	const [notice, setNotice] = useState(null);

	// Form state.
	const [subject, setSubject] = useState('');
	const [eventDateId, setEventDateId] = useState('');
	const [isMarketing, setIsMarketing] = useState(true);
	const [includeSignedUp, setIncludeSignedUp] = useState(true);
	const [includeCollaborators, setIncludeCollaborators] = useState(true);
	const [includeInterested, setIncludeInterested] = useState(false);

	// Recipient preview state.
	const [recipients, setRecipients] = useState([]);
	const [skippedIds, setSkippedIds] = useState(new Set());
	const [isLoadingRecipients, setIsLoadingRecipients] = useState(false);

	const editorInitialized = useRef(false);

	/**
	 * Load mails and event dates
	 */
	const loadData = () => {
		setIsLoading(true);
		Promise.all([loadCustomMails(), loadEventDates()])
			.then(([mailsData, eventDatesData]) => {
				setMails(mailsData);
				setEventDates(eventDatesData);
				setIsLoading(false);
			})
			.catch((error) => {
				console.error('[Fair Audience] Failed to load data:', error);
				setNotice({
					status: 'error',
					message:
						error.message ||
						__('Failed to load data.', 'fair-audience'),
				});
				setIsLoading(false);
			});
	};

	/**
	 * Load data on mount
	 */
	useEffect(() => {
		loadData();
	}, []);

	/**
	 * Initialize TinyMCE after data loads
	 */
	useEffect(() => {
		if (isLoading || editorInitialized.current) {
			return;
		}

		if (window.wp && window.wp.editor) {
			window.wp.editor.initialize('custom-mail-content', {
				tinymce: {
					toolbar1:
						'bold,italic,bullist,numlist,link,unlink,removeformat',
					plugins: 'lists,link',
					branding: false,
					menubar: false,
					statusbar: false,
				},
				quicktags: true,
				mediaButtons: false,
			});
			editorInitialized.current = true;
		}

		return () => {
			if (window.wp && window.wp.editor && editorInitialized.current) {
				window.wp.editor.remove('custom-mail-content');
				editorInitialized.current = false;
			}
		};
	}, [isLoading]);

	/**
	 * Fetch recipient preview when criteria change
	 */
	useEffect(() => {
		if (isLoading) {
			return;
		}

		const data = {
			is_marketing: isMarketing,
		};

		if (eventDateId) {
			data.event_date_id = parseInt(eventDateId, 10);

			const labels = [];
			if (includeSignedUp) labels.push('signed_up');
			if (includeCollaborators) labels.push('collaborator');
			if (includeInterested) labels.push('interested');
			data.labels = labels;

			if (labels.length === 0) {
				setRecipients([]);
				return;
			}
		}

		setIsLoadingRecipients(true);
		previewRecipients(data)
			.then((result) => {
				setRecipients(result);
				setSkippedIds(new Set());
				setIsLoadingRecipients(false);
			})
			.catch((error) => {
				console.error(
					'[Fair Audience] Failed to load recipients:',
					error
				);
				setRecipients([]);
				setIsLoadingRecipients(false);
			});
	}, [
		isLoading,
		eventDateId,
		isMarketing,
		includeSignedUp,
		includeCollaborators,
		includeInterested,
	]);

	/**
	 * Toggle skip for a participant
	 *
	 * @param {number} participantId Participant ID
	 */
	const toggleSkip = (participantId) => {
		setSkippedIds((prev) => {
			const next = new Set(prev);
			if (next.has(participantId)) {
				next.delete(participantId);
			} else {
				next.add(participantId);
			}
			return next;
		});
	};

	/**
	 * Get content from TinyMCE editor
	 *
	 * @return {string} Editor content
	 */
	const getEditorContent = () => {
		if (window.tinymce) {
			const editor = window.tinymce.get('custom-mail-content');
			if (editor) {
				return editor.getContent();
			}
		}
		const textarea = document.getElementById('custom-mail-content');
		return textarea ? textarea.value : '';
	};

	/**
	 * Clear TinyMCE editor content
	 */
	const clearEditorContent = () => {
		if (window.tinymce) {
			const editor = window.tinymce.get('custom-mail-content');
			if (editor) {
				editor.setContent('');
				return;
			}
		}
		const textarea = document.getElementById('custom-mail-content');
		if (textarea) {
			textarea.value = '';
		}
	};

	/**
	 * Set TinyMCE editor content
	 *
	 * @param {string} content HTML content to set
	 */
	const setEditorContent = (content) => {
		if (window.tinymce) {
			const editor = window.tinymce.get('custom-mail-content');
			if (editor) {
				editor.setContent(content);
				return;
			}
		}
		const textarea = document.getElementById('custom-mail-content');
		if (textarea) {
			textarea.value = content;
		}
	};

	/**
	 * Handle duplicating a mail from history into the form
	 *
	 * @param {Object} mail Mail record
	 */
	const handleDuplicate = (mail) => {
		setSubject(mail.subject);
		setEditorContent(mail.content || '');
		setEventDateId(mail.event_date_id ? String(mail.event_date_id) : '');
		setIsMarketing(mail.is_marketing);
		window.scrollTo({ top: 0, behavior: 'smooth' });
	};

	/**
	 * Handle form submission
	 *
	 * @param {Event} e Form event
	 */
	const handleSubmit = (e) => {
		e.preventDefault();

		if (!subject.trim()) {
			setNotice({
				status: 'error',
				message: __('Please enter a subject.', 'fair-audience'),
			});
			return;
		}

		const content = getEditorContent();
		if (!content || content === '<p></p>' || content === '<br>') {
			setNotice({
				status: 'error',
				message: __('Please enter content.', 'fair-audience'),
			});
			return;
		}

		if (eventDateId) {
			const labels = [];
			if (includeSignedUp) labels.push('signed_up');
			if (includeCollaborators) labels.push('collaborator');
			if (includeInterested) labels.push('interested');

			if (labels.length === 0) {
				setNotice({
					status: 'error',
					message: __(
						'Please select at least one audience type.',
						'fair-audience'
					),
				});
				return;
			}
		}

		setIsSending(true);
		setNotice(null);

		const data = {
			subject: subject.trim(),
			content,
			is_marketing: isMarketing,
			skip_participant_ids: Array.from(skippedIds),
		};

		if (eventDateId) {
			data.event_date_id = parseInt(eventDateId, 10);

			const labels = [];
			if (includeSignedUp) labels.push('signed_up');
			if (includeCollaborators) labels.push('collaborator');
			if (includeInterested) labels.push('interested');
			data.labels = labels;
		}

		sendCustomMail(data)
			.then((result) => {
				const message = [];
				message.push(
					`${result.sent_count} ${__('sent', 'fair-audience')}`
				);
				if (result.failed_count > 0) {
					message.push(
						`${result.failed_count} ${__(
							'failed',
							'fair-audience'
						)}`
					);
				}
				if (result.skipped_count > 0) {
					message.push(
						`${result.skipped_count} ${__(
							'skipped',
							'fair-audience'
						)}`
					);
				}

				setNotice({
					status: 'success',
					message: message.join(', '),
				});
				setSubject('');
				clearEditorContent();
				setEventDateId('');
				loadCustomMails().then(setMails);
				setIsSending(false);
			})
			.catch((error) => {
				console.error('[Fair Audience] Failed to send mail:', error);
				setNotice({
					status: 'error',
					message:
						error.message ||
						__('Failed to send mail.', 'fair-audience'),
				});
				setIsSending(false);
			});
	};

	/**
	 * Handle mail deletion
	 *
	 * @param {number} id Mail ID
	 */
	const handleDelete = (id) => {
		if (
			!confirm(
				__(
					'Are you sure you want to delete this record?',
					'fair-audience'
				)
			)
		) {
			return;
		}

		deleteCustomMail(id)
			.then(() => {
				setNotice({
					status: 'success',
					message: __('Record deleted.', 'fair-audience'),
				});
				loadCustomMails().then(setMails);
			})
			.catch((error) => {
				console.error(
					'[Fair Audience] Failed to delete record:',
					error
				);
				setNotice({
					status: 'error',
					message:
						error.message ||
						__('Failed to delete record.', 'fair-audience'),
				});
			});
	};

	/**
	 * Format date for display
	 *
	 * @param {string} dateString Date string
	 * @return {string} Formatted date
	 */
	const formatDate = (dateString) => {
		if (!dateString) {
			return '-';
		}
		return new Date(dateString).toLocaleString();
	};

	if (isLoading) {
		return (
			<div className="wrap">
				<h1>{__('Custom Mail', 'fair-audience')}</h1>
				<div
					style={{
						display: 'flex',
						justifyContent: 'center',
						padding: '2rem',
					}}
				>
					<Spinner />
				</div>
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1>{__('Custom Mail', 'fair-audience')}</h1>

			{notice && (
				<Notice
					status={notice.status}
					isDismissible
					onDismiss={() => setNotice(null)}
					style={{ marginBottom: '1rem' }}
				>
					{notice.message}
				</Notice>
			)}

			{/* Send Custom Mail Form */}
			<Card style={{ marginBottom: '2rem' }}>
				<CardHeader>
					<h2 style={{ margin: 0 }}>
						{__('Send Custom Mail', 'fair-audience')}
					</h2>
				</CardHeader>
				<CardBody>
					<form onSubmit={handleSubmit}>
						<TextControl
							label={__('Subject', 'fair-audience')}
							value={subject}
							onChange={setSubject}
							disabled={isSending}
						/>

						<div style={{ marginBottom: '16px' }}>
							<label
								htmlFor="custom-mail-content"
								style={{
									display: 'block',
									marginBottom: '8px',
									fontWeight: '600',
								}}
							>
								{__('Content', 'fair-audience')}
							</label>
							<textarea
								id="custom-mail-content"
								rows={10}
								style={{ width: '100%' }}
								disabled={isSending}
							/>
						</div>

						<SelectControl
							label={__('Event', 'fair-audience')}
							value={eventDateId}
							options={[
								{
									label: __(
										'-- All audience --',
										'fair-audience'
									),
									value: '',
								},
								...eventDates.map((ed) => ({
									label: ed.display_label,
									value: String(ed.id),
								})),
							]}
							onChange={setEventDateId}
							disabled={isSending}
						/>

						{eventDateId && (
							<fieldset style={{ marginBottom: '16px' }}>
								<legend
									style={{
										fontWeight: '600',
										marginBottom: '8px',
									}}
								>
									{__('Audience', 'fair-audience')}
								</legend>
								<CheckboxControl
									label={__('Participants', 'fair-audience')}
									checked={includeSignedUp}
									onChange={setIncludeSignedUp}
									disabled={isSending}
								/>
								<CheckboxControl
									label={__('Collaborators', 'fair-audience')}
									checked={includeCollaborators}
									onChange={setIncludeCollaborators}
									disabled={isSending}
								/>
								<CheckboxControl
									label={__('Interested', 'fair-audience')}
									checked={includeInterested}
									onChange={setIncludeInterested}
									disabled={isSending}
								/>
							</fieldset>
						)}

						<CheckboxControl
							label={__('Marketing', 'fair-audience')}
							checked={isMarketing}
							onChange={setIsMarketing}
							help={__(
								'If checked, only sends to participants who consented to marketing communications.',
								'fair-audience'
							)}
							disabled={isSending}
						/>

						{/* Recipient Preview */}
						{isLoadingRecipients && (
							<div
								style={{
									display: 'flex',
									alignItems: 'center',
									gap: '8px',
									marginBottom: '16px',
								}}
							>
								<Spinner />
								<span>
									{__(
										'Loading recipients...',
										'fair-audience'
									)}
								</span>
							</div>
						)}

						{!isLoadingRecipients && recipients.length > 0 && (
							<div style={{ marginBottom: '16px' }}>
								<p>
									<strong>
										{sprintf(
											/* translators: %1$d: active recipients count, %2$d: total count, %3$d: skipped count */
											__(
												'%1$d recipients (%2$d skipped)',
												'fair-audience'
											),
											recipients.filter(
												(r) =>
													!skippedIds.has(
														r.participant_id
													) &&
													r.has_valid_email &&
													!r.would_skip_marketing
											).length,
											recipients.filter(
												(r) =>
													skippedIds.has(
														r.participant_id
													) ||
													!r.has_valid_email ||
													r.would_skip_marketing
											).length
										)}
									</strong>
								</p>
								<table
									className="wp-list-table widefat fixed striped"
									style={{ marginTop: '8px' }}
								>
									<thead>
										<tr>
											<th style={{ width: '60px' }}>
												{__('Skip', 'fair-audience')}
											</th>
											<th>
												{__('Name', 'fair-audience')}
											</th>
											<th>
												{__('Email', 'fair-audience')}
											</th>
											<th style={{ width: '120px' }}>
												{__('Label', 'fair-audience')}
											</th>
											<th style={{ width: '100px' }}>
												{__('Status', 'fair-audience')}
											</th>
										</tr>
									</thead>
									<tbody>
										{recipients.map((r) => {
											const isSkipped = skippedIds.has(
												r.participant_id
											);
											const hasIssue =
												!r.has_valid_email ||
												r.would_skip_marketing;
											return (
												<tr
													key={r.participant_id}
													style={
														isSkipped || hasIssue
															? {
																	opacity: 0.5,
															  }
															: {}
													}
												>
													<td>
														<input
															type="checkbox"
															checked={isSkipped}
															onChange={() =>
																toggleSkip(
																	r.participant_id
																)
															}
															disabled={isSending}
														/>
													</td>
													<td>
														{r.name} {r.surname}
													</td>
													<td>{r.email || '-'}</td>
													<td>{r.label || '-'}</td>
													<td>
														{!r.has_valid_email
															? __(
																	'No email',
																	'fair-audience'
															  )
															: r.would_skip_marketing
															? __(
																	'No marketing',
																	'fair-audience'
															  )
															: isSkipped
															? __(
																	'Skipped',
																	'fair-audience'
															  )
															: __(
																	'Will send',
																	'fair-audience'
															  )}
													</td>
												</tr>
											);
										})}
									</tbody>
								</table>
							</div>
						)}

						{!isLoadingRecipients && recipients.length === 0 && (
							<p
								style={{
									color: '#666',
									marginBottom: '16px',
								}}
							>
								{__('No matching recipients.', 'fair-audience')}
							</p>
						)}

						<Button
							variant="primary"
							type="submit"
							disabled={isSending}
							isBusy={isSending}
						>
							{isSending
								? __('Sending...', 'fair-audience')
								: __('Send Mail', 'fair-audience')}
						</Button>
					</form>
				</CardBody>
			</Card>

			{/* Mail History */}
			<Card>
				<CardHeader>
					<h2 style={{ margin: 0 }}>
						{__('Mail History', 'fair-audience')}
					</h2>
				</CardHeader>
				<CardBody>
					{mails.length === 0 ? (
						<p style={{ color: '#666' }}>
							{__('No messages sent yet.', 'fair-audience')}
						</p>
					) : (
						<table
							className="wp-list-table widefat fixed striped"
							style={{ marginTop: 0 }}
						>
							<thead>
								<tr>
									<th style={{ width: '25%' }}>
										{__('Subject', 'fair-audience')}
									</th>
									<th style={{ width: '20%' }}>
										{__('Event', 'fair-audience')}
									</th>
									<th style={{ width: '8%' }}>
										{__('Sent', 'fair-audience')}
									</th>
									<th style={{ width: '8%' }}>
										{__('Failed', 'fair-audience')}
									</th>
									<th style={{ width: '9%' }}>
										{__('Skipped', 'fair-audience')}
									</th>
									<th style={{ width: '18%' }}>
										{__('Date', 'fair-audience')}
									</th>
									<th style={{ width: '12%' }}>
										{__('Actions', 'fair-audience')}
									</th>
								</tr>
							</thead>
							<tbody>
								{mails.map((mail) => (
									<tr key={mail.id}>
										<td>{mail.subject}</td>
										<td>{mail.event_title || '-'}</td>
										<td>{mail.sent_count}</td>
										<td>{mail.failed_count}</td>
										<td>{mail.skipped_count}</td>
										<td>{formatDate(mail.created_at)}</td>
										<td>
											<Button
												isSmall
												onClick={() =>
													handleDuplicate(mail)
												}
												style={{
													marginRight: '8px',
												}}
											>
												{__(
													'Duplicate',
													'fair-audience'
												)}
											</Button>
											<Button
												isDestructive
												isSmall
												onClick={() =>
													handleDelete(mail.id)
												}
											>
												{__('Delete', 'fair-audience')}
											</Button>
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
