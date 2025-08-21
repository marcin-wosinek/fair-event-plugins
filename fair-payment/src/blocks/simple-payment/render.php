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
?>

<div <?php echo wp_kses_data( get_block_wrapper_attributes() ); ?>>
	<div class="simple-payment-button-wrapper" data-amount="<?php echo esc_attr( $amount ); ?>" data-currency="<?php echo esc_attr( $currency ); ?>">
		<?php echo $content; ?>
	</div>
</div>
