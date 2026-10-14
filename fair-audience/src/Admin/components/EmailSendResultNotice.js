import { __, _n, sprintf } from '@wordpress/i18n';
import { Notice } from '@wordpress/components';

export default function EmailSendResultNotice( { result, onDismiss, title } ) {
	if ( ! result ) {
		return null;
	}

	const heading =
		title ||
		sprintf(
			/* translators: %d: number of emails sent */
			_n(
				'Invitation sent to %d participant',
				'Invitations sent to %d participants',
				result.sent_count,
				'fair-audience'
			),
			result.sent_count
		);
	const hasFailures = result.failed && result.failed.length > 0;

	return (
		<Notice
			status={ hasFailures ? 'warning' : 'success' }
			isDismissible={ true }
			onRemove={ onDismiss }
		>
			<p>
				<strong>{ heading }</strong>
			</p>
			{ result.skipped_count > 0 && (
				<p>
					{ sprintf(
						/* translators: %d: number of skipped participants */
						_n(
							'%d skipped (already signed up or opted out of marketing).',
							'%d skipped (already signed up or opted out of marketing).',
							result.skipped_count,
							'fair-audience'
						),
						result.skipped_count
					) }
				</p>
			) }
			{ hasFailures && (
				<>
					<p>{ __( 'Failed to send to:', 'fair-audience' ) }</p>
					<ul>
						{ result.failed.map( ( fail, index ) => (
							<li key={ index }>
								{ fail.name || fail.email }
								{ fail.name && fail.email
									? ` (${ fail.email })`
									: '' }
								: { fail.reason }
							</li>
						) ) }
					</ul>
				</>
			) }
		</Notice>
	);
}
