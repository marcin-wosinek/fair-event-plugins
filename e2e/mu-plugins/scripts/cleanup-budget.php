<?php
/**
 * Tear down E2E-seeded budget data for the budget-entries-link test.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/cleanup-budget.php <budgetId>
 *
 * Prints a single `E2E_BUDGET_CLEANUP:{json}` line with the result.
 *
 * @package FairEventsE2E
 */

use FairFinance\Models\Budget;

$budget_id = isset( $args[0] ) ? (int) $args[0] : 0;

if ( ! $budget_id ) {
	WP_CLI::error( 'Usage: cleanup-budget.php <budgetId>' );
}

$deleted = Budget::delete( $budget_id );

echo 'E2E_BUDGET_CLEANUP:' . wp_json_encode(
	array(
		'deleted' => $deleted,
	)
) . "\n";
