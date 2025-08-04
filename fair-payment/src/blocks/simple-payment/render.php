<?php
/**
 * Render functions for the Simple Payment block
 *
 * @package FairPayment
 */

namespace FairPayment;

/**
 * Render the Simple Payment block
 *
 * @param array $attributes Block attributes.
 * @return string Block HTML.
 */
function render_simple_payment_block( $attributes ) {
	$amount = isset( $attributes['amount'] ) ? $attributes['amount'] : '10';

	$output  = '<div class="simple-payment-block">';
	$output .= '<p class="simple-payment-text">Fair Payment: ' . esc_html( $amount ) . '</p>';
	$output .= '</div>';

	return $output;
}
