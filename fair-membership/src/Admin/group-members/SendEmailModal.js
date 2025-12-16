import { useState } from '@wordpress/element';
import { __, sprintf } from '@wordpress/i18n';
import {
	Modal,
	Button,
	TextControl,
	TextareaControl,
	Notice,
	__experimentalVStack as VStack,
} from '@wordpress/components';

const SendEmailModal = ({ groupName, memberCount, onSend, onClose }) => {
	const [subject, setSubject] = useState('');
	const [message, setMessage] = useState('');
	const [sending, setSending] = useState(false);
	const [error, setError] = useState(null);
	const [errorDetails, setErrorDetails] = useState(null);
	const [showDetails, setShowDetails] = useState(false);

	const handleSend = async () => {
		// Validate
		if (!subject.trim()) {
			setError(__('Please enter a subject.', 'fair-membership'));
			return;
		}

		if (!message.trim()) {
			setError(__('Please enter a message.', 'fair-membership'));
			return;
		}

		setSending(true);
		setError(null);

		try {
			await onSend({
				subject: subject.trim(),
				message: message.trim(),
			});
			// Success - close modal (parent will show success message)
		} catch (err) {
			setError(
				err.message || __('Failed to send email.', 'fair-membership')
			);
			// Store error details if available
			setErrorDetails(err.details || null);
			setSending(false);
		}
	};

	return (
		<Modal
			title={sprintf(
				__('Send Message to %s Members', 'fair-membership'),
				groupName
			)}
			onRequestClose={onClose}
			size="medium"
		>
			<VStack spacing={4}>
				<Notice status="info" isDismissible={false}>
					{sprintf(
						__(
							'This message will be sent to %d members of this group.',
							'fair-membership'
						),
						memberCount
					)}
				</Notice>

				{error && (
					<Notice
						status="error"
						isDismissible
						onRemove={() => {
							setError(null);
							setErrorDetails(null);
							setShowDetails(false);
						}}
					>
						<div>
							<p style={{ margin: '0 0 8px 0' }}>{error}</p>
							{errorDetails && (
								<>
									<Button
										variant="link"
										onClick={() =>
											setShowDetails(!showDetails)
										}
										style={{
											padding: 0,
											height: 'auto',
											fontSize: '13px',
										}}
									>
										{showDetails
											? __(
													'Hide details',
													'fair-membership'
												)
											: __(
													'More info',
													'fair-membership'
												)}
									</Button>
									{showDetails && (
										<div
											style={{
												marginTop: '8px',
												padding: '8px',
												background: '#f0f0f0',
												borderRadius: '4px',
												fontSize: '12px',
												fontFamily: 'monospace',
												maxHeight: '200px',
												overflow: 'auto',
											}}
										>
											<pre
												style={{
													margin: 0,
													whiteSpace: 'pre-wrap',
													wordBreak: 'break-word',
												}}
											>
												{JSON.stringify(
													errorDetails,
													null,
													2
												)}
											</pre>
										</div>
									)}
								</>
							)}
						</div>
					</Notice>
				)}

				<TextControl
					label={__('Subject', 'fair-membership')}
					value={subject}
					onChange={setSubject}
					placeholder={__(
						'Enter email subject...',
						'fair-membership'
					)}
					disabled={sending}
				/>

				<TextareaControl
					label={__('Message', 'fair-membership')}
					value={message}
					onChange={setMessage}
					placeholder={__('Enter your message...', 'fair-membership')}
					rows={10}
					disabled={sending}
				/>

				<div
					style={{
						display: 'flex',
						justifyContent: 'flex-end',
						gap: '10px',
					}}
				>
					<Button
						variant="tertiary"
						onClick={onClose}
						disabled={sending}
					>
						{__('Cancel', 'fair-membership')}
					</Button>
					<Button
						variant="primary"
						onClick={handleSend}
						isBusy={sending}
						disabled={sending}
					>
						{sending
							? __('Sending...', 'fair-membership')
							: __('Send Email', 'fair-membership')}
					</Button>
				</div>
			</VStack>
		</Modal>
	);
};

export default SendEmailModal;
