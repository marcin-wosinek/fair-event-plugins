<?php
/**
 * Tests for the Instagram connection used by manual posting (#2427).
 *
 * @package FairAudienceExperimental
 */

namespace FairAudienceExperimental\Tests\Services;

use FairAudienceExperimental\Services\InstagramConnection;
use PHPUnit\Framework\TestCase;

/**
 * While Fair Audience owns the connection: only Unified Login connections
 * publish, to graph.facebook.com.
 */
class InstagramConnectionTest extends TestCase {

	/**
	 * A Unified Login connection.
	 *
	 * @return void
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_options'] = array(
			'fair_audience_instagram_access_token'      => 'EAAGunified',
			'fair_audience_instagram_user_id'           => '17841400000000001',
			'fair_audience_instagram_connected'         => true,
			'fair_audience_instagram_connection_format' => 'unified_login',
			'fair_audience_instagram_token_expiry'      => 'never',
			'fair_audience_instagram_token_expires'     => 4102444800,
			'fair_audience_instagram_graph_version'     => 'v27.0',
		);
	}

	/**
	 * Clear fixtures.
	 *
	 * @return void
	 */
	protected function tearDown(): void {
		$GLOBALS['_fair_test_options'] = array();
	}

	/**
	 * A Unified Login connection publishes to graph.facebook.com.
	 *
	 * @return void
	 */
	public function test_unified_connection_publishes_on_graph_facebook() {
		$this->assertNull( InstagramConnection::unavailable_reason() );
		$this->assertSame( 'EAAGunified', InstagramConnection::access_token() );
		$this->assertSame( '17841400000000001', InstagramConnection::user_id() );
		$this->assertSame( 'https://graph.facebook.com/v27.0', InstagramConnection::graph_base() );
	}

	/**
	 * A version that is not `vN.N` falls back to the default.
	 *
	 * @return void
	 */
	public function test_graph_version_falls_back() {
		$GLOBALS['_fair_test_options']['fair_audience_instagram_graph_version'] = '../v1';

		$this->assertSame( 'https://graph.facebook.com/v27.0', InstagramConnection::graph_base() );
	}

	/**
	 * A connection from before #2427 is never used.
	 *
	 * @return void
	 */
	public function test_earlier_connection_must_reconnect() {
		unset( $GLOBALS['_fair_test_options']['fair_audience_instagram_connection_format'] );

		$this->assertSame( 'instagram_reconnect_required', InstagramConnection::unavailable_reason()->get_error_code() );
		$this->assertSame( '', InstagramConnection::access_token() );
	}

	/**
	 * An expired finite token is never used.
	 *
	 * @return void
	 */
	public function test_expired_token_is_not_used() {
		$GLOBALS['_fair_test_options']['fair_audience_instagram_token_expiry']  = 'expires';
		$GLOBALS['_fair_test_options']['fair_audience_instagram_token_expires'] = time() - 1;

		$this->assertSame( 'instagram_token_expired', InstagramConnection::unavailable_reason()->get_error_code() );
		$this->assertSame( '', InstagramConnection::access_token() );
	}

	/**
	 * Without a connection, the reason says where to connect.
	 *
	 * @return void
	 */
	public function test_not_connected() {
		$GLOBALS['_fair_test_options'] = array();

		$error = InstagramConnection::unavailable_reason();
		$this->assertSame( 'instagram_not_configured', $error->get_error_code() );
		$this->assertStringContainsString( 'Fair Events → Instagram', $error->get_error_message() );
	}
}
