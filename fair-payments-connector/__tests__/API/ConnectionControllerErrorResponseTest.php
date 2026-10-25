<?php
/**
 * Connection test error response tests.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\API;

use FairPaymentsConnector\API\ConnectionController;
use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;

/**
 * A failed connection test answers with a generic message; the exception's
 * message and location reach the response only under WP_DEBUG (#860).
 *
 * Each test runs in its own process because WP_DEBUG is a constant.
 */
class ConnectionControllerErrorResponseTest extends TestCase {

	/**
	 * Exception message naming a private path and a diagnostic marker.
	 */
	const DIAGNOSTIC = 'E2E-DIAGNOSTIC-860 in /srv/private/fair-payments/secret.php';

	/**
	 * Run a connection test whose token lookup throws.
	 *
	 * @return \WP_Error
	 */
	private function failed_connection_test() {
		$GLOBALS['_fair_test_options'] = array(
			'fair_payment_mollie_connected'     => true,
			'fair_payment_mollie_access_token'  => 'access_plain',
			'fair_payment_mollie_refresh_token' => 'refresh_plain',
			'fair_payment_mollie_token_expires' => 0,
		);

		$GLOBALS['_fair_test_option_filters'] = array(
			'read' => static function ( $value, $name ) {
				if ( 'fair_payment_mollie_token_expires' === $name ) {
					throw new \RuntimeException( self::DIAGNOSTIC ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- test-only exception.
				}
				return $value;
			},
		);

		$result = ( new ConnectionController() )->test_connection();

		$this->assertInstanceOf( \WP_Error::class, $result );
		$this->assertSame( 'connection_failed', $result->get_error_code() );
		$this->assertSame( 'Connection test failed.', $result->get_error_message() );
		$this->assertSame( 500, $result->get_error_data()['status'] );

		return $result;
	}

	/**
	 * The serialized error body.
	 *
	 * @param \WP_Error $error Error.
	 * @return string
	 */
	private function serialized( $error ) {
		return wp_json_encode(
			array(
				'code'    => $error->get_error_code(),
				'message' => $error->get_error_message(),
				'data'    => $error->get_error_data(),
			)
		);
	}

	/**
	 * Without WP_DEBUG the response carries no diagnostics.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_no_details_when_wp_debug_is_undefined() {
		$error = $this->failed_connection_test();

		$this->assertSame( array( 'status' => 500 ), $error->get_error_data() );
		$this->assertStringNotContainsString( 'E2E-DIAGNOSTIC-860', $this->serialized( $error ) );
		$this->assertStringNotContainsString( '/srv/private', $this->serialized( $error ) );
	}

	/**
	 * With WP_DEBUG off the response carries no diagnostics.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_no_details_when_wp_debug_is_off() {
		define( 'WP_DEBUG', false );

		$error = $this->failed_connection_test();

		$this->assertSame( array( 'status' => 500 ), $error->get_error_data() );
		$this->assertStringNotContainsString( 'E2E-DIAGNOSTIC-860', $this->serialized( $error ) );
		$this->assertStringNotContainsString( '/srv/private', $this->serialized( $error ) );
	}

	/**
	 * With WP_DEBUG on the details are kept, under a generic message.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_details_when_wp_debug_is_on() {
		define( 'WP_DEBUG', true );
		// The debug log is not under test; keep it out of the test output.
		ini_set( 'error_log', '/dev/null' ); // phpcs:ignore WordPress.PHP.IniSet.Risky -- isolated test process.

		$details = $this->failed_connection_test()->get_error_data()['details'];

		$this->assertSame( self::DIAGNOSTIC, $details['message'] );
		$this->assertSame( 0, $details['code'] );
		$this->assertSame( 'ConnectionControllerErrorResponseTest.php', $details['file'] );
		$this->assertIsInt( $details['line'] );
	}
}
