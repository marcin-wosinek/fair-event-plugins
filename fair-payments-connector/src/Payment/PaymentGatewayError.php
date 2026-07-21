<?php
/**
 * Sanitized payment-gateway error
 *
 * @package FairPaymentsConnector
 */

namespace FairPaymentsConnector\Payment;

use Mollie\Api\Exceptions\ApiException;
use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Interprets a gateway failure into a visitor-safe message plus, for
 * capability-checked admins only, a plain-language cause and links to fix it.
 *
 * Built from stable identifiers (HTTP status, Mollie's plain message,
 * dashboard link) — never from the raw decorated exception message, which
 * contains the request body, IDs, and URLs. Unrecognised errors (unknown
 * gateway responses, or failures with no `ApiException` at all) fall back to
 * a generic cause with no gateway-specific detail.
 */
class PaymentGatewayError {

	/**
	 * Fallback Mollie dashboard URL used when the exception carries none.
	 *
	 * @var string
	 */
	const DEFAULT_DASHBOARD_URL = 'https://my.mollie.com/dashboard';

	/**
	 * Gateway HTTP status code, or 0 when not derived from an ApiException.
	 *
	 * @var int
	 */
	private $status;

	/**
	 * Mollie's plain error message (no timestamp, docs link, or request body).
	 *
	 * @var string
	 */
	private $plain_message;

	/**
	 * Gateway-provided dashboard URL for this error, if any.
	 *
	 * @var string|null
	 */
	private $dashboard_url;

	/**
	 * Constructor.
	 *
	 * @param int         $status        Gateway HTTP status code (0 if unknown).
	 * @param string      $plain_message Plain gateway message (no request body).
	 * @param string|null $dashboard_url Gateway-provided dashboard URL, if any.
	 */
	private function __construct( int $status, string $plain_message, ?string $dashboard_url ) {
		$this->status        = $status;
		$this->plain_message = $plain_message;
		$this->dashboard_url = $dashboard_url;
	}

	/**
	 * Build from a Mollie ApiException, capturing only stable identifiers.
	 *
	 * @param ApiException $e The caught gateway exception.
	 * @return self
	 */
	public static function from_api_exception( ApiException $e ): self {
		return new self( $e->getStatusCode(), $e->getPlainMessage(), $e->getDashboardUrl() );
	}

	/**
	 * Build a generic, unrecognised error (e.g. a non-gateway failure such as
	 * a misconfigured API key, or a gateway response we don't interpret).
	 *
	 * @return self
	 */
	public static function generic(): self {
		return new self( 0, '', null );
	}

	/**
	 * Build the sanitized WP_Error returned to REST consumers.
	 *
	 * The message is always the generic visitor-facing string. Admin-only
	 * detail (interpreted cause + fix-it links) is added under `data.admin`
	 * only when the current user can manage the plugin.
	 *
	 * @param int|null $transaction_id Transaction ID, for the payment-log link.
	 * @return WP_Error
	 */
	public function to_wp_error( ?int $transaction_id ): WP_Error {
		$data = array( 'status' => 502 );

		if ( current_user_can( 'manage_options' ) ) {
			$data['admin'] = $this->build_admin_detail( $transaction_id );
		}

		return new WP_Error(
			'payment_creation_failed',
			__( 'The payment could not be started. Please try again later or contact the organizer.', 'fair-payments-connector' ),
			$data
		);
	}

	/**
	 * Build the admin-only cause + links, keyed on stable identifiers.
	 *
	 * @param int|null $transaction_id Transaction ID, for the payment-log link.
	 * @return array{cause: string, links: array<int, array{label: string, url: string}>}
	 */
	private function build_admin_detail( ?int $transaction_id ): array {
		$links = array(
			array(
				'label' => __( 'Payment settings', 'fair-payments-connector' ),
				'url'   => admin_url( 'admin.php?page=fair-payments-connector-settings' ),
			),
		);

		if ( $transaction_id ) {
			$links[] = array(
				'label' => __( 'Payment log', 'fair-payments-connector' ),
				'url'   => admin_url( 'admin.php?page=fair-payments-connector-transaction&transaction_id=' . $transaction_id ),
			);
		}

		if ( $this->is_method_not_activated() ) {
			$links[] = array(
				'label' => __( 'Mollie dashboard', 'fair-payments-connector' ),
				'url'   => $this->dashboard_url ? $this->dashboard_url : self::DEFAULT_DASHBOARD_URL,
			);

			return array(
				'cause' => __( 'The connected Mollie profile has no suitable payment method enabled.', 'fair-payments-connector' ),
				'links' => $links,
			);
		}

		return array(
			'cause' => __( 'The payment gateway rejected the request. See the payment log for technical details.', 'fair-payments-connector' ),
			'links' => $links,
		);
	}

	/**
	 * Whether this is Mollie's "payment method is not activated on your
	 * account" error — a 422 with a stable, identifiable plain message.
	 *
	 * @return bool
	 */
	private function is_method_not_activated(): bool {
		return 422 === $this->status && false !== stripos( $this->plain_message, 'not activated' );
	}
}
