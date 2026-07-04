<?php
/**
 * Simple Payment Block Render
 *
 * @package FairPaymentsConnector
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block content.
 * @var WP_Block $block      Block instance.
 */

defined( 'ABSPATH' ) || exit;

$block_id        = isset( $attributes['blockId'] ) ? $attributes['blockId'] : '';
$amount          = isset( $attributes['amount'] ) ? $attributes['amount'] : '10';
$currency        = ! empty( $attributes['currency'] ) ? $attributes['currency'] : get_option( 'fair_payment_currency', 'EUR' );
$description     = isset( $attributes['description'] ) ? $attributes['description'] : '';
$current_post_id = get_the_ID();

// Read-only flags from URL params signalling a return from the payment gateway. No state change; nonce not applicable.
// phpcs:ignore WordPress.Security.NonceVerification.Recommended
$is_callback = isset( $_GET['fair_payment_callback'] ) && 'true' === $_GET['fair_payment_callback'];

// Resolve the real transaction status via the canonical PaymentStatus mapper,
// gated by the per-transaction access token exactly like the REST status
// endpoint. Falls back to "processing" when the callback can't be verified
// (e.g. missing/mismatched token) rather than guessing a specific outcome.
$callback_status = 'processing';
if ( $is_callback && class_exists( \FairPaymentsConnector\API\TransactionAPI::class ) ) {
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended
	$callback_transaction_id = isset( $_GET['transaction_id'] ) ? absint( $_GET['transaction_id'] ) : 0;
	// phpcs:ignore WordPress.Security.NonceVerification.Recommended
	$callback_token = isset( $_GET['token'] ) ? sanitize_text_field( wp_unslash( $_GET['token'] ) ) : '';

	$transaction    = $callback_transaction_id ? \FairPaymentsConnector\API\TransactionAPI::get_transaction( $callback_transaction_id ) : null;
	$expected_token = $transaction ? (string) ( $transaction->access_token ?? '' ) : '';

	if ( $transaction && '' !== $expected_token && '' !== $callback_token && hash_equals( $expected_token, $callback_token ) ) {
		$callback_status = \FairPaymentsConnector\Payment\PaymentStatus::from_raw_status( (string) $transaction->status );
	}
}

// Check if Mollie is configured.
$is_configured = \FairPaymentsConnector\Payment\MolliePaymentHandler::is_configured();

// DOM id for the wrapper only. Must NOT reuse $block_id: the payment endpoint
// derives the authoritative amount by matching the saved blockId attribute in
// post content, so the button has to submit the attribute value, not a
// per-render unique id.
$wrapper_id = 'fair-payments-connector-' . wp_unique_id();
?>

<div
<?php
	// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- get_block_wrapper_attributes() returns pre-escaped HTML attributes.
	echo get_block_wrapper_attributes( array( 'id' => $wrapper_id ) );
?>
>
	<div class="fair-payments-connector-block">
		<div class="fair-payments-connector-callback" style="<?php echo esc_attr( $is_callback ? '' : 'display: none;' ); ?>">
			<div class="fair-payments-connector-success" data-status="confirmed" role="alert" style="<?php echo esc_attr( 'confirmed' === $callback_status ? '' : 'display: none;' ); ?>">
				<p><?php esc_html_e( 'Thank you! Your payment has been received and confirmed.', 'fair-payments-connector' ); ?></p>
			</div>
			<div class="fair-payments-connector-processing" data-status="processing" role="alert" style="<?php echo esc_attr( 'processing' === $callback_status ? '' : 'display: none;' ); ?>">
				<p><?php esc_html_e( 'Thank you! Your payment is being processed.', 'fair-payments-connector' ); ?></p>
			</div>
			<div class="fair-payments-connector-failed" data-status="failed" role="alert" style="<?php echo esc_attr( 'failed' === $callback_status ? '' : 'display: none;' ); ?>">
				<p><?php esc_html_e( 'Your payment was not completed. Please try again.', 'fair-payments-connector' ); ?></p>
			</div>

			<button type="button" class="fair-payments-connector-callback-dismiss wp-element-button" style="<?php echo esc_attr( 'failed' === $callback_status ? 'display: none;' : '' ); ?>">
				<?php esc_html_e( 'Continue', 'fair-payments-connector' ); ?>
			</button>
			<button type="button" class="fair-payments-connector-restart wp-element-button" style="<?php echo esc_attr( 'failed' === $callback_status ? '' : 'display: none;' ); ?>">
				<?php esc_html_e( 'Try Again', 'fair-payments-connector' ); ?>
			</button>
		</div>

		<div class="fair-payments-connector-payment-form" style="<?php echo esc_attr( $is_callback ? 'display: none;' : '' ); ?>">
			<div class="fair-payments-connector-amount">
				<strong><?php echo esc_html( $amount ); ?> <?php echo esc_html( $currency ); ?></strong>
				<?php if ( ! empty( $description ) ) : ?>
					<p><?php echo esc_html( $description ); ?></p>
				<?php endif; ?>
			</div>

			<?php if ( $is_configured ) : ?>
				<button
					class="fair-payments-connector-button wp-element-button"
					data-amount="<?php echo esc_attr( $amount ); ?>"
					data-currency="<?php echo esc_attr( $currency ); ?>"
					data-description="<?php echo esc_attr( $description ); ?>"
					data-post-id="<?php echo esc_attr( $current_post_id ); ?>"
					data-block-id="<?php echo esc_attr( $block_id ); ?>"
				>
					<?php esc_html_e( 'Pay Now', 'fair-payments-connector' ); ?>
				</button>
				<div class="fair-payments-connector-loading" style="display: none;">
					<?php esc_html_e( 'Processing payment...', 'fair-payments-connector' ); ?>
				</div>
				<div class="fair-payments-connector-error" style="display: none; color: red;"></div>
			<?php else : ?>
				<p class="fair-payments-connector-not-configured">
					<em><?php esc_html_e( 'Payment gateway is not configured. Please configure your Mollie API keys.', 'fair-payments-connector' ); ?></em>
				</p>
			<?php endif; ?>
		</div>
	</div>
</div>
