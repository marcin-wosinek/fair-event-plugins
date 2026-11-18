<?php
/**
 * Tests for the Instagram connection.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Tests\Instagram;

use FairEventsExperimental\Instagram\Connection;
use PHPUnit\Framework\TestCase;

/**
 * Stored-connection compatibility, token refresh timing and redaction.
 */
class ConnectionTest extends TestCase {

	/**
	 * A connection stored by Fair Audience, with a plaintext token.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_filters']             = array();
		$GLOBALS['_fair_test_remote_get_requests'] = array();
		$GLOBALS['_fair_test_options']             = array(
			'fair_audience_instagram_access_token'  => 'IGplain123',
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
	 * The option names are Fair Audience's, so nothing is re-entered.
	 *
	 * @return void
	 */
	public function test_reads_the_connection_fair_audience_stored() {
		$this->assertSame( 'fair_audience_instagram_access_token', Connection::TOKEN_OPTION );
		$this->assertSame( Connection::AVAILABLE, Connection::status() );
		$this->assertTrue( Connection::is_connected() );
		$this->assertSame( 'IGplain123', Connection::access_token() );
		$this->assertNull( Connection::unavailable_reason() );
	}

	/**
	 * Details never include the token.
	 *
	 * @return void
	 */
	public function test_details_omit_the_token() {
		$details = Connection::details();

		$this->assertSame( 'demo_events', $details['username'] );
		$this->assertSame( '17841400123456789', $details['user_id'] );
		$this->assertSame( 1900000000, $details['token_expires'] );
		$this->assertStringNotContainsString( 'IGplain123', (string) wp_json_encode( $details ) );
	}

	/**
	 * Missing pieces are reported with what to do.
	 *
	 * @return void
	 */
	public function test_unavailable_reasons() {
		$GLOBALS['_fair_test_options']['fair_audience_instagram_user_id'] = '';
		$this->assertSame( 'instagram_user_id_missing', Connection::unavailable_reason()->get_error_code() );

		Connection::disconnect();
		$this->assertSame( 'instagram_not_connected', Connection::unavailable_reason()->get_error_code() );
		$this->assertArrayNotHasKey( Connection::TOKEN_OPTION, $GLOBALS['_fair_test_options'] );
		$this->assertFalse( get_option( Connection::CONNECTED_OPTION ) );
	}

	/**
	 * Refreshed in the last week, or when the expiry is unknown.
	 *
	 * @return void
	 */
	public function test_needs_refresh() {
		$now = 1800000000;
		$this->assertTrue( Connection::needs_refresh( 0, $now ) );
		$this->assertTrue( Connection::needs_refresh( $now + 3600, $now ) );
		$this->assertTrue( Connection::needs_refresh( $now + Connection::REFRESH_WINDOW, $now ) );
		$this->assertFalse( Connection::needs_refresh( $now + Connection::REFRESH_WINDOW + 1, $now ) );
	}

	/**
	 * Instagram's messages are stored without the token.
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
	 * A refused token is reported without its value.
	 *
	 * @return void
	 */
	public function test_test_reports_a_refused_token_without_the_token() {
		$GLOBALS['_fair_test_remote_get_responses'] = array(
			array(
				'response' => array( 'code' => 400 ),
				'body'     => wp_json_encode( array( 'error' => array( 'message' => 'Invalid OAuth access token IGplain123' ) ) ),
			),
		);

		$result = Connection::test();

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'instagram_token_invalid', $result->get_error_code() );
		$this->assertStringNotContainsString( 'IGplain123', (string) wp_json_encode( $result->get_error_data() ) );
	}

	/**
	 * A successful test stores the account Instagram names.
	 *
	 * @return void
	 */
	public function test_test_stores_the_account() {
		$GLOBALS['_fair_test_options']['fair_audience_instagram_user_id'] = '';
		$GLOBALS['_fair_test_remote_get_responses']                       = array(
			array(
				'response' => array( 'code' => 200 ),
				'body'     => wp_json_encode(
					array(
						'user_id'  => '17841400999',
						'username' => 'renamed_events',
					)
				),
			),
		);

		$result = Connection::test();

		$this->assertIsArray( $result );
		$this->assertTrue( $result['success'] );
		$this->assertSame( '17841400999', get_option( Connection::USER_ID_OPTION ) );
		$this->assertSame( 'renamed_events', get_option( Connection::USERNAME_OPTION ) );
	}
}
