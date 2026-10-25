<?php
/**
 * Webhook error response tests.
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\API;

use FairPaymentsConnector\API\WebhookEndpoint;
use PHPUnit\Framework\TestCase;
use PHPUnit\Framework\Attributes\PreserveGlobalState;
use PHPUnit\Framework\Attributes\RunInSeparateProcess;

/**
 * A webhook that fails while it is handled is acknowledged with a generic
 * error in every mode; the exception stays in the payment log (#860).
 *
 * Each test runs in its own process because WP_DEBUG is a constant.
 */
class WebhookEndpointErrorResponseTest extends TestCase {

	/**
	 * Exception message naming a private path and a diagnostic marker.
	 */
	const DIAGNOSTIC = 'E2E-DIAGNOSTIC-860 in /srv/private/fair-payments/secret.php';

	/**
	 * Handle a webhook whose transaction lookup throws, and check the answer.
	 */
	private function assert_generic_answer_and_logged_exception() {
		// The repository mirrors error entries to error_log; keep them out of
		// the test output.
		ini_set( 'error_log', '/dev/null' ); // phpcs:ignore WordPress.PHP.IniSet.Risky -- isolated test process.

		$wpdb = new class() extends \Fair_Test_WPDB {
			/**
			 * Stub of $wpdb->prepare().
			 *
			 * @param string $query Query.
			 * @return string
			 */
			public function prepare( $query ) {
				return $query;
			}

			/**
			 * The transaction lookup fails.
			 *
			 * @throws \RuntimeException Always.
			 */
			public function get_row() {
				throw new \RuntimeException( WebhookEndpointErrorResponseTest::DIAGNOSTIC ); // phpcs:ignore WordPress.Security.EscapeOutput.ExceptionNotEscaped -- test-only exception.
			}
		};

		$GLOBALS['wpdb'] = $wpdb; // phpcs:ignore WordPress.WP.GlobalVariablesOverride.Prohibited -- isolated test process.

		$response = ( new WebhookEndpoint() )->handle_webhook( new \WP_REST_Request( array( 'id' => 'tr_e2e860' ) ) );

		$this->assertSame( 200, $response->status );
		$this->assertSame(
			array(
				'success' => false,
				'error'   => 'The payment update could not be processed.',
			),
			$response->data
		);
		$this->assertStringNotContainsString( 'E2E-DIAGNOSTIC-860', wp_json_encode( $response->data ) );

		$logged = array_values(
			array_filter(
				$wpdb->inserted_rows,
				static function ( $row ) {
					return 'webhook_failed' === $row['event'];
				}
			)
		);
		$this->assertCount( 1, $logged );
		$this->assertSame( 'error', $logged[0]['level'] );
		$this->assertSame( 'Webhook handler exception: ' . self::DIAGNOSTIC, $logged[0]['message'] );
		$this->assertSame(
			array(
				'exception_class'   => 'RuntimeException',
				'mollie_payment_id' => 'tr_e2e860',
			),
			json_decode( $logged[0]['context'], true )
		);
	}

	/**
	 * WP_DEBUG undefined.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_generic_answer_when_wp_debug_is_undefined() {
		$this->assert_generic_answer_and_logged_exception();
	}

	/**
	 * WP_DEBUG off.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_generic_answer_when_wp_debug_is_off() {
		define( 'WP_DEBUG', false );

		$this->assert_generic_answer_and_logged_exception();
	}

	/**
	 * WP_DEBUG on: the answer stays generic.
	 */
	#[RunInSeparateProcess]
	#[PreserveGlobalState( false )]
	public function test_generic_answer_when_wp_debug_is_on() {
		define( 'WP_DEBUG', true );

		$this->assert_generic_answer_and_logged_exception();
	}
}
