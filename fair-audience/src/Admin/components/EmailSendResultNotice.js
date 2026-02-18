import { __, sprintf } from '@wordpress/i18n';
import { Notice } from '@wordpress/components';

export default function EmailSendResultNotice({ result, onDismiss }) {
	if (!result) {
		return null;
	}

	return (
		<Notice status="success" isDismissible={true} onRemove={onDismiss}>
			<p>
				<strong>
					{sprintf(
						/* translators: %d: number of emails sent */
						__(
							'Invitations sent to %d participants',
							'fair-audience'
						),
						result.sent_count
					)}
				</strong>
			</p>
			{result.skipped_count > 0 && (
				<p>
					{sprintf(
						/* translators: %d: number of skipped participants */
						__(
							'%d skipped (already signed up or opted out of marketing).',
							'fair-audience'
						),
						result.skipped_count
					)}
				</p>
			)}
			{result.failed && result.failed.length > 0 && (
				<>
					<p>{__('Failed to send to:', 'fair-audience')}</p>
					<ul>
						{result.failed.map((fail, index) => (
							<li key={index}>
								{fail.name || fail.email}
								{fail.name && fail.email
									? ` (${fail.email})`
									: ''}
								: {fail.reason}
							</li>
						))}
					</ul>
				</>
			)}
		</Notice>
	);
}
