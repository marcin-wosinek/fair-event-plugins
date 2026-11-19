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
 *
 * When the business shared several Instagram accounts (#2429), the service
 * hands off the candidates instead of one account. The credentials and the
 * candidates stay on this server, encrypted, as the administrator's pending
 * choice; the browser only gets the choice's random ID and the accounts'
 * IDs and usernames. Confirming one of those accounts with that ID connects
 * it. A new attempt, cancelling, expiry or a confirmation ends the choice.
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
	 * Per-administrator pending account choice, as a transient name prefix.
	 */
	const CHOICE_TRANSIENT = 'fair_events_experimental_instagram_choice_';

	/**
	 * Seconds the administrator has to choose an account.
	 */
	const CHOICE_TTL = 900;

	/**
	 * Most candidates a choice lists, as the service caps them.
	 */
	const MAX_CHOICES = 50;

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
			'account_unidentified'     => __( 'Meta shared several Instagram accounts but did not say the username of each, so they cannot be told apart. Nothing was changed; connect again.', 'fair-events-experimental' ),
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
		$key      = self::key( 'attempt' );
		$envelope = null !== $key ? SecretBox::encrypt( (string) wp_json_encode( array( $state, $verifier ) ), $key ) : null;

		if ( null === $envelope ) {
			return new WP_Error(
				'instagram_authorization_not_started',
				__( 'The Instagram connection could not be started: this server does not provide the Sodium encryption support it needs. Ask your host to enable PHP Sodium support.', 'fair-events-experimental' ),
				array( 'status' => 409 )
			);
		}

		set_transient( self::ATTEMPT_TRANSIENT . (int) $user_id, $envelope, self::ATTEMPT_TTL );
		// A new attempt replaces any choice still pending.
		delete_transient( self::CHOICE_TRANSIENT . (int) $user_id );

		return self::service_url() . '/oauth/instagram/authorize?' . http_build_query(
			array(
				'protocol'       => self::PROTOCOL,
				// This site can let the administrator choose between accounts.
				'account_choice' => '1',
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
	 * @return true|WP_Error True when connected or when a choice is pending.
	 */
	public static function complete( $user_id, $state, $handoff, $error ) {
		$attempt = self::take_attempt( $user_id );
		// Any return supersedes a choice from an earlier attempt.
		delete_transient( self::CHOICE_TRANSIENT . (int) $user_id );

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

		if ( array_key_exists( 'accounts', $redeemed ) ) {
			return self::store_choice( $user_id, $redeemed );
		}

		$credentials = Connection::validate_credentials( $redeemed );
		if ( is_wp_error( $credentials ) ) {
			return $credentials;
		}

		return Connection::connect( $credentials );
	}

	/**
	 * The administrator's pending account choice, as the browser may see it.
	 *
	 * @param int $user_id Administrator.
	 * @return array{id: string, accounts: array<int, array{id: string, username: string}>, expires_at: int}|null
	 */
	public static function pending_choice( $user_id ) {
		$choice = self::read_choice( $user_id );

		return null === $choice
			? null
			: array(
				'id'         => $choice['id'],
				'accounts'   => $choice['accounts'],
				'expires_at' => $choice['expires_at'],
			);
	}

	/**
	 * Connect the account the administrator chose. Only an account listed in
	 * the administrator's current choice, confirmed with that choice's ID,
	 * replaces the connection. A request for an account that is not listed
	 * keeps the choice, so the administrator can choose again.
	 *
	 * @param int    $user_id    Administrator.
	 * @param string $choice_id  ID of the choice the browser shows.
	 * @param string $account_id Chosen Instagram account ID.
	 * @return true|WP_Error
	 */
	public static function confirm_choice( $user_id, $choice_id, $account_id ) {
		$choice = self::read_choice( $user_id );
		if ( null === $choice || ! is_string( $choice_id ) || ! hash_equals( $choice['id'], $choice_id ) ) {
			return self::choice_unknown();
		}

		$chosen = null;
		foreach ( $choice['accounts'] as $account ) {
			if ( is_string( $account_id ) && hash_equals( $account['id'], $account_id ) ) {
				$chosen = $account;
			}
		}
		if ( null === $chosen ) {
			return new WP_Error(
				'instagram_choice_invalid',
				__( 'Choose one of the Instagram accounts listed. Nothing was changed.', 'fair-events-experimental' ),
				array( 'status' => 400 )
			);
		}

		// Used up before connecting, so a second confirmation finds nothing.
		if ( ! delete_transient( self::CHOICE_TRANSIENT . (int) $user_id ) ) {
			return self::choice_unknown();
		}

		$credentials = Connection::validate_credentials(
			array_merge(
				$choice['credentials'],
				array(
					'account_id' => $chosen['id'],
					'username'   => $chosen['username'],
				)
			)
		);
		if ( is_wp_error( $credentials ) ) {
			return $credentials;
		}

		return Connection::connect( $credentials );
	}

	/**
	 * Cancel the administrator's pending choice. The connection is kept.
	 *
	 * @param int    $user_id   Administrator.
	 * @param string $choice_id ID of the choice the browser shows.
	 * @return true|WP_Error Error when another choice is pending.
	 */
	public static function cancel_choice( $user_id, $choice_id ) {
		$choice = self::read_choice( $user_id );
		if ( null === $choice ) {
			return true;
		}
		if ( ! is_string( $choice_id ) || ! hash_equals( $choice['id'], $choice_id ) ) {
			return self::choice_unknown();
		}

		delete_transient( self::CHOICE_TRANSIENT . (int) $user_id );

		return true;
	}

	/**
	 * Keep redeemed credentials with several candidates as the
	 * administrator's pending choice.
	 *
	 * @param int   $user_id  Administrator.
	 * @param array $redeemed Redeemed credentials with `accounts`.
	 * @return true|WP_Error
	 */
	private static function store_choice( $user_id, array $redeemed ) {
		$unidentified = new WP_Error(
			'instagram_choice_unidentified',
			__( 'Meta shared several Instagram accounts, but they could not be told apart. Nothing was changed; connect again.', 'fair-events-experimental' ),
			array( 'status' => 502 )
		);

		$accounts = self::valid_accounts( $redeemed['accounts'] );
		if ( null === $accounts ) {
			return $unidentified;
		}

		$credentials = $redeemed;
		unset( $credentials['accounts'], $credentials['account_id'], $credentials['username'] );

		// Check the credentials now, so the administrator is not asked to
		// choose an account that could not be connected.
		$checked = Connection::validate_credentials( $credentials + array( 'account_id' => $accounts[0]['id'] ) );
		if ( is_wp_error( $checked ) ) {
			return $checked;
		}
		unset( $checked['account_id'], $checked['username'] );

		$choice   = array(
			'id'          => self::random( 24 ),
			'expires_at'  => time() + self::CHOICE_TTL,
			'accounts'    => $accounts,
			'credentials' => $checked,
		);
		$key      = self::key( 'choice' );
		$envelope = null !== $key ? SecretBox::encrypt( (string) wp_json_encode( $choice ), $key ) : null;
		if ( null === $envelope || ! set_transient( self::CHOICE_TRANSIENT . (int) $user_id, $envelope, self::CHOICE_TTL ) ) {
			return new WP_Error(
				'instagram_choice_not_stored',
				__( 'The Instagram accounts to choose from could not be kept on this site. Nothing was changed; connect again.', 'fair-events-experimental' ),
				array( 'status' => 500 )
			);
		}

		return true;
	}

	/**
	 * Candidates from the service: at least two, each with a distinct
	 * numeric ID and a non-empty username.
	 *
	 * @param mixed $accounts Redeemed `accounts`.
	 * @return array<int, array{id: string, username: string}>|null Null when not a usable choice.
	 */
	private static function valid_accounts( $accounts ) {
		if ( ! is_array( $accounts ) || count( $accounts ) < 2 || count( $accounts ) > self::MAX_CHOICES ) {
			return null;
		}

		$valid = array();
		foreach ( $accounts as $account ) {
			$id       = is_array( $account ) && isset( $account['id'] ) && is_string( $account['id'] ) ? $account['id'] : '';
			$username = is_array( $account ) && isset( $account['username'] ) && is_string( $account['username'] )
				? substr( (string) preg_replace( '/[^A-Za-z0-9._]/', '', $account['username'] ), 0, 64 )
				: '';
			if ( ! preg_match( '/^\d{1,32}$/', $id ) || '' === $username || isset( $valid[ $id ] ) ) {
				return null;
			}
			$valid[ $id ] = array(
				'id'       => $id,
				'username' => $username,
			);
		}

		return array_values( $valid );
	}

	/**
	 * Read an administrator's pending choice, without removing it.
	 *
	 * @param int $user_id Administrator.
	 * @return array|null Choice with credentials, or null when none is pending.
	 */
	private static function read_choice( $user_id ) {
		$envelope = get_transient( self::CHOICE_TRANSIENT . (int) $user_id );
		if ( ! is_string( $envelope ) ) {
			return null;
		}

		$result = SecretBox::decrypt( $envelope, self::key( 'choice' ) );
		$data   = $result->is_readable() && $result->is_encrypted() ? json_decode( (string) $result->value(), true ) : null;

		if (
			! is_array( $data )
			|| ! isset( $data['id'], $data['expires_at'], $data['accounts'], $data['credentials'] )
			|| ! is_string( $data['id'] ) || ! is_int( $data['expires_at'] ) || ! is_array( $data['credentials'] )
			|| $data['expires_at'] < time()
		) {
			return null;
		}

		$accounts = self::valid_accounts( $data['accounts'] );

		return null === $accounts ? null : array_merge( $data, array( 'accounts' => $accounts ) );
	}

	/**
	 * The error for a choice that is not the administrator's current one.
	 *
	 * @return WP_Error
	 */
	private static function choice_unknown() {
		return new WP_Error(
			'instagram_choice_unknown',
			__( 'This Instagram account choice expired, was cancelled, or was replaced by a newer connection attempt. Nothing was changed; connect again.', 'fair-events-experimental' ),
			array( 'status' => 409 )
		);
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

		$result = SecretBox::decrypt( $envelope, self::key( 'attempt' ) );
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
	 * Key that protects attempts or pending choices at rest.
	 *
	 * @param string $purpose `attempt` or `choice`.
	 * @return string|null
	 */
	private static function key( $purpose ) {
		return SecretBox::derive_key( function_exists( 'wp_salt' ) ? wp_salt( 'secure_auth' ) : '', 'fair-events-experimental/instagram-' . $purpose . '/v1' );
	}
}
