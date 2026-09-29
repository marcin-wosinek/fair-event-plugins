<?php
/**
 * Weekly notification provider registry.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\WeeklyNotifications;

defined( 'WPINC' ) || die;

/**
 * Lists the available delivery providers.
 */
class Providers {

	/**
	 * Available providers, keyed by provider ID.
	 *
	 * Additional providers register through the
	 * `fair_events_experimental_weekly_notification_providers` filter.
	 *
	 * @return array<string, Provider>
	 */
	public static function all() {
		$providers = apply_filters(
			'fair_events_experimental_weekly_notification_providers',
			array( TelegramProvider::ID => new TelegramProvider() )
		);

		$out = array();
		foreach ( (array) $providers as $provider ) {
			if ( $provider instanceof Provider ) {
				$out[ $provider->id() ] = $provider;
			}
		}
		return $out;
	}
}
