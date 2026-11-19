<?php
/**
 * Tests for connecting Instagram through the OAuth service (#2427).
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Instagram;

use FairEventsExperimental\Instagram\Authorization;
use FairEventsExperimental\Instagram\Connection;
use PHPUnit\Framework\TestCase;

/**
 * Authorize URL, state binding and single use, failure codes, and
 * server-side redemption with the verifier.
 */
class AuthorizationTest extends TestCase {

	/**
	 * Clean fixtures.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		if ( ! function_exists( 'sodium_crypto_secretbox' ) ) {
			$this->markTestSkipped( 'Sodium is not available.' );
		}
		$GLOBALS['_fair_test_options']               = array();
		$GLOBALS['_fair_test_filters']               = array();
		$GLOBALS['_fair_test_transients']            = array();
		$GLOBALS['_fair_test_remote_post_requests']  = array();
		unset( $GLOBALS['_fair_test_remote_post_response'] );
	}

	/**
	 * Clear fixtures.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		$GLOBALS['_fair_test_options']    = array();
		$GLOBALS['_fair_test_transients'] = array();
		unset( $GLOBALS['_fair_test_remote_post_response'] );
	}

	/**
	 * Start an attempt and return its query parameters.
	 *
	 * @param int $user_id Administrator.
	 * @return array
	 */
	private function start( $user_id = 7 ) {
		$url = Authorization::start( $user_id );
		$this->assertIsString( $url );
		parse_str( (string) parse_url( $url, PHP_URL_QUERY ), $query ); // phpcs:ignore WordPress.WP.AlternativeFunctions.parse_url_parse_url -- test.
		return array( $url, $query );
	}

	/**
	 * Credentials the service returns on redemption.
	 *
	 * @return array
	 */
	private function redeemed() {
		return array(
			'access_token'  => 'EAAGredeemed',
			'token_type'    => 'system_user',
			'scopes'        => array( 'instagram_basic', 'instagram_content_publish' ),
			'expires_at'    => null,
			'account_id'    => '17841400000000001',
			'username'      => 'events_club',
			'graph_version' => 'v27.0',
		);
	}

	/**
	 * The browser gets only the challenge; the verifier stays encrypted here.
	 *
	 * @return void
	 */
	public function test_start_sends_only_the_challenge() {
		list( $url, $query ) = $this->start();

		$this->assertStringStartsWith( 'https://fair-event-plugins.com/oauth/instagram/authorize?', $url );
		$this->assertSame( '2', $query['protocol'] );
		$this->assertSame( 'https://example.test', $query['site_url'] );
		$this->assertSame( 'https://example.test/wp-admin/admin.php?page=fair-events-instagram', $query['return_url'] );
		$this->assertSame( 'Example & Events', $query['site_name'] );
		$this->assertMatchesRegularExpression( '/^[A-Za-z0-9_-]{43}$/', $query['code_challenge'] );
		$this->assertArrayNotHasKey( 'code_verifier', $query );

		$stored = $GLOBALS['_fair_test_transients'][ Authorization::ATTEMPT_TRANSIENT . '7' ];
		$this->assertStringStartsWith( 'fes-enc:v1:', $stored['value'] );
		$this->assertStringNotContainsString( $query['state'], $stored['value'] );
		$this->assertSame( Authorization::ATTEMPT_TTL, $stored['expiration'] );
	}

	/**
	 * A matching return redeems with the verifier and stores the connection.
	 *
	 * @return void
	 */
	public function test_complete_redeems_with_the_verifier() {
		list( , $query )                           = $this->start();
		$GLOBALS['_fair_test_remote_post_response'] = array(
			'response' => array( 'code' => 200 ),
			'body'     => wp_json_encode( $this->redeemed() ),
		);

		$this->assertTrue( Authorization::complete( 7, $query['state'], str_repeat( 'h', 43 ), '' ) );

		$request = $GLOBALS['_fair_test_remote_post_requests'][0];
		$this->assertSame( 'https://fair-event-plugins.com/wp-json/fair-platform/v1/instagram/redeem', $request['url'] );
		$this->assertSame( str_repeat( 'h', 43 ), $request['args']['body']['handoff'] );
		$this->assertSame( $query['code_challenge'], Authorization::code_challenge( $request['args']['body']['code_verifier'] ) );
		$this->assertSame( 'https://example.test', $request['args']['body']['site_url'] );
		$this->assertSame( 0, $request['args']['redirection'] );

		$this->assertSame( 'EAAGredeemed', Connection::access_token() );
		$this->assertSame( '17841400000000001', Connection::user_id() );
		$this->assertArrayNotHasKey( Authorization::ATTEMPT_TRANSIENT . '7', $GLOBALS['_fair_test_transients'] );
	}

	/**
	 * Another administrator's, an unknown, or a reused state is refused
	 * without redeeming anything.
	 *
	 * @return void
	 */
	public function test_state_is_bound_to_the_administrator_and_single_use() {
		list( , $query ) = $this->start( 7 );

		$this->assertSame( 'instagram_authorization_unknown', Authorization::complete( 8, $query['state'], str_repeat( 'h', 43 ), '' )->get_error_code() );

		list( , $query ) = $this->start( 7 );
		$this->assertSame( 'instagram_authorization_unknown', Authorization::complete( 7, $query['state'] . 'x', str_repeat( 'h', 43 ), '' )->get_error_code() );
		// The mismatch used the attempt up.
		$this->assertSame( 'instagram_authorization_unknown', Authorization::complete( 7, $query['state'], str_repeat( 'h', 43 ), '' )->get_error_code() );

		$this->assertSame( array(), $GLOBALS['_fair_test_remote_post_requests'] );
	}

	/**
	 * Failure codes become actionable messages, with nothing stored.
	 *
	 * @return void
	 */
	public function test_service_failures_store_nothing() {
		foreach ( array( 'cancelled', 'insufficient_permissions', 'no_account', 'multiple_accounts', 'exchange_failed', 'something_new' ) as $code ) {
			list( , $query ) = $this->start();
			$error           = Authorization::complete( 7, $query['state'], '', $code );

			$this->assertSame( 'instagram_authorization_failed', $error->get_error_code() );
			$this->assertStringContainsString( 'Nothing was changed', $error->get_error_message(), $code );
			$this->assertSame( isset( Authorization::service_errors()[ $code ] ) ? $code : 'failed', $error->get_error_data()['reason'] );
		}

		$this->assertSame( array(), $GLOBALS['_fair_test_remote_post_requests'] );
		$this->assertArrayNotHasKey( Connection::TOKEN_OPTION, $GLOBALS['_fair_test_options'] );
	}

	/**
	 * A refused or incomplete redemption keeps the previous connection.
	 *
	 * @return void
	 */
	public function test_failed_redemption_keeps_the_previous_connection() {
		$GLOBALS['_fair_test_options'][ Connection::TOKEN_OPTION ] = 'IGlegacy';

		foreach (
			array(
				array(
					'response' => array( 'code' => 400 ),
					'body'     => '{"code":"instagram_handoff_invalid"}',
				),
				array(
					'response' => array( 'code' => 200 ),
					'body'     => wp_json_encode( array( 'access_token' => 'EAAGpartial' ) ),
				),
			) as $response
		) {
			list( , $query )                           = $this->start();
			$GLOBALS['_fair_test_remote_post_response'] = $response;

			$this->assertInstanceOf( \WP_Error::class, Authorization::complete( 7, $query['state'], str_repeat( 'h', 43 ), '' ) );
			$this->assertSame( 'IGlegacy', get_option( Connection::TOKEN_OPTION ) );
			$this->assertSame( Connection::RECONNECT_REQUIRED, Connection::status() );
		}
	}

	/**
	 * A malformed handoff code is never sent to the service.
	 *
	 * @return void
	 */
	public function test_malformed_handoff_is_not_sent() {
		list( , $query ) = $this->start();

		$this->assertSame( 'instagram_handoff_failed', Authorization::complete( 7, $query['state'], 'short', '' )->get_error_code() );
		$this->assertSame( array(), $GLOBALS['_fair_test_remote_post_requests'] );
	}
}
