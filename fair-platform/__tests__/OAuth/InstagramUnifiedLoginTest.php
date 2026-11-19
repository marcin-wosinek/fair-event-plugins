<?php
/**
 * Instagram Unified Login rules (#2427): authorization parameters, return
 * destinations, verifier binding, token checks, account selection and the
 * redemption contract. Fixtures follow a sanitized development-mode capture.
 *
 * @package FairPlatform
 */

namespace FairPlatform\Tests\OAuth;

use FairPlatform\OAuth\InstagramOAuthException;
use FairPlatform\OAuth\InstagramUnifiedLogin;
use PHPUnit\Framework\TestCase;

/**
 * Unit tests for InstagramUnifiedLogin.
 */
class InstagramUnifiedLoginTest extends TestCase {

	const SITE     = 'https://events.example';
	const RETURN   = 'https://events.example/wp-admin/admin.php?page=fair-events-instagram';
	const VERIFIER = 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk-plus-more-entropy';

	/**
	 * A valid authorize request.
	 *
	 * @param array $overrides Changed parameters.
	 * @return array
	 */
	private function request( array $overrides = array() ) {
		return array_merge(
			array(
				'protocol'       => '2',
				'site_url'       => self::SITE,
				'return_url'     => self::RETURN,
				'code_challenge' => InstagramUnifiedLogin::code_challenge( self::VERIFIER ),
				'state'          => 'client-state-0123456789',
				'site_name'      => 'Events',
			),
			$overrides
		);
	}

	/**
	 * Assert that a call fails with a code.
	 *
	 * @param string   $reason Expected code.
	 * @param callable $call   Call.
	 * @return void
	 */
	private function assertFailsWith( $reason, callable $call ) {
		try {
			$call();
		} catch ( InstagramOAuthException $e ) {
			$this->assertSame( $reason, $e->reason() );
			return;
		}
		$this->fail( "Expected {$reason}." );
	}

	/** The dialog uses the configuration and the code grant. */
	public function test_authorize_url_uses_the_configuration_and_code_grant() {
		$url = InstagramUnifiedLogin::authorize_url(
			array(
				'app_id'        => '1234',
				'app_secret'    => 'secret',
				'config_id'     => '5678',
				'graph_version' => 'v27.0',
			),
			'https://platform.example/oauth/instagram/callback',
			'state-key'
		);

		$this->assertStringStartsWith( 'https://www.facebook.com/v27.0/dialog/oauth?', $url );
		parse_str( (string) parse_url( $url, PHP_URL_QUERY ), $query );
		$this->assertSame(
			array(
				'client_id'                      => '1234',
				'redirect_uri'                   => 'https://platform.example/oauth/instagram/callback',
				'config_id'                      => '5678',
				'response_type'                  => 'code',
				'override_default_response_type' => 'true',
				'state'                          => 'state-key',
			),
			$query
		);
		$this->assertStringNotContainsString( 'secret', $url );
		$this->assertArrayNotHasKey( 'scope', $query );
	}

	/** Only `vN.N` Graph versions are accepted. */
	public function test_graph_version_format() {
		$this->assertTrue( InstagramUnifiedLogin::is_graph_version( 'v27.0' ) );
		foreach ( array( '27.0', 'v27', 'v27.0/../x', '' ) as $value ) {
			$this->assertFalse( InstagramUnifiedLogin::is_graph_version( $value ) );
		}
	}

	/** A complete request is stored without changes. */
	public function test_valid_authorize_request() {
		$attempt = InstagramUnifiedLogin::validate_authorize_request( $this->request( array( 'site_url' => self::SITE . '/' ) ) );

		$this->assertSame( self::SITE, $attempt['site_url'] );
		$this->assertSame( self::RETURN, $attempt['return_url'] );
		$this->assertSame( 'client-state-0123456789', $attempt['client_state'] );
	}

	/** Sites on the retired flow are told to update. */
	public function test_old_clients_are_rejected_as_outdated() {
		$this->assertFailsWith(
			InstagramUnifiedLogin::ERROR_CLIENT_OUTDATED,
			function () {
				InstagramUnifiedLogin::validate_authorize_request(
					array(
						'site_id'    => 'ZXZlbnRzLmV4YW1wbGU=',
						'return_url' => self::RETURN,
					)
				);
			}
		);
	}

	/** A missing or malformed challenge or state is refused. */
	public function test_malformed_challenge_or_state_is_refused() {
		foreach ( array( array( 'code_challenge' => '' ), array( 'code_challenge' => 'short' ), array( 'state' => 'x' ), array( 'state' => str_repeat( 'a', 20 ) . '<' ) ) as $override ) {
			$this->assertFailsWith(
				InstagramUnifiedLogin::ERROR_INVALID_REQUEST,
				function () use ( $override ) {
					InstagramUnifiedLogin::validate_authorize_request( $this->request( $override ) );
				}
			);
		}
	}

	/** Only the site's own Fair Events → Instagram page is an approved return. */
	public function test_return_destination_must_be_the_sites_instagram_page() {
		$this->assertTrue( InstagramUnifiedLogin::is_approved_return_url( self::RETURN, self::SITE ) );
		$this->assertTrue( InstagramUnifiedLogin::is_approved_return_url( 'https://example.org/blog/wp-admin/admin.php?page=fair-events-instagram', 'https://example.org/blog' ) );
		$this->assertTrue( InstagramUnifiedLogin::is_approved_return_url( 'http://localhost:8889/wp-admin/admin.php?page=fair-events-instagram', 'http://localhost:8889' ) );

		$refused = array(
			'http://events.example/wp-admin/admin.php?page=fair-events-instagram' => 'http://events.example',
			'https://evil.example/wp-admin/admin.php?page=fair-events-instagram' => self::SITE,
			'https://events.example.evil.example/wp-admin/admin.php?page=fair-events-instagram' => self::SITE,
			'https://events.example:8443/wp-admin/admin.php?page=fair-events-instagram' => self::SITE,
			'https://user:pass@events.example/wp-admin/admin.php?page=fair-events-instagram' => self::SITE,
			'https://events.example/wp-admin/admin.php?page=fair-events-instagram#x' => self::SITE,
			'https://events.example/wp-admin/admin.php?page=fair-events-instagram&next=https://evil.example' => self::SITE,
			'https://events.example/wp-admin/admin.php?page=other' => self::SITE,
			'https://events.example/wp-admin/options.php?page=fair-events-instagram' => self::SITE,
			'https://events.example/x/wp-admin/admin.php?page=fair-events-instagram' => self::SITE,
			'https://events.example/wp-admin/admin.php?page=fair-events-instagram ' => self::SITE,
			'javascript://events.example/wp-admin/admin.php?page=fair-events-instagram' => self::SITE,
			'//events.example/wp-admin/admin.php?page=fair-events-instagram' => self::SITE,
		);
		foreach ( $refused as $return => $site ) {
			$this->assertFalse( InstagramUnifiedLogin::is_approved_return_url( $return, $site ), $return );
		}
	}

	/** Failures and the handoff go back with the site's own state. */
	public function test_redirects_carry_the_client_state() {
		$attempt = InstagramUnifiedLogin::validate_authorize_request( $this->request() );

		$this->assertSame( self::RETURN . '&instagram_error=cancelled&state=client-state-0123456789', InstagramUnifiedLogin::error_redirect_url( $attempt, 'cancelled' ) );
		$this->assertSame( self::RETURN . '&instagram_handoff=abc-_123&state=client-state-0123456789', InstagramUnifiedLogin::success_redirect_url( $attempt, 'abc-_123' ) );
	}

	/** Meta's cancellation is reported as cancelled, anything else as failed. */
	public function test_callback_errors() {
		$this->assertSame( 'cancelled', InstagramUnifiedLogin::callback_error( 'access_denied', 'user_denied' ) );
		$this->assertSame( 'authorization_failed', InstagramUnifiedLogin::callback_error( 'server_error', '' ) );
	}

	/** The verifier must hash to the stored challenge. */
	public function test_verifier_binding() {
		$challenge = InstagramUnifiedLogin::code_challenge( self::VERIFIER );

		$this->assertTrue( InstagramUnifiedLogin::verifier_matches( self::VERIFIER, $challenge ) );
		$this->assertFalse( InstagramUnifiedLogin::verifier_matches( self::VERIFIER . 'x', $challenge ) );
		$this->assertFalse( InstagramUnifiedLogin::verifier_matches( 'short', InstagramUnifiedLogin::code_challenge( 'short' ) ) );
		// RFC 7636 appendix B.
		$this->assertSame( 'E9Melhoa2OwvFrEMTJguCHaoeK1t8URWbuGJSstw-cM', InstagramUnifiedLogin::code_challenge( 'dBjftJeZ4CVP-mB92K27uhbUJU1p1r_wW1gFWFOEjXk' ) );
	}

	/**
	 * `debug_token` for the captured configuration.
	 *
	 * @param array $overrides Changed fields.
	 * @return array
	 */
	private function debug_token( array $overrides = array() ) {
		return array(
			'data' => array_merge(
				array(
					'app_id'                 => '1234',
					'type'                   => 'SYSTEM_USER',
					'application'            => 'Fair Events Connector',
					'data_access_expires_at' => 0,
					'expires_at'             => 0,
					'is_valid'               => true,
					'issued_at'              => 1795084213,
					'scopes'                 => array( 'instagram_basic', 'instagram_manage_comments', 'instagram_content_publish', 'instagram_manage_messages', 'public_profile' ),
					'user_id'                => '900000000000001',
				),
				$overrides
			),
		);
	}

	/** A system-user token that does not expire is accepted as such. */
	public function test_non_expiring_system_user_token() {
		$token = InstagramUnifiedLogin::evaluate_token( $this->debug_token(), '1234' );

		$this->assertSame( 'system_user', $token['token_type'] );
		$this->assertNull( $token['expires_at'] );
		$this->assertContains( 'instagram_content_publish', $token['scopes'] );
	}

	/** A finite expiry is kept as given. */
	public function test_finite_expiry_is_kept() {
		$token = InstagramUnifiedLogin::evaluate_token(
			$this->debug_token(
				array(
					'type'       => 'USER',
					'expires_at' => 1800000000,
				)
			),
			'1234'
		);

		$this->assertSame( 'user', $token['token_type'] );
		$this->assertSame( 1800000000, $token['expires_at'] );
	}

	/** Missing publishing permission is reported as such. */
	public function test_missing_publish_permission() {
		$this->assertFailsWith(
			InstagramUnifiedLogin::ERROR_INSUFFICIENT_PERMISSIONS,
			function () {
				InstagramUnifiedLogin::evaluate_token( $this->debug_token( array( 'scopes' => array( 'instagram_basic' ) ) ), '1234' );
			}
		);
	}

	/** Invalid, foreign, unknown-type or malformed tokens fail the exchange. */
	public function test_unusable_tokens_fail_the_exchange() {
		foreach (
			array(
				$this->debug_token( array( 'is_valid' => false ) ),
				$this->debug_token( array( 'app_id' => '9999' ) ),
				$this->debug_token( array( 'type' => 'PAGE' ) ),
				$this->debug_token( array( 'expires_at' => '0' ) ),
				array( 'error' => array( 'message' => 'x' ) ),
				null,
			) as $response
		) {
			$this->assertFailsWith(
				InstagramUnifiedLogin::ERROR_EXCHANGE_FAILED,
				function () use ( $response ) {
					InstagramUnifiedLogin::evaluate_token( $response, '1234' );
				}
			);
		}
	}

	/** Exactly one shared account is selected. */
	public function test_single_account_is_selected() {
		$account = InstagramUnifiedLogin::select_account(
			array(
				'data'   => array(
					array(
						'id'       => '17841400000000001',
						'username' => 'events_club',
					),
				),
				'paging' => array( 'cursors' => array( 'before' => 'a' ) ),
			)
		);

		$this->assertSame(
			array(
				'id'       => '17841400000000001',
				'username' => 'events_club',
			),
			$account
		);
	}

	/** No account, several accounts, or a further page are refused. */
	public function test_zero_or_several_accounts_are_refused() {
		$this->assertFailsWith(
			InstagramUnifiedLogin::ERROR_NO_ACCOUNT,
			function () {
				InstagramUnifiedLogin::select_account( array( 'data' => array() ) );
			}
		);

		foreach (
			array(
				array(
					'data' => array(
						array( 'id' => '1001' ),
						array( 'id' => '1002' ),
					),
				),
				array(
					'data'   => array( array( 'id' => '1001' ) ),
					'paging' => array( 'next' => 'https://graph.facebook.com/next' ),
				),
			) as $response
		) {
			$this->assertFailsWith(
				InstagramUnifiedLogin::ERROR_MULTIPLE_ACCOUNTS,
				function () use ( $response ) {
					InstagramUnifiedLogin::select_account( $response );
				}
			);
		}

		$this->assertFailsWith(
			InstagramUnifiedLogin::ERROR_EXCHANGE_FAILED,
			function () {
				InstagramUnifiedLogin::select_account( array( 'error' => array() ) );
			}
		);
	}

	/**
	 * A stored handoff for the test site.
	 *
	 * @return array
	 */
	private function payload() {
		$attempt = InstagramUnifiedLogin::validate_authorize_request( $this->request() );

		return InstagramUnifiedLogin::handoff_payload(
			'EAAG-secret-token',
			InstagramUnifiedLogin::evaluate_token( $this->debug_token(), '1234' ),
			array(
				'id'       => '17841400000000001',
				'username' => 'events_club',
			),
			$attempt,
			'v27.0'
		);
	}

	/** The site that holds the verifier gets the credentials, without the binding. */
	public function test_redemption_returns_credentials_to_the_verifier_holder() {
		$credentials = InstagramUnifiedLogin::redemption( $this->payload(), self::VERIFIER, self::SITE . '/' );

		$this->assertSame( 'EAAG-secret-token', $credentials['access_token'] );
		$this->assertSame( '17841400000000001', $credentials['account_id'] );
		$this->assertSame( 'system_user', $credentials['token_type'] );
		$this->assertNull( $credentials['expires_at'] );
		$this->assertArrayNotHasKey( 'code_challenge', $credentials );
		$this->assertArrayNotHasKey( 'site_url', $credentials );
	}

	/** A wrong verifier, another site, or a missing handoff are refused. */
	public function test_redemption_refusals() {
		foreach (
			array(
				array( $this->payload(), self::VERIFIER . 'x', self::SITE ),
				array( $this->payload(), self::VERIFIER, 'https://other.example' ),
				array( null, self::VERIFIER, self::SITE ),
			) as $args
		) {
			$this->assertFailsWith(
				InstagramUnifiedLogin::ERROR_INVALID_REQUEST,
				function () use ( $args ) {
					InstagramUnifiedLogin::redemption( ...$args );
				}
			);
		}
	}
}
