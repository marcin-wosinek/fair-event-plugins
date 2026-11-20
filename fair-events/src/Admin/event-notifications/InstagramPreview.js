/**
 * WordPress dependencies
 */
import { __, _n, sprintf } from '@wordpress/i18n';
import { Notice } from '@wordpress/components';

/**
 * Preview of an Instagram post: the image and caption a scheduled post of
 * the selected week would publish. Building it publishes nothing.
 *
 * @param {Object} props
 * @param {Object} props.preview Preview response, or `{ error }`.
 * @return {JSX.Element|null} The preview.
 */
export default function InstagramPreview( { preview } ) {
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
	if ( 0 === preview.occurrence_count ) {
		return (
			<p>
				{ sprintf(
					/* translators: %s: date range of a week */
					__(
						'No events for %s, so nothing would be posted.',
						'fair-events'
					),
					preview.week_title
				) }
			</p>
		);
	}

	return (
		<div className="fair-events-notifications__instagram-preview">
			<p>
				{ sprintf(
					/* translators: 1: number of events, 2: date range of a week */
					_n(
						'%1$d event for %2$s, in one image. This preview was not published.',
						'%1$d events for %2$s, in one image. This preview was not published.',
						preview.occurrence_count,
						'fair-events'
					),
					preview.occurrence_count,
					preview.week_title
				) }
			</p>
			<div className="fair-events-notifications__instagram-post">
				<img
					src={ preview.image }
					width={ preview.width }
					height={ preview.height }
					alt={ sprintf(
						/* translators: %s: date range of a week */
						__(
							'Instagram image listing the events of %s',
							'fair-events'
						),
						preview.week_title
					) }
				/>
				<div
					role="group"
					aria-label={ __( 'Instagram caption', 'fair-events' ) }
					className="fair-events-notifications__preview is-instagram"
				>
					{ preview.caption }
				</div>
			</div>
		</div>
	);
}
