<?php
/**
 * Resolves fair-payments-connector-experimental's Connected Site budget
 * links for reconciliation
 *
 * @package FairFinance
 */

namespace FairFinance\Services;

defined( 'WPINC' ) || die;

/**
 * Maps a transaction's `connected_site_id` metadata to the budget linked to
 * that Connected Site, so reconciliation can propose it as the source budget
 * for imported transactions.
 *
 * Caches every resolution (including misses) per instance, keyed by
 * connected_site_id, so resolving many transactions imported from the same
 * site does one lookup, not one per transaction.
 */
class ConnectedSiteBudgetResolver {

	/**
	 * Budget IDs already resolved during this instance's lifetime, keyed by
	 * connected_site_id.
	 *
	 * @var array<int, int|null>
	 */
	private $cache = array();

	/**
	 * Resolve the budget ID linked to a Connected Site.
	 *
	 * Resolves to "no budget", never an error: fair-payments-connector-
	 * experimental inactive, the site not found, it has no linked budget, or
	 * the linked budget has been deleted.
	 *
	 * @param int|null $connected_site_id Local Connected Site id, or null.
	 * @return int|null Resolved budget ID, or null.
	 */
	public function resolve( $connected_site_id ) {
		if ( empty( $connected_site_id ) ) {
			return null;
		}

		$connected_site_id = (int) $connected_site_id;

		if ( ! array_key_exists( $connected_site_id, $this->cache ) ) {
			$this->cache[ $connected_site_id ] = $this->resolve_uncached( $connected_site_id );
		}

		return $this->cache[ $connected_site_id ];
	}

	/**
	 * Resolve a single connected_site_id's budget, uncached.
	 *
	 * @param int $connected_site_id Local Connected Site id.
	 * @return int|null
	 */
	private function resolve_uncached( $connected_site_id ) {
		if ( ! class_exists( '\FairPaymentsConnectorExperimental\Models\ConnectedSite' ) ) {
			return null;
		}

		return \FairPaymentsConnectorExperimental\Models\ConnectedSite::get_budget_id( $connected_site_id );
	}
}
