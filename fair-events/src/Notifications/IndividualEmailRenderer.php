<?php
/**
 * Individual email notification renderer.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

use FairEvents\Services\WeeklyEventsProvider;

defined( 'WPINC' ) || die;

/**
 * Renders the weekly email sent to the one configured address.
 *
 * The preview, the test and the scheduled send all use this renderer, so the
 * email that arrives is the one that was previewed. The content is the same
 * as the subscribers' weekly email: both come from {@see WeeklyEmailRenderer}.
 */
class IndividualEmailRenderer {

	/**
	 * Render the email for a week.
	 *
	 * @param array                             $settings    Individual email settings.
	 * @param array{start: string, end: string} $week        Week boundaries.
	 * @param array[]                           $occurrences Occurrence DTOs in display order.
	 * @return array{subject: string, html: string, empty: bool}
	 */
	public static function compose( array $settings, array $week, array $occurrences ) {
		return WeeklyEmailRenderer::compose( WeeklyEventsProvider::week_data( $week, $occurrences ), $settings );
	}
}
