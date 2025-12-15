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
						onRemove={() => setError(null)}
					>
						{error}
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
