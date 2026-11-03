/**
 * Weekly summary section - open the WhatsApp summary for this feed.
 *
 * @package FairEventsExperimental
 */

import { Button } from '@wordpress/components';
import { __ } from '@wordpress/i18n';

const NOTE_ID = 'fair-events-weekly-summary-unavailable';

/**
 * @param {Object} props
 * @param {Object} props.source Event feed
 * @return {JSX.Element} The section
 */
export default function WeeklySummarySection( { source } ) {
	const summaryUrl = source.weekly_summary_url;

	// The summary needs a linked page; a disabled feed has no summary yet.
	let unavailableReason = null;
	if ( ! summaryUrl ) {
		unavailableReason = __(
			'Choose a public page in the feed settings to open the weekly summary. The page gives the WhatsApp message its title and link.',
			'fair-events-experimental'
		);
	} else if ( ! source.enabled ) {
		unavailableReason = __(
			'Enable this feed to open its weekly summary.',
			'fair-events-experimental'
		);
	}

	return (
		<section
			className="fair-events-feed-section"
			aria-labelledby="fair-events-weekly-summary-title"
		>
			<h2
				id="fair-events-weekly-summary-title"
				className="fair-events-feed-section__title"
			>
				{ __( 'Weekly summary', 'fair-events-experimental' ) }
			</h2>
			<p className="fair-events-feed-section__text">
				{ __(
					'Opens this week’s events as a WhatsApp message, ready to copy and post.',
					'fair-events-experimental'
				) }
			</p>
			<div className="fair-events-feed-section__actions">
				{ unavailableReason ? (
					<Button
						variant="secondary"
						disabled
						accessibleWhenDisabled
						aria-describedby={ NOTE_ID }
					>
						{ __(
							'Open weekly summary',
							'fair-events-experimental'
						) }
					</Button>
				) : (
					<Button
						variant="secondary"
						href={ summaryUrl }
						target="_blank"
						rel="noopener noreferrer"
					>
						{ __(
							'Open weekly summary',
							'fair-events-experimental'
						) }
						<span className="screen-reader-text">
							{ __(
								'(opens in a new tab)',
								'fair-events-experimental'
							) }
						</span>
						<span aria-hidden="true">&nbsp;&#8599;</span>
					</Button>
				) }
			</div>
			{ unavailableReason && (
				<p id={ NOTE_ID } className="fair-events-feed-section__note">
					{ unavailableReason }
				</p>
			) }
		</section>
	);
}
