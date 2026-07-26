<?php
/**
 * Report mail captured for a given recipient, for the Fair Form
 * notification-email E2E suite (#1212).
 *
 * Generic by recipient (not form-specific) so the same script covers both
 * the admin notification and the submitter confirmation email — call it once
 * per address under test. Called with no address, it returns everything
 * captured (unfiltered) — used by the "nothing should be sent" scenarios.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/fair-form-notification-state.php [email]
 *
 * Prints a single `E2E_FORM_NOTIFICATION:{json}` line.
 *
 * @package FairFormE2E
 */

defined( 'ABSPATH' ) || exit;

$email = isset( $args[0] ) ? (string) $args[0] : '';

$mail = array();
foreach ( get_option( 'fair_e2e_captured_mail', array() ) as $entry ) {
	$recipients = (array) ( $entry['to'] ?? array() );
	if ( '' === $email || in_array( $email, $recipients, true ) ) {
		$mail[] = array(
			'to'      => $entry['to'] ?? '',
			'subject' => $entry['subject'] ?? '',
			'body'    => $entry['body'] ?? '',
		);
	}
}

echo 'E2E_FORM_NOTIFICATION:' . wp_json_encode( array( 'mail' => $mail ) ) . "\n";
