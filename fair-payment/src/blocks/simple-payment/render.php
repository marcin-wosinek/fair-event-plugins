<?php
/**
 * Simple Payment Block Render
 *
 * @package FairPayment
 *
 * @var array    $attributes Block attributes.
 * @var string   $content    Block content.
 * @var WP_Block $block      Block instance.
 */

$amount      = isset( $attributes['amount'] ) ? $attributes['amount'] : '10';
$currency    = isset( $attributes['currency'] ) ? $attributes['currency'] : 'EUR';
$description = isset( $attributes['description'] ) ? $attributes['description'] : '';
$post_id     = get_the_ID();

// Check if payment redirect with success message.
$show_success = isset( $_GET['payment_redirect'] ) && '1' === $_GET['payment_redirect'];

// Check if Mollie is configured.
$is_configured = \FairPayment\Payment\MolliePaymentHandler::is_configured();

$block_id = 'fair-payment-' . wp_unique_id();
?>

<div <?php echo get_block_wrapper_attributes( array( 'id' => $block_id ) ); ?>>
	<div class="fair-payment-block">
		<?php if ( $show_success ) : ?>
			<div class="fair-payment-success">
				<p><?php esc_html_e( 'Thank you! Your payment is being processed.', 'fair-payment' ); ?></p>
			</div>
		<?php endif; ?>

		<div class="fair-payment-amount">
			<strong><?php echo esc_html( $amount ); ?> <?php echo esc_html( $currency ); ?></strong>
			<?php if ( ! empty( $description ) ) : ?>
				<p><?php echo esc_html( $description ); ?></p>
			<?php endif; ?>
		</div>

		<?php if ( $is_configured ) : ?>
			<button
				class="fair-payment-button wp-element-button"
				data-amount="<?php echo esc_attr( $amount ); ?>"
				data-currency="<?php echo esc_attr( $currency ); ?>"
				data-description="<?php echo esc_attr( $description ); ?>"
				data-post-id="<?php echo esc_attr( $post_id ); ?>"
			>
				<?php esc_html_e( 'Pay Now', 'fair-payment' ); ?>
			</button>
			<div class="fair-payment-loading" style="display: none;">
				<?php esc_html_e( 'Processing payment...', 'fair-payment' ); ?>
			</div>
			<div class="fair-payment-error" style="display: none; color: red;"></div>
		<?php else : ?>
			<p class="fair-payment-not-configured">
				<em><?php esc_html_e( 'Payment gateway is not configured. Please configure your Mollie API keys.', 'fair-payment' ); ?></em>
			</p>
		<?php endif; ?>
	</div>
</div>
