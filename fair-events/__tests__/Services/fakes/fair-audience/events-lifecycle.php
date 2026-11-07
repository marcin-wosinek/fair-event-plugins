<?php
/**
 * A Fair Audience release that runs its routes through the Events purchase
 * lifecycle (PAYMENT_HISTORY_MIGRATION.md §8.12).
 *
 * @package FairEvents
 */

namespace FairAudience\Services;

/**
 * Stand-in lifecycle adapter.
 */
class EventsLifecycle {

	/**
	 * Capability marker.
	 *
	 * @return bool
	 */
	public static function supports_purchase_lifecycle() {
		return true;
	}
}
