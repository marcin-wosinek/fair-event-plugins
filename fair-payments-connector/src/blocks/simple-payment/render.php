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
$currency        = isset( $attributes['currency'] ) ? $attributes['currency'] : 'EUR';
$description     = isset( $attributes['description'] ) ? $attributes['description'] : '';
$current_post_id = get_the_ID();

// Read-only flags from URL params signalling a return from the payment gateway. No state change; nonce not applicable.
// phpcs:ignore WordPress.Security.NonceVerification.Recommended
$is_callback = isset( $_GET['fair_payment_callback'] ) && 'true' === $_GET['fair_payment_callback'];

// phpcs:ignore WordPress.Security.NonceVerification.Recommended
$show_success = isset( $_GET['payment_redirect'] ) && '1' === $_GET['payment_redirect'];

// Check if Mollie is configured.
$is_configured = \FairPaymentsConnector\Payment\MolliePaymentHandler::is_configured();

$block_id = 'fair-payments-connector-' . wp_unique_id();
?>

<div 
<?php
	// phpcs:ignore WordPress.Security.EscapeOutput.OutputNotEscaped -- get_block_wrapper_attributes() returns pre-escaped HTML attributes.
	echo get_block_wrapper_attributes( array( 'id' => $block_id ) );
?>
>
	<div class="fair-payments-connector-block">
		<?php if ( $is_callback ) : ?>
			<div class="fair-payments-connector-callback">
				<div class="fair-payments-connector-success">
					<p><?php esc_html_e( 'Thank you! Your payment has been received and is being processed.', 'fair-payments-connector' ); ?></p>
				</div>
				<button type="button" class="fair-payments-connector-callback-dismiss wp-element-button">
					<?php esc_html_e( 'Continue', 'fair-payments-connector' ); ?>
				</button>
			</div>
		<?php else : ?>
			<?php if ( $show_success ) : ?>
				<div class="fair-payments-connector-success">
					<p><?php esc_html_e( 'Thank you! Your payment is being processed.', 'fair-payments-connector' ); ?></p>
				</div>
			<?php endif; ?>

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
		<?php endif; ?>
	</div>
</div>
