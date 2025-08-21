<?php

namespace FairPayment\Core;

use FairPayment\Services\CurrencyService;

defined( 'WPINC' ) || die;

/**
 * Render callback for the simple payment block
 *
 * @package FairPayment
 * @param  array $attributes Block attributes
 * @param  string $content Block content
 * @param  WP_Block $block Block instance
 * @return string Rendered block HTML
 */

// Extract attributes with defaults.
$amount   = $attributes['amount'] ?? '10';
$currency = $attributes['currency'] ?? 'EUR';

// Get currency symbol using CurrencyService.
$currency_service = new CurrencyService();
$currency_symbol = $currency_service->get_currency_symbol( $currency );
?>

<div <?php echo wp_kses_data( get_block_wrapper_attributes( array( 'class' => 'simple-payment-block' ) ) ); ?>>
	<p class="simple-payment-text">
		<?php echo esc_html__( 'Fair Payment:', 'fair-payment' ); ?>
		<?php echo esc_html( $amount ); ?>
		<?php echo esc_html( $currency_symbol ); ?>
	</p>
</div>
