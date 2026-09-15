<?php
/**
 * Fair Finance budget deletion hooks for Fair Payments Connector Experimental
 *
 * @package FairPaymentsConnectorExperimental
 */

namespace FairPaymentsConnectorExperimental\Hooks;

use FairPaymentsConnectorExperimental\Models\ConnectedSite;

defined( 'WPINC' ) || die;

/**
 * Keeps Connected Site budget associations in sync when Fair Finance deletes
 * a budget.
 *
 * This listens for `fair_finance_budget_deleted` rather than reaching into
 * Fair Finance's tables directly, so the two plugins stay decoupled: this
 * hook simply never fires when Fair Finance is inactive, and
 * ConnectedSite::get_budget_id() validates against Fair Finance independently
 * as a second line of defense for a deletion that happened while this plugin
 * itself was inactive.
 */
class BudgetHooks {

	/**
	 * Register hooks.
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'fair_finance_budget_deleted', array( $this, 'on_budget_deleted' ) );
	}

	/**
	 * Clear the association on every Connected Site linked to the deleted budget.
	 *
	 * @param int $budget_id Deleted budget id.
	 * @return void
	 */
	public function on_budget_deleted( $budget_id ) {
		ConnectedSite::clear_budget_id( (int) $budget_id );
	}
}
