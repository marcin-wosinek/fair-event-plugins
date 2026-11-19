<?php
/**
 * Connecting Instagram through the Fair Event Plugins OAuth service
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Instagram;

use FairEventsShared\Security\SecretBox;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Starts and completes a Unified Login connection (#2427).
 *
 * Starting creates a random state and a verifier for the administrator,
 * keeps them encrypted on this server, and gives the browser the OAuth
 * service's authorize URL with only the verifier's challenge. The service
 * sends the administrator back to Fair Events → Instagram with the state and
 * a single-use handoff code. Completing checks and consumes the state, then
 * this server redeems the handoff code with the verifier, server to server,
 * and stores the credentials. The access token is never in a URL or a
 * response to the browser.
 */
class Authorization {

	/**
	 * Fair Event Plugins OAuth service.
	 */
	const SERVICE_URL = 'https://fair-event-plugins.com';

	/**
	 * Lets a development or test site use another OAuth service.
	 */
	const SERVICE_FILTER = 'fair_events_experimental_instagram_oauth_service_url';

	/**
	 * Site ↔ service protocol version (Unified Login with handoff codes).
	 */
	const PROTOCOL = '2';

	/**
	 * Seconds an attempt stays valid: the service keeps its own for 10 minutes.
	 */
	const ATTEMPT_TTL = 900;

	/**
	 * Per-administrator attempt, as a transient name prefix.
	 */
	const ATTEMPT_TRANSIENT = 'fair_events_experimental_instagram_attempt_';

	/**
	 * Admin page the service returns to.
	 */
	const RETURN_PAGE = 'fair-events-instagram';

	/**
	 * Failure codes the service returns, with what to tell the administrator.
	 *
	 * @return array<string,string>
	 */
	public static function service_errors() {
		return array(
			'cancelled'                => __( 'Instagram authorization was cancelled. Nothing was changed.', 'fair-events-experimental' ),
			'insufficient_permissions' => __( 'Meta did not grant permission to publish to Instagram. Nothing was changed; connect again and allow every requested permission.', 'fair-events-experimental' ),
			'no_account'               => __( 'No Instagram professional account was shared with Fair Event Plugins. Nothing was changed; connect again and select the account this site publishes to.', 'fair-events-experimental' ),
			'multiple_accounts'        => __( 'More than one Instagram account was shared with Fair Event Plugins. Nothing was changed; connect again and select only the account this site publishes to. If Meta keeps sharing earlier accounts, first remove the app under Meta Business Settings → Integrations → Connected apps.', 'fair-events-experimental' ),
		);
	}

	/**
	 * Start an attempt for an administrator.
	 *
	 * @param int $user_id Administrator.
	 * @return string|WP_Error Authorize URL.
	 */
	public static function start( $user_id ) {
		$verifier = self::random( 48 );
		$state    = self::random( 24 );
		$key      = self::key();
		$envelope = null !== $key ? SecretBox::encrypt( (string) wp_json_encode( array( $state, $verifier ) ), $key ) : null;

		if ( null === $envelope ) {
			return new WP_Error(
				'instagram_authorization_not_started',
				__( 'The Instagram connection could not be started: this server does not provide the Sodium encryption support it needs. Ask your host to enable PHP Sodium support.', 'fair-events-experimental' ),
				array( 'status' => 409 )
			);
		}

		set_transient( self::ATTEMPT_TRANSIENT . (int) $user_id, $envelope, self::ATTEMPT_TTL );

		return self::service_url() . '/oauth/instagram/authorize?' . http_build_query(
			array(
				'protocol'       => self::PROTOCOL,
				'site_url'       => site_url(),
				'return_url'     => self::return_url(),
				'code_challenge' => self::code_challenge( $verifier ),
				'state'          => $state,
				'site_name'      => wp_specialchars_decode( (string) get_bloginfo( 'name' ), ENT_QUOTES ),
			),
			'',
			'&',
			PHP_QUERY_RFC3986
		);
	}

	/**
	 * Complete an attempt from the parameters the service returned. The
	 * attempt is used up whatever the outcome.
	 *
	 * @param int    $user_id Administrator.
	 * @param string $state   Returned state.
	 * @param string $handoff Returned handoff code, '' on failure.
	 * @param string $error   Returned failure code, '' on success.
	 * @return true|WP_Error
	 */
	public static function complete( $user_id, $state, $handoff, $error ) {
		$attempt = self::take_attempt( $user_id );

		if ( null === $attempt || ! is_string( $state ) || '' === $state || ! hash_equals( $attempt[0], $state ) ) {
			return new WP_Error(
				'instagram_authorization_unknown',
				__( 'This Instagram authorization was not started from this page by you, or it expired. Nothing was changed; connect again.', 'fair-events-experimental' ),
				array( 'status' => 400 )
			);
		}

		if ( '' !== $error || '' === $handoff ) {
			$messages = self::service_errors();
			return new WP_Error(
				'instagram_authorization_failed',
				$messages[ $error ] ?? __( 'Instagram authorization failed. Nothing was changed; try connecting again.', 'fair-events-experimental' ),
				array(
					'status' => 400,
					'reason' => isset( $messages[ $error ] ) ? $error : 'failed',
				)
			);
		}

		$redeemed = self::redeem( $handoff, $attempt[1] );
		if ( is_wp_error( $redeemed ) ) {
			return $redeemed;
		}

		$credentials = Connection::validate_credentials( $redeemed );
		if ( is_wp_error( $credentials ) ) {
			return $credentials;
		}

		return Connection::connect( $credentials );
	}

	/**
	 * Redeem a handoff code with the service.
	 *
	 * @param string $handoff  Handoff code.
	 * @param string $verifier Verifier of the attempt.
	 * @return array|WP_Error Decoded credentials.
	 */
	private static function redeem( $handoff, $verifier ) {
		$failed = new WP_Error(
			'instagram_handoff_failed',
			__( 'The Instagram connection could not be completed with the Fair Event Plugins OAuth service. Nothing was changed; connect again.', 'fair-events-experimental' ),
			array( 'status' => 502 )
		);

		if ( ! preg_match( '/^[A-Za-z0-9_-]{43}$/', $handoff ) ) {
			return $failed;
		}

		$response = wp_remote_post(
			self::service_url() . '/wp-json/fair-platform/v1/instagram/redeem',
			array(
				'timeout'     => 30,
				'redirection' => 0,
				'body'        => array(
					'handoff'       => $handoff,
					'code_verifier' => $verifier,
					'site_url'      => site_url(),
				),
			)
		);

		if ( is_wp_error( $response ) || 200 !== (int) wp_remote_retrieve_response_code( $response ) ) {
			return $failed;
		}

		$body = json_decode( (string) wp_remote_retrieve_body( $response ), true );

		return is_array( $body ) ? $body : $failed;
	}

	/**
	 * Fair Events → Instagram, where the service returns.
	 *
	 * @return string
	 */
	public static function return_url() {
		return admin_url( 'admin.php?page=' . self::RETURN_PAGE );
	}

	/**
	 * The OAuth service base URL, without a trailing slash.
	 *
	 * @return string
	 */
	public static function service_url() {
		$url = apply_filters( self::SERVICE_FILTER, self::SERVICE_URL );
		return untrailingslashit( is_string( $url ) && '' !== $url ? $url : self::SERVICE_URL );
	}

	/**
	 * S256 challenge of a verifier.
	 *
	 * @param string $verifier Verifier.
	 * @return string
	 */
	public static function code_challenge( $verifier ) {
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- base64url of a hash, per RFC 7636.
		return rtrim( strtr( base64_encode( hash( 'sha256', (string) $verifier, true ) ), '+/', '-_' ), '=' );
	}

	/**
	 * Read and remove an administrator's attempt.
	 *
	 * @param int $user_id Administrator.
	 * @return array{0: string, 1: string}|null State and verifier.
	 */
	private static function take_attempt( $user_id ) {
		$name     = self::ATTEMPT_TRANSIENT . (int) $user_id;
		$envelope = get_transient( $name );
		delete_transient( $name );

		if ( ! is_string( $envelope ) ) {
			return null;
		}

		$result = SecretBox::decrypt( $envelope, self::key() );
		$data   = $result->is_readable() && $result->is_encrypted() ? json_decode( (string) $result->value(), true ) : null;

		return is_array( $data ) && isset( $data[0], $data[1] ) && is_string( $data[0] ) && is_string( $data[1] )
			? array( $data[0], $data[1] )
			: null;
	}

	/**
	 * URL-safe random text.
	 *
	 * @param int $bytes Random bytes.
	 * @return string
	 */
	private static function random( $bytes ) {
		// phpcs:ignore WordPress.PHP.DiscouragedPHPFunctions.obfuscation_base64_encode -- URL-safe text form of random bytes.
		return rtrim( strtr( base64_encode( random_bytes( $bytes ) ), '+/', '-_' ), '=' );
	}

	/**
	 * Key that protects attempts at rest.
	 *
	 * @return string|null
	 */
	private static function key() {
		return SecretBox::derive_key( function_exists( 'wp_salt' ) ? wp_salt( 'secure_auth' ) : '', 'fair-events-experimental/instagram-attempt/v1' );
	}
}
