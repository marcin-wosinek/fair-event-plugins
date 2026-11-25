<?php
/**
 * Plugin Name: Fair Events E2E Checkout Faults
 * Description: Test-only faults for the checkout handoff, loaded ONLY inside
 *              the Playwright wp-env instance. Armed through the
 *              payment-lifecycle.php `faults` action, each one fails the
 *              next N transactions at one step: creation is refused, or the
 *              transaction is created with metadata naming no purchase, so
 *              Fair Events can't record the attempt.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

add_filter(
	'fair_payment_before_create_transaction',
	static function ( $transaction_data ) {
		$refused = (int) get_option( 'fair_e2e_refuse_transaction_creates', 0 );
		if ( $refused > 0 ) {
			update_option( 'fair_e2e_refuse_transaction_creates', $refused - 1, false );
			// Connector answers a filter result without an amount with a
			// WP_Error and creates nothing.
			return false;
		}

		$unrecordable = (int) get_option( 'fair_e2e_unrecordable_attempts', 0 );
		if ( $unrecordable > 0 && is_array( $transaction_data ) && is_array( $transaction_data['metadata'] ?? null ) ) {
			update_option( 'fair_e2e_unrecordable_attempts', $unrecordable - 1, false );
			// An unknown source is out of Fair Events' attribution scope.
			$transaction_data['metadata']['source'] = 'fair-e2e-unrecordable';
		}

		return $transaction_data;
	},
	1000
);
