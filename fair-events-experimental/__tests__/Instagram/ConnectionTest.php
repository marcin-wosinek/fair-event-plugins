<?php
/**
 * Tests for the Instagram connection (#2427: Unified Login).
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Instagram;

use FairEventsExperimental\Instagram\Connection;
use PHPUnit\Framework\TestCase;

/**
 * Mandatory reconnection of earlier connections, credential checks,
 * storage of the token lifecycle, the connection test and redaction.
 */
class ConnectionTest extends TestCase {

	/**
	 * Credentials as the OAuth service redeems them.
	 *
	 * @param array $overrides Changed fields.
	 * @return array
	 */
	private function credentials( array $overrides = array() ) {
		return array_merge(
			array(
				'access_token'  => 'EAAGunified123',
				'token_type'    => 'system_user',
				'scopes'        => array( 'instagram_basic', 'instagram_content_publish', 'instagram_manage_comments' ),
				'expires_at'    => null,
				'account_id'    => '17841400000000001',
				'username'      => 'events_club',
				'graph_version' => 'v27.0',
			),
			$overrides
		);
	}

	/**
	 * A connection stored before #2427, through Instagram Login.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_filters']              = array();
		$GLOBALS['_fair_test_remote_get_requests']  = array();
		$GLOBALS['_fair_test_remote_get_responses'] = array();
		$GLOBALS['_fair_test_options']              = array(
			'fair_audience_instagram_access_token'  => 'IGlegacy123',
			'fair_audience_instagram_user_id'       => '17841400123456789',
			'fair_audience_instagram_username'      => 'demo_events',
			'fair_audience_instagram_connected'     => true,
			'fair_audience_instagram_token_expires' => 1900000000,
		);
	}

	/**
	 * Clear fixtures.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		$GLOBALS['_fair_test_options']              = array();
		$GLOBALS['_fair_test_filters']              = array();
		$GLOBALS['_fair_test_remote_get_responses'] = array();
	}

	/**
	 * Connect with the default credentials.
	 *
	 * @return void
	 */
	private function connect_unified() {
		$this->assertTrue( Connection::connect( Connection::validate_credentials( $this->credentials() ) ) );
	}

	/**
	 * An earlier connection stays stored but cannot be used.
	 *
	 * @return void
	 */
	public function test_earlier_connection_must_reconnect() {
		$this->assertSame( Connection::RECONNECT_REQUIRED, Connection::status() );
		$this->assertFalse( Connection::is_connected() );
		$this->assertSame( '', Connection::access_token() );
		$this->assertSame( 'instagram_credentials_unavailable', Connection::unavailable_reason()->get_error_code() );
		$this->assertStringContainsString( 'reconnected', Connection::admin_message( Connection::RECONNECT_REQUIRED ) );

		$result = Connection::test();
		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 409, $result->get_error_data()['status'] );
		$this->assertSame( array(), $GLOBALS['_fair_test_remote_get_requests'] );

		// Nothing is removed until the administrator reconnects or disconnects.
		$this->assertSame( 'IGlegacy123', get_option( Connection::TOKEN_OPTION ) );
	}

	/**
	 * Details never include the token, and say how long it works.
	 *
	 * @return void
	 */
	public function test_details_omit_the_token() {
		$this->connect_unified();
		$details = Connection::details();

		$this->assertTrue( $details['usable'] );
		$this->assertSame( 'events_club', $details['username'] );
		$this->assertSame( '17841400000000001', $details['user_id'] );
		$this->assertSame( 'unified_login', $details['connection_format'] );
		$this->assertSame( 'system_user', $details['token_type'] );
		$this->assertSame( 'never', $details['token_expiry'] );
		$this->assertNull( $details['token_expires'] );
		$this->assertStringNotContainsString( 'EAAGunified123', (string) wp_json_encode( $details ) );
	}

	/**
	 * A new connection replaces an earlier one with all its metadata; a
	 * non-expiring token keeps older renewers away.
	 *
	 * @return void
	 */
	public function test_connect_stores_metadata_and_marker() {
		$this->connect_unified();

		$this->assertSame( Connection::AVAILABLE, Connection::status() );
		$this->assertSame( 'EAAGunified123', Connection::access_token() );
		$this->assertSame( 'unified_login', get_option( Connection::FORMAT_OPTION ) );
		$this->assertSame( 'never', get_option( Connection::EXPIRY_OPTION ) );
		$this->assertSame( Connection::NEVER_EXPIRES_SENTINEL, get_option( Connection::EXPIRES_OPTION ) );
		$this->assertSame( 'https://graph.facebook.com/v27.0', Connection::graph_base() );

		$this->assertNull( Connection::unavailable_reason() );
	}

	/**
	 * A token with a finite expiry stops being used once it expires.
	 *
	 * @return void
	 */
	public function test_finite_expiry() {
		$this->assertTrue( Connection::connect( Connection::validate_credentials( $this->credentials( array( 'expires_at' => time() + 3600 ) ) ) ) );
		$this->assertSame( Connection::AVAILABLE, Connection::status() );
		$this->assertSame( 'expires', Connection::details()['token_expiry'] );

		update_option( Connection::EXPIRES_OPTION, time() - 1 );

		$this->assertSame( Connection::EXPIRED, Connection::status() );
		$this->assertSame( '', Connection::access_token() );
	}

	/**
	 * Incomplete or under-permissioned credentials are refused.
	 *
	 * @return void
	 */
	public function test_validate_credentials_refusals() {
		$this->assertSame( 'instagram_permissions_missing', Connection::validate_credentials( $this->credentials( array( 'scopes' => array( 'instagram_basic' ) ) ) )->get_error_code() );

		foreach (
			array(
				array( 'access_token' => '' ),
				array( 'access_token' => 'a b' ),
				array( 'token_type' => 'instagram' ),
				array( 'account_id' => 'me' ),
				array( 'graph_version' => '27' ),
				array( 'expires_at' => '0' ),
				array( 'expires_at' => time() - 10 ),
			) as $override
		) {
			$this->assertSame( 'instagram_credentials_incomplete', Connection::validate_credentials( $this->credentials( $override ) )->get_error_code(), wp_json_encode( $override ) );
		}

		$this->assertSame( 'instagram_credentials_incomplete', Connection::validate_credentials( null )->get_error_code() );
	}

	/**
	 * Disconnecting removes the token and every detail.
	 *
	 * @return void
	 */
	public function test_disconnect_removes_everything() {
		$this->connect_unified();

		Connection::disconnect();

		$this->assertSame( 'instagram_not_connected', Connection::unavailable_reason()->get_error_code() );
		foreach ( array( Connection::TOKEN_OPTION, Connection::FORMAT_OPTION, Connection::TOKEN_TYPE_OPTION, Connection::SCOPES_OPTION, Connection::EXPIRY_OPTION, Connection::GRAPH_VERSION_OPTION ) as $option ) {
			$this->assertArrayNotHasKey( $option, $GLOBALS['_fair_test_options'], $option );
		}
		$this->assertFalse( get_option( Connection::CONNECTED_OPTION ) );
		$this->assertSame( '', get_option( Connection::USER_ID_OPTION ) );
	}

	/**
	 * Meta's messages are stored without the token.
	 *
	 * @return void
	 */
	public function test_redact() {
		$this->assertSame(
			'bad [redacted] at /me?access_token=[redacted]&x=1',
			Connection::redact( 'bad IGplain123 at /me?access_token=other&x=1', 'IGplain123' )
		);
	}

	/**
	 * The test asks graph.facebook.com for the connected account, with the
	 * token in a header rather than the URL.
	 *
	 * @return void
	 */
	public function test_test_reads_the_account_on_graph_facebook() {
		$this->connect_unified();
		$GLOBALS['_fair_test_remote_get_responses'] = array(
			array(
				'response' => array( 'code' => 200 ),
				'body'     => wp_json_encode(
					array(
						'id'       => '17841400000000001',
						'username' => 'renamed_club',
					)
				),
			),
		);

		$result = Connection::test();

		$this->assertTrue( $result['success'] );
		$request = $GLOBALS['_fair_test_remote_get_requests'][0];
		$this->assertSame( 'https://graph.facebook.com/v27.0/17841400000000001?fields=id,username', $request['url'] );
		$this->assertSame( 'Bearer EAAGunified123', $request['args']['headers']['Authorization'] );
		$this->assertSame( 'renamed_club', get_option( Connection::USERNAME_OPTION ) );
		$this->assertStringNotContainsString( 'EAAGunified123', (string) wp_json_encode( $result ) );
	}

	/**
	 * A revoked token is reported without its value.
	 *
	 * @return void
	 */
	public function test_test_reports_a_revoked_token_without_the_token() {
		$this->connect_unified();
		$GLOBALS['_fair_test_remote_get_responses'] = array(
			array(
				'response' => array( 'code' => 400 ),
				'body'     => wp_json_encode(
					array(
						'error' => array(
							'message' => 'Error validating access token EAAGunified123',
							'code'    => 190,
						),
					)
				),
			),
		);

		$result = Connection::test();

		$this->assertSame( 'instagram_token_invalid', $result->get_error_code() );
		$this->assertStringNotContainsString( 'EAAGunified123', (string) wp_json_encode( $result->get_error_data() ) );
	}

	/**
	 * Lost access to the account, or an answer for another account, ask to
	 * reconnect.
	 *
	 * @return void
	 */
	public function test_test_reports_account_problems() {
		$this->connect_unified();
		$GLOBALS['_fair_test_remote_get_responses'] = array(
			array(
				'response' => array( 'code' => 400 ),
				'body'     => wp_json_encode(
					array(
						'error' => array(
							'message' => 'Unsupported get request.',
							'code'    => 100,
						),
					)
				),
			),
			array(
				'response' => array( 'code' => 200 ),
				'body'     => wp_json_encode( array( 'id' => '999' ) ),
			),
		);

		$this->assertSame( 'instagram_account_unavailable', Connection::test()->get_error_code() );
		$this->assertSame( 'instagram_account_mismatch', Connection::test()->get_error_code() );
	}
}
