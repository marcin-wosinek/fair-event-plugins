<?php
/**
 * Set the status the Mollie HTTP double reports on GET /v2/payments/{id}.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/set-mollie-status.php <status>
 *
 * The double (lib/mollie-http-double.php) always reports "open" on POST (the
 * checkout-creation response never needs to vary) but reads this option for
 * the GET response, so a spec can drive the sync-on-return path through
 * paid/failed/canceled/expired without needing a real Mollie account (#1244).
 * Defaults to "paid" when never set, keeping every pre-existing spec's
 * assumption intact.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

$mollie_status = isset( $args[0] ) ? (string) $args[0] : '';

$allowed = array( 'paid', 'open', 'pending', 'failed', 'canceled', 'expired' );
if ( ! in_array( $mollie_status, $allowed, true ) ) {
	WP_CLI::error( 'Usage: set-mollie-status.php <paid|open|pending|failed|canceled|expired>' );
}

update_option( 'fair_e2e_mollie_get_status', $mollie_status );

echo 'E2E_MOLLIE_STATUS:' . wp_json_encode( array( 'status' => $mollie_status ) ) . "\n";
