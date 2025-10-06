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

$amount   = isset( $attributes['amount'] ) ? $attributes['amount'] : '10';
$currency = isset( $attributes['currency'] ) ? $attributes['currency'] : 'EUR';
?>

<div <?php echo get_block_wrapper_attributes(); ?>>
	<div class="fair-payment-block">
		<p><?php esc_html_e( 'Payment:', 'fair-payment' ); ?> <?php echo esc_html( $amount ); ?> <?php echo esc_html( $currency ); ?></p>
		<p><em><?php esc_html_e( 'Payment functionality to be implemented.', 'fair-payment' ); ?></em></p>
	</div>
</div>
