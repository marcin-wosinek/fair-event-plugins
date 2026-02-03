import { __, sprintf } from '@wordpress/i18n';
import { useState, useEffect } from '@wordpress/element';
import apiFetch from '@wordpress/api-fetch';
import {
	Button,
	TextControl,
	TextareaControl,
	SelectControl,
	Spinner,
	Notice,
} from '@wordpress/components';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';

export default function EditPoll() {
	const [isLoading, setIsLoading] = useState(true);
	const [isSaving, setIsSaving] = useState(false);
	const [isSendingInvitations, setIsSendingInvitations] = useState(false);
	const [isGeneratingPDF, setIsGeneratingPDF] = useState(false);
	const [error, setError] = useState(null);
	const [sendResult, setSendResult] = useState(null);
	const [events, setEvents] = useState([]);
	const [pollId, setPollId] = useState(null);
	const [pollStats, setPollStats] = useState(null);
	const [formData, setFormData] = useState({
		event_id: '',
		title: '',
		question: '',
		status: 'draft',
		options: [{ text: '', order: 0 }],
	});

	useEffect(() => {
		loadData();
	}, []);

	const loadData = async () => {
		// Get poll_id from URL if editing
		const urlParams = new URLSearchParams(window.location.search);
		const id = urlParams.get('poll_id');

		try {
			// Load events
			const eventsResponse = await apiFetch({
				path: '/fair-audience/v1/events',
			});
			setEvents(eventsResponse);

			// Load poll if editing
			if (id) {
				const pollResponse = await apiFetch({
					path: `/fair-audience/v1/polls/${id}`,
				});
				setPollId(id);
				setPollStats(pollResponse.stats);
				setFormData({
					event_id: pollResponse.event_id.toString(),
					title: pollResponse.title,
					question: pollResponse.question,
					status: pollResponse.status,
					options: pollResponse.options.map((opt) => ({
						text: opt.text,
						order: opt.order,
					})),
				});
			}

			setIsLoading(false);
		} catch (err) {
			setError(err.message);
			setIsLoading(false);
		}
	};

	const handleAddOption = () => {
		setFormData({
			...formData,
			options: [
				...formData.options,
				{ text: '', order: formData.options.length },
			],
		});
	};

	const handleRemoveOption = (index) => {
		const newOptions = formData.options.filter((_, i) => i !== index);
		// Re-index order
		newOptions.forEach((opt, i) => {
			opt.order = i;
		});
		setFormData({ ...formData, options: newOptions });
	};

	const handleOptionChange = (index, value) => {
		const newOptions = [...formData.options];
		newOptions[index].text = value;
		setFormData({ ...formData, options: newOptions });
	};

	const handleMoveUp = (index) => {
		if (index === 0) return;
		const newOptions = [...formData.options];
		[newOptions[index - 1], newOptions[index]] = [
			newOptions[index],
			newOptions[index - 1],
		];
		// Re-index order
		newOptions.forEach((opt, i) => {
			opt.order = i;
		});
		setFormData({ ...formData, options: newOptions });
	};

	const handleMoveDown = (index) => {
		if (index === formData.options.length - 1) return;
		const newOptions = [...formData.options];
		[newOptions[index], newOptions[index + 1]] = [
			newOptions[index + 1],
			newOptions[index],
		];
		// Re-index order
		newOptions.forEach((opt, i) => {
			opt.order = i;
		});
		setFormData({ ...formData, options: newOptions });
	};

	const handleSubmit = async () => {
		// Validate
		if (!formData.event_id) {
			alert(__('Please select an event.', 'fair-audience'));
			return;
		}
		if (!formData.title) {
			alert(__('Please enter a title.', 'fair-audience'));
			return;
		}
		if (!formData.question) {
			alert(__('Please enter a question.', 'fair-audience'));
			return;
		}
		if (formData.options.length === 0) {
			alert(__('Please add at least one option.', 'fair-audience'));
			return;
		}
		// Check all options have text
		const emptyOptions = formData.options.some((opt) => !opt.text.trim());
		if (emptyOptions) {
			alert(
				__(
					'Please fill in all option texts or remove empty options.',
					'fair-audience'
				)
			);
			return;
		}

		setIsSaving(true);
		setError(null);

		try {
			const method = pollId ? 'PUT' : 'POST';
			const path = pollId
				? `/fair-audience/v1/polls/${pollId}`
				: '/fair-audience/v1/polls';

			await apiFetch({
				path,
				method,
				data: {
					event_id: parseInt(formData.event_id),
					title: formData.title,
					question: formData.question,
					status: formData.status,
					options: formData.options,
				},
			});

			// Redirect back to polls list
			window.location.href = 'admin.php?page=fair-audience-polls';
		} catch (err) {
			setError(err.message);
			setIsSaving(false);
		}
	};

	const handleSendInvitations = async () => {
		if (
			!confirm(
				__(
					'Send poll invitations to all event participants who have not yet responded?',
					'fair-audience'
				)
			)
		) {
			return;
		}

		setIsSendingInvitations(true);
		setError(null);
		setSendResult(null);

		try {
			const response = await apiFetch({
				path: `/fair-audience/v1/polls/${pollId}/send-invitations`,
				method: 'POST',
			});

			setSendResult({
				type: 'success',
				sent_count: response.sent_count,
				failed: response.failed,
			});

			// Reload poll data to get updated statistics
			const pollResponse = await apiFetch({
				path: `/fair-audience/v1/polls/${pollId}`,
			});
			setPollStats(pollResponse.stats);
		} catch (err) {
			setError(err.message);
		} finally {
			setIsSendingInvitations(false);
		}
	};

	const handleGeneratePDF = async () => {
		setIsGeneratingPDF(true);
		setError(null);

		try {
			// Fetch poll results
			const resultsData = await apiFetch({
				path: `/fair-audience/v1/polls/${pollId}/results`,
			});

			// Create PDF
			const doc = new jsPDF('landscape');

			// Add title
			doc.setFontSize(16);
			doc.text(resultsData.poll.title, 14, 15);
			doc.setFontSize(12);
			doc.text(resultsData.poll.question, 14, 22);

			// Prepare table headers
			const headers = [
				__('Name', 'fair-audience'),
				__('Surname', 'fair-audience'),
			];

			// Add option names as columns
			resultsData.options.forEach((option) => {
				headers.push(option.text);
			});

			// Add Comments column at the end
			headers.push(__('Comments', 'fair-audience'));

			// Prepare table data
			const rows = resultsData.participants.map((participant) => {
				const row = [participant.name, participant.surname];

				// Add checkmarks for selected options
				resultsData.options.forEach((option) => {
					const isSelected = participant.selected_options.includes(
						option.id
					);
					row.push(isSelected ? __('Yes', 'fair-audience') : '');
				});

				// Add empty Comments column
				row.push('');

				return row;
			});

			// Build columnStyles with auto width for all columns except Comments
			const columnStyles = {};
			const totalColumns = headers.length;
			const commentsColumnIndex = totalColumns - 1;

			// Set all columns (except Comments) to auto width
			for (let i = 0; i < commentsColumnIndex; i++) {
				columnStyles[i] = { cellWidth: 'auto' };
			}

			// Generate table
			autoTable(doc, {
				head: [headers],
				body: rows,
				startY: 30,
				theme: 'grid',
				styles: {
					fontSize: 10,
					cellPadding: 3,
				},
				headStyles: {
					fillColor: [0, 115, 170],
					fontStyle: 'bold',
				},
				columnStyles: columnStyles,
			});

			// Save PDF
			const filename = `poll-results-${
				resultsData.poll.id
			}-${Date.now()}.pdf`;
			doc.save(filename);
		} catch (err) {
			setError(err.message);
		} finally {
			setIsGeneratingPDF(false);
		}
	};

	if (isLoading) {
		return (
			<div className="wrap">
				<h1>
					{pollId
						? __('Edit Poll', 'fair-audience')
						: __('Add New Poll', 'fair-audience')}
				</h1>
				<Spinner />
			</div>
		);
	}

	return (
		<div className="wrap">
			<h1>
				{pollId
					? __('Edit Poll', 'fair-audience')
					: __('Add New Poll', 'fair-audience')}
			</h1>

			{error && (
				<div className="notice notice-error">
					<p>{error}</p>
				</div>
			)}

			{sendResult && sendResult.type === 'success' && (
				<Notice
					status="success"
					isDismissible={true}
					onRemove={() => setSendResult(null)}
				>
					<p>
						<strong>
							{sprintf(
								/* translators: %d: number of participants who received invitations */
								__(
									'Invitations sent to %d participants',
									'fair-audience'
								),
								sendResult.sent_count
							)}
						</strong>
					</p>
					{sendResult.failed && sendResult.failed.length > 0 && (
						<>
							<p>{__('Failed to send to:', 'fair-audience')}</p>
							<ul>
								{sendResult.failed.map((fail, index) => (
									<li key={index}>
										{fail.email}: {fail.reason}
									</li>
								))}
							</ul>
						</>
					)}
				</Notice>
			)}

			{pollId && pollStats && (
				<div
					style={{
						marginTop: '20px',
						backgroundColor: '#ffffff',
						border: '1px solid #ddd',
						borderRadius: '4px',
						padding: '20px',
						boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
					}}
				>
					<h3 style={{ marginTop: 0 }}>
						{__('Poll Statistics', 'fair-audience')}
					</h3>
					<div
						style={{
							display: 'grid',
							gridTemplateColumns: 'repeat(3, 1fr)',
							gap: '20px',
						}}
					>
						<div
							style={{
								padding: '15px',
								backgroundColor: '#f0f0f0',
								borderRadius: '4px',
								textAlign: 'center',
							}}
						>
							<div
								style={{
									fontSize: '32px',
									fontWeight: 'bold',
									color: '#0073aa',
								}}
							>
								{pollStats.responded}
							</div>
							<div style={{ fontSize: '14px', color: '#666' }}>
								{__('Answered', 'fair-audience')}
							</div>
						</div>
						<div
							style={{
								padding: '15px',
								backgroundColor: '#f0f0f0',
								borderRadius: '4px',
								textAlign: 'center',
							}}
						>
							<div
								style={{
									fontSize: '32px',
									fontWeight: 'bold',
									color: '#46b450',
								}}
							>
								{pollStats.sent}
							</div>
							<div style={{ fontSize: '14px', color: '#666' }}>
								{__('Received Email', 'fair-audience')}
							</div>
						</div>
						<div
							style={{
								padding: '15px',
								backgroundColor: '#f0f0f0',
								borderRadius: '4px',
								textAlign: 'center',
							}}
						>
							<div
								style={{
									fontSize: '32px',
									fontWeight: 'bold',
									color: '#dc3232',
								}}
							>
								{pollStats.not_sent}
							</div>
							<div style={{ fontSize: '14px', color: '#666' }}>
								{__('Did Not Receive Email', 'fair-audience')}
							</div>
						</div>
					</div>
				</div>
			)}

			{pollId && (
				<div style={{ marginTop: '20px' }}>
					<Button
						isPrimary
						onClick={handleSendInvitations}
						disabled={isSendingInvitations || isSaving}
					>
						{isSendingInvitations
							? __('Sending...', 'fair-audience')
							: __('Send Poll Invitations', 'fair-audience')}
					</Button>{' '}
					<Button
						isSecondary
						onClick={handleGeneratePDF}
						disabled={isGeneratingPDF || isSaving}
					>
						{isGeneratingPDF
							? __('Generating PDF...', 'fair-audience')
							: __('Download Results PDF', 'fair-audience')}
					</Button>
					<p className="description" style={{ marginTop: '10px' }}>
						{__(
							'Send this poll to all event participants who have not yet responded. Participants who have already answered will be skipped.',
							'fair-audience'
						)}
					</p>
				</div>
			)}

			<div
				style={{
					marginTop: '20px',
					backgroundColor: '#ffffff',
					border: '1px solid #ddd',
					borderRadius: '4px',
					padding: '20px',
					boxShadow: '0 1px 3px rgba(0,0,0,0.1)',
				}}
			>
				<SelectControl
					label={__('Event', 'fair-audience')}
					value={formData.event_id}
					onChange={(value) =>
						setFormData({ ...formData, event_id: value })
					}
					options={[
						{
							label: __('Select an event...', 'fair-audience'),
							value: '',
						},
						...events.map((event) => ({
							label: sprintf(
								/* translators: %1$s: event title, %2$d: number of participants */
								__('%1$s (%2$d participants)', 'fair-audience'),
								event.title,
								event.participant_counts.signed_up || 0
							),
							value: event.event_id.toString(),
						})),
					]}
					disabled={!!pollId}
				/>

				<TextControl
					label={__('Poll Title (Internal)', 'fair-audience')}
					value={formData.title}
					onChange={(value) =>
						setFormData({ ...formData, title: value })
					}
					help={__(
						'Internal reference for this poll.',
						'fair-audience'
					)}
				/>

				<TextareaControl
					label={__('Question', 'fair-audience')}
					value={formData.question}
					onChange={(value) =>
						setFormData({ ...formData, question: value })
					}
					help={__(
						'The question shown to participants.',
						'fair-audience'
					)}
					rows={3}
				/>

				<h3>{__('Options', 'fair-audience')}</h3>
				<p>
					{__(
						'Add the multiple-choice options for participants to select from.',
						'fair-audience'
					)}
				</p>

				{formData.options.map((option, index) => (
					<div
						key={index}
						style={{
							display: 'flex',
							gap: '10px',
							marginBottom: '10px',
							alignItems: 'flex-start',
						}}
					>
						<div style={{ flex: 1 }}>
							<TextControl
								value={option.text}
								onChange={(value) =>
									handleOptionChange(index, value)
								}
								placeholder={sprintf(
									/* translators: %d: option number (1, 2, 3, etc.) */
									__('Option %d', 'fair-audience'),
									index + 1
								)}
							/>
						</div>
						<div
							style={{
								display: 'flex',
								gap: '5px',
								paddingTop: '3px',
							}}
						>
							<Button
								icon="arrow-up-alt2"
								onClick={() => handleMoveUp(index)}
								disabled={index === 0}
								label={__('Move up', 'fair-audience')}
							/>
							<Button
								icon="arrow-down-alt2"
								onClick={() => handleMoveDown(index)}
								disabled={index === formData.options.length - 1}
								label={__('Move down', 'fair-audience')}
							/>
							<Button
								icon="trash"
								onClick={() => handleRemoveOption(index)}
								disabled={formData.options.length === 1}
								label={__('Remove', 'fair-audience')}
								style={{ color: '#b32d2e' }}
							/>
						</div>
					</div>
				))}

				<Button isSecondary onClick={handleAddOption}>
					{__('Add Option', 'fair-audience')}
				</Button>

				<div style={{ marginTop: '20px' }}>
					<SelectControl
						label={__('Status', 'fair-audience')}
						value={formData.status}
						onChange={(value) =>
							setFormData({ ...formData, status: value })
						}
						options={[
							{
								label: __('Draft', 'fair-audience'),
								value: 'draft',
							},
							{
								label: __('Active', 'fair-audience'),
								value: 'active',
							},
							{
								label: __('Closed', 'fair-audience'),
								value: 'closed',
							},
						]}
						help={__(
							'Active polls can receive responses. Closed polls do not accept new responses.',
							'fair-audience'
						)}
					/>
				</div>
			</div>

			<div style={{ marginTop: '20px' }}>
				<Button isPrimary onClick={handleSubmit} disabled={isSaving}>
					{isSaving
						? __('Saving...', 'fair-audience')
						: pollId
						? __('Update Poll', 'fair-audience')
						: __('Create Poll', 'fair-audience')}
				</Button>{' '}
				<Button
					isSecondary
					href="admin.php?page=fair-audience-polls"
					disabled={isSaving}
				>
					{__('Cancel', 'fair-audience')}
				</Button>
			</div>
		</div>
	);
}
