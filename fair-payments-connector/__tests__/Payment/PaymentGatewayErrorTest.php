<?php
/**
 * PaymentGatewayError interpretation and sanitization tests.
 *
 * Locks the security-critical guarantee behind #1209: the WP_Error returned
 * to REST consumers never carries the gateway's decorated message (request
 * body, IDs, URLs) — only a generic visitor message plus, for a
 * capability-checked admin, an interpreted cause and fix-it links built from
 * stable identifiers (status + plain message).
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Tests\Payment;

use PHPUnit\Framework\TestCase;
use FairPaymentsConnector\Payment\PaymentGatewayError;
use Mollie\Api\MollieApiClient;
use Mollie\Api\Fake\MockResponse;
use Mollie\Api\Http\Requests\CreatePaymentRequest;
use Mollie\Api\Exceptions\ApiException;

/**
 * Unit tests for PaymentGatewayError.
 */
class PaymentGatewayErrorTest extends TestCase {

	/**
	 * Reset shared test state before each test.
	 */
	protected function setUp(): void {
		$GLOBALS['_fair_test_current_user_can'] = false;
	}

	/**
	 * Drive a real ApiException out of the Mollie SDK's fake HTTP layer, the
	 * same way MolliePaymentHandlerTest does, so we test against the SDK's
	 * actual decorated-message shape rather than a hand-rolled stand-in.
	 *
	 * @param int    $status HTTP status code.
	 * @param string $title  Error title (e.g. 'Unprocessable Entity').
	 * @param string $detail Error detail — the text interpretation matches against.
	 * @return ApiException
	 */
	private function api_exception( int $status, string $title, string $detail ): ApiException {
		$mollie = MollieApiClient::fake(
			array(
				CreatePaymentRequest::class => MockResponse::error( $status, $title, $detail ),
			)
		);

		try {
			$mollie->payments->create(
				array(
					'amount'      => array(
						'currency' => 'EUR',
						'value'    => '10.00',
					),
					'description' => 'Test',
					'redirectUrl' => 'https://example.test',
				),
				array(),
				true
			);
		} catch ( ApiException $e ) {
			return $e;
		}

		$this->fail( 'Expected ApiException was not thrown.' );
	}

	/**
	 * The "not activated" 422 must be recognised and produce the specific
	 * cause plus Settings, payment log, and Mollie dashboard links.
	 */
	public function test_not_activated_error_is_recognised_for_admin() {
		$GLOBALS['_fair_test_current_user_can'] = true;

		$e     = $this->api_exception( 422, 'Unprocessable Entity', 'The payment method is not activated on your account.' );
		$error = PaymentGatewayError::from_api_exception( $e )->to_wp_error( 42 );

		$admin = $error->get_error_data()['admin'];

		$this->assertStringContainsString( 'no suitable payment method enabled', $admin['cause'] );

		$labels = array_column( $admin['links'], 'label' );
		$this->assertContains( 'Payment settings', $labels );
		$this->assertContains( 'Payment log', $labels );
		$this->assertContains( 'Mollie dashboard', $labels );

		$log_link = current(
			array_filter( $admin['links'], static fn( $link ) => 'Payment log' === $link['label'] )
		);
		$this->assertStringContainsString( 'transaction_id=42', $log_link['url'] );
	}

	/**
	 * An unrecognised gateway error must fall back to a generic cause with
	 * Settings + log links only — no dashboard link, since we don't know the
	 * cause is method-activation-related.
	 */
	public function test_unrecognised_error_falls_back_to_generic_cause() {
		$GLOBALS['_fair_test_current_user_can'] = true;

		$e     = $this->api_exception( 500, 'Internal Server Error', 'Something unexpected happened deep in the gateway.' );
		$error = PaymentGatewayError::from_api_exception( $e )->to_wp_error( 42 );

		$admin = $error->get_error_data()['admin'];

		$labels = array_column( $admin['links'], 'label' );
		$this->assertContains( 'Payment settings', $labels );
		$this->assertContains( 'Payment log', $labels );
		$this->assertNotContains( 'Mollie dashboard', $labels );
	}

	/**
	 * A non-gateway failure (no ApiException at all) must also fall back to
	 * the generic cause — the fallback path in TransactionAPI::initiate_payment()
	 * uses PaymentGatewayError::generic() for this case.
	 */
	public function test_generic_error_has_no_gateway_specific_cause() {
		$GLOBALS['_fair_test_current_user_can'] = true;

		$error = PaymentGatewayError::generic()->to_wp_error( 42 );
		$admin = $error->get_error_data()['admin'];

		$labels = array_column( $admin['links'], 'label' );
		$this->assertContains( 'Payment settings', $labels );
		$this->assertNotContains( 'Mollie dashboard', $labels );
	}

	/**
	 * `data.admin` must be present only for a capability-checked admin —
	 * never for an anonymous visitor, even for the recognised error case.
	 */
	public function test_admin_detail_is_capability_gated() {
		$e = $this->api_exception( 422, 'Unprocessable Entity', 'The payment method is not activated on your account.' );

		$GLOBALS['_fair_test_current_user_can'] = false;
		$anonymous_error                        = PaymentGatewayError::from_api_exception( $e )->to_wp_error( 42 );
		$this->assertArrayNotHasKey( 'admin', $anonymous_error->get_error_data() );

		$GLOBALS['_fair_test_current_user_can'] = true;
		$admin_error                            = PaymentGatewayError::from_api_exception( $e )->to_wp_error( 42 );
		$this->assertArrayHasKey( 'admin', $admin_error->get_error_data() );
	}

	/**
	 * The public message and data must never contain the gateway's raw
	 * request-body/timestamp/documentation dump — the entire point of #1209.
	 */
	public function test_to_wp_error_never_leaks_raw_gateway_dump() {
		$GLOBALS['_fair_test_current_user_can'] = true;

		$e = $this->api_exception( 422, 'Unprocessable Entity', 'The payment method is not activated on your account.' );

		// Sanity check: the SDK's own decorated message does contain the leak
		// this test guards against, so the assertion below is meaningful.
		$this->assertStringContainsString( 'Request body', $e->getMessage() );

		$error = PaymentGatewayError::from_api_exception( $e )->to_wp_error( 42 );
		$dump  = wp_json_encode(
			array(
				$error->get_error_message(),
				$error->get_error_data(),
			)
		);
		$this->assertStringNotContainsString( 'Request body', $dump );
		$this->assertStringNotContainsString( 'Documentation:', $dump );
		$this->assertStringNotContainsString( 'redirectUrl', $dump );
	}

	/**
	 * The generic visitor-facing message itself must never vary with the
	 * gateway cause — only `data.admin` does.
	 */
	public function test_public_message_is_always_the_same_generic_string() {
		$activation_error = PaymentGatewayError::from_api_exception(
			$this->api_exception( 422, 'Unprocessable Entity', 'The payment method is not activated on your account.' )
		)->to_wp_error( 42 );

		$unknown_error = PaymentGatewayError::generic()->to_wp_error( 42 );

		$this->assertSame( $activation_error->get_error_message(), $unknown_error->get_error_message() );
	}
}
