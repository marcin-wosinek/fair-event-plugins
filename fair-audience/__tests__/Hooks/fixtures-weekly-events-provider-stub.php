<?php
/**
 * Test-only stand-in for FairEvents\Services\WeeklyEventsProvider.
 *
 * Only used so class_exists( 'FairEvents\Services\WeeklyEventsProvider' )
 * reports true in WeeklyDigestHooksTest without pulling in the fair-events
 * plugin. It always reports an empty week, which — combined with the
 * digest's default skip_empty=true — is enough to exercise
 * WeeklyDigestHooks::run_due() end to end without reaching EmailService.
 *
 * @package FairAudience
 */

namespace FairEvents\Services;

/**
 * Minimal stand-in for FairEvents\Services\WeeklyEventsProvider.
 */
class WeeklyEventsProvider {

	/**
	 * Always returns an empty week.
	 *
	 * @param string $source_slug Event source slug.
	 * @return array Week data with no events.
	 */
	public function get_week( $source_slug ) {
		return array(
			'source' => $source_slug,
			'week'   => array(
				'start' => '2026-07-06',
				'end'   => '2026-07-12',
			),
			'days'   => array(),
		);
	}
}
