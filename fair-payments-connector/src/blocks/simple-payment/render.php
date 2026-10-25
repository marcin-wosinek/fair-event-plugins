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
$currency        = ! empty( $attributes['currency'] ) ? $attributes['currency'] : \FairEventsShared\Money::site_currency();
$description     = isset( $attributes['description'] ) ? $attributes['description'] : '';
$current_post_id = get_the_ID();

// Read-only flags from URL params signalling a return from the payment gateway. No state change; nonce not applicable.
// phpcs:ignore WordPress.Security.NonceVerification.Recommended
$is_callback = isset( $_GET['fair_payment_callback'] ) && 'true' === $_GET['fair_payment_callback'];

// The return page always starts in "processing". The access token that proves
// the visitor started this payment is held by the browser, not the URL, so only
// view.js can verify the status, through the token-gated REST status endpoint.
// This also keeps the cacheable markup free of per-transaction state.

// Check if Mollie is configured.
$is_configured = \FairPaymentsConnector\Payment\MolliePaymentHandler::is_configured();
// Connected, but the stored credentials cannot be read right now.
$credentials_unavailable = ! $is_configured && get_option( 'fair_payment_mollie_connected', false );

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
			<div class="fair-payments-connector-success" data-status="confirmed" role="alert" style="display: none;">
				<p><?php esc_html_e( 'Thank you! Your payment has been received and confirmed.', 'fair-payments-connector' ); ?></p>
			</div>
			<div class="fair-payments-connector-processing" data-status="processing" role="alert">
				<p><?php esc_html_e( 'Thank you! Your payment is being processed.', 'fair-payments-connector' ); ?></p>
			</div>
			<div class="fair-payments-connector-failed" data-status="failed" role="alert" style="display: none;">
				<p><?php esc_html_e( 'Your payment was not completed. Please try again.', 'fair-payments-connector' ); ?></p>
			</div>
			<div class="fair-payments-connector-unverified" data-status="unverified" role="alert" style="display: none;">
				<p><?php esc_html_e( 'We can’t check your payment status on this page. If you completed the payment, it is still being processed. Please check your email or contact the organizer before paying again.', 'fair-payments-connector' ); ?></p>
			</div>

			<div class="wp-block-button is-style-outline fair-payments-connector-callback-dismiss">
				<button type="button" class="wp-block-button__link wp-element-button">
					<?php esc_html_e( 'Continue', 'fair-payments-connector' ); ?>
				</button>
			</div>
			<div class="wp-block-button is-style-outline fair-payments-connector-restart" style="display: none;">
				<button type="button" class="wp-block-button__link wp-element-button">
					<?php esc_html_e( 'Try Again', 'fair-payments-connector' ); ?>
				</button>
			</div>
		</div>

		<div class="fair-payments-connector-payment-form" style="<?php echo esc_attr( $is_callback ? 'display: none;' : '' ); ?>">
			<div class="fair-payments-connector-amount">
				<strong><?php echo esc_html( $amount ); ?> <?php echo esc_html( $currency ); ?></strong>
				<?php if ( ! empty( $description ) ) : ?>
					<p><?php echo esc_html( $description ); ?></p>
				<?php endif; ?>
			</div>

			<?php if ( $is_configured ) : ?>
				<div class="wp-block-button">
					<button
						class="fair-payments-connector-button wp-block-button__link wp-element-button"
						data-amount="<?php echo esc_attr( $amount ); ?>"
						data-currency="<?php echo esc_attr( $currency ); ?>"
						data-description="<?php echo esc_attr( $description ); ?>"
						data-post-id="<?php echo esc_attr( $current_post_id ); ?>"
						data-block-id="<?php echo esc_attr( $block_id ); ?>"
					>
						<?php esc_html_e( 'Pay Now', 'fair-payments-connector' ); ?>
					</button>
				</div>
				<div class="fair-payments-connector-loading" style="display: none;">
					<?php esc_html_e( 'Processing payment...', 'fair-payments-connector' ); ?>
				</div>
				<div class="fair-payments-connector-error" style="display: none; color: red;"></div>
			<?php elseif ( $credentials_unavailable ) : ?>
				<p class="fair-payments-connector-not-configured">
					<em><?php esc_html_e( 'Online payment is temporarily unavailable. Please try again later or contact the organizer.', 'fair-payments-connector' ); ?></em>
				</p>
			<?php else : ?>
				<p class="fair-payments-connector-not-configured">
					<em><?php esc_html_e( 'Payment gateway is not configured. Please configure your Mollie API keys.', 'fair-payments-connector' ); ?></em>
				</p>
			<?php endif; ?>
		</div>
	</div>
</div>
