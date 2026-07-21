<?php
/**
 * Typed exception carrying a sanitized payment-gateway error
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Payment;

defined( 'WPINC' ) || die;

/**
 * Thrown by MolliePaymentHandler::create_payment() in place of a raw
 * \Exception so the public error path never sees the gateway's decorated
 * message (request body, IDs, URLs) — only the already-sanitized
 * PaymentGatewayError it carries.
 */
class PaymentGatewayException extends \Exception {

	/**
	 * The sanitized error to surface to REST consumers.
	 *
	 * @var PaymentGatewayError
	 */
	private $error;

	/**
	 * Constructor.
	 *
	 * @param PaymentGatewayError $error Sanitized error.
	 */
	public function __construct( PaymentGatewayError $error ) {
		parent::__construct( 'Payment gateway rejected the request.' );
		$this->error = $error;
	}

	/**
	 * Get the sanitized error.
	 *
	 * @return PaymentGatewayError
	 */
	public function get_error(): PaymentGatewayError {
		return $this->error;
	}
}
