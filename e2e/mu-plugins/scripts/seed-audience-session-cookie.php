<?php
/**
 * Mint a valid fair_audience_session cookie value for a participant, for the
 * resume-anonymous-signup-on-recognised-email E2E spec.
 *
 * Run via WP-CLI against the wp-env tests instance:
 *   wp eval-file wp-content/mu-plugins/scripts/seed-audience-session-cookie.php <participant_id>
 *
 * AudienceSession::set() can't be used directly from a CLI script — it calls
 * setcookie(), which is a no-op outside a real HTTP response — so this
 * reproduces its signing scheme (see FairAudience\Services\AudienceSession)
 * to hand the spec a cookie value it can inject into the browser context
 * with context.addCookies().
 *
 * Used to simulate a browser that already holds an active session for one
 * participant when it then types a *different*, known participant's email
 * into the anonymous signup form — the register endpoint's anti-enumeration
 * check (`$session_pid !== $participant->id`) must still stash-and-email a
 * resume link rather than silently acting on the session's identity.
 *
 * Prints a single `E2E_COOKIE:{json}` line with the cookie value.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

$participant_id = isset( $args[0] ) ? (int) $args[0] : 0;

if ( ! $participant_id ) {
	WP_CLI::error( 'Usage: seed-audience-session-cookie.php <participant_id>' );
}

$expires_at = time() + HOUR_IN_SECONDS;
$data       = $participant_id . '.' . $expires_at;
$secret     = 'fair_audience_session_' . wp_salt( 'auth' );
$signature  = hash_hmac( 'sha256', $data, $secret );
$value      = $data . '.' . $signature;

echo 'E2E_COOKIE:' . wp_json_encode( array( 'value' => $value ) ) . "\n";
