<?php
/**
 * Seed data for the budget-entries-link e2e test.
 *
 * Creates a named budget using FairFinance\Models\Budget and returns its ID.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-budget.php
 *
 * Prints a single `E2E_BUDGET_SEED:{json}` line the spec parses.
 *
 * @package FairEventsE2E
 */

use FairFinance\Models\Budget;

$budget_id = Budget::create( 'E2E Test Budget', 'Created by e2e test' );

if ( ! $budget_id ) {
	WP_CLI::error( 'Failed to create budget.' );
}

echo 'E2E_BUDGET_SEED:' . wp_json_encode(
	array(
		'budgetId' => (int) $budget_id,
	)
) . "\n";
