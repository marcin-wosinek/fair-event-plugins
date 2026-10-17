/**
 * WordPress dependencies
 */
import { __, sprintf } from '@wordpress/i18n';
import { Notice } from '@wordpress/components';

/**
 * Preview of the next email of an email channel, built from its saved
 * settings.
 *
 * @param {Object}  props
 * @param {Object}  props.preview       Preview response, or `{ error }`.
 * @param {boolean} props.skipEmpty     Whether the saved settings skip an empty week.
 * @param {boolean} props.showRecipient Whether to name the saved recipient.
 * @return {JSX.Element|null} The preview.
 */
export default function EmailPreview( {
	preview,
	skipEmpty,
	showRecipient = false,
} ) {
	if ( ! preview ) {
		return null;
	}
	if ( preview.error ) {
		return (
			<Notice status="error" isDismissible={ false }>
				{ preview.error }
			</Notice>
		);
	}

	return (
		<>
			{ preview.empty && (
				<Notice status="warning" isDismissible={ false }>
					{ skipEmpty
						? sprintf(
								/* translators: %s: date range of a week */
								__(
									'No events for %s, so no email would be sent.',
									'fair-events'
								),
								preview.week_title
							)
						: sprintf(
								/* translators: %s: date range of a week */
								__(
									'No events for %s. The email below would still be sent.',
									'fair-events'
								),
								preview.week_title
							) }
				</Notice>
			) }
			{ showRecipient && (
				<p>
					<strong>{ __( 'To:', 'fair-events' ) }</strong>{ ' ' }
					{ preview.recipient ||
						__( 'No email address is saved yet.', 'fair-events' ) }
				</p>
			) }
			<p>
				<strong>{ __( 'Subject:', 'fair-events' ) }</strong>{ ' ' }
				{ preview.subject }
			</p>
			<div
				className="fair-events-notifications__preview"
				role="group"
				aria-label={ __( 'Email preview', 'fair-events' ) }
				// The server sanitizes the body with wp_kses_post().
				dangerouslySetInnerHTML={ {
					__html: preview.html,
				} }
			/>
		</>
	);
}
