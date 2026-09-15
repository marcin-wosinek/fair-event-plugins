<?php
/**
 * Resolves fair-events' event-level budget links for reconciliation
 *
 * @package FairFinance
 */

namespace FairFinance\Services;

defined( 'WPINC' ) || die;

/**
 * Maps local `event_date_id` values to the fair-events budget linked to that
 * event, so a settlement split's allocations can preselect it.
 *
 * Caches every resolution (including misses) per instance, keyed by
 * event_date_id, so a split with many allocations for the same event date
 * resolves it once and reuses the result — never one lookup per allocation.
 */
class EventBudgetResolver {

	/**
	 * Budget IDs already resolved during this instance's lifetime, keyed by
	 * event_date_id.
	 *
	 * @var array<int, int|null>
	 */
	private $cache = array();

	/**
	 * Resolve the budget ID linked to the event behind a local event_date_id.
	 *
	 * Every one of these resolves to "no budget", never an error: fair-events
	 * inactive, the event date not found, its event has no linked post, or
	 * the linked budget is missing/deleted.
	 *
	 * @param int|null $event_date_id Local fair-events event_date_id, or null.
	 * @return int|null Resolved budget ID, or null.
	 */
	public function resolve( $event_date_id ) {
		if ( empty( $event_date_id ) ) {
			return null;
		}

		$event_date_id = (int) $event_date_id;

		if ( ! array_key_exists( $event_date_id, $this->cache ) ) {
			$this->cache[ $event_date_id ] = $this->resolve_uncached( $event_date_id );
		}

		return $this->cache[ $event_date_id ];
	}

	/**
	 * Resolve a single event_date_id's budget, uncached.
	 *
	 * @param int $event_date_id Local fair-events event_date_id.
	 * @return int|null
	 */
	private function resolve_uncached( $event_date_id ) {
		if ( ! class_exists( '\FairEvents\Services\EventBudget' ) ) {
			return null;
		}

		return \FairEvents\Services\EventBudget::get_budget_id( $event_date_id );
	}
}
