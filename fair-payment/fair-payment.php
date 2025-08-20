<?php
/**
 * Plugin Name: Fair Payment
 * Plugin URI: https://github.com/marcin-wosinek/fair-event-plugins
 * Description: A Gutenberg block for payment integration. The block displays a simple payment form with fair pricing model.
 * Version: 1.0.0
 * Requires at least: 5.8
 * Requires PHP: 8.0
 * Author: Marcin Wosinek
 * Author URI: https://github.com/marcin-wosinek
 * License: GPLv3 or later
 * License URI: https://www.gnu.org/licenses/gpl-3.0.html
 * Text Domain: fair-payment
 *
 * Fair Payment is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * Fair Payment is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE. See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with Fair Payment. If not, see https://www.gnu.org/licenses/gpl-3.0.html.
 *
 * @package FairPayment
 * @author Marcin Wosinek
 * @since 1.0.0
 */

namespace FairPayment;

defined( 'WPINC' ) || die;
require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/src/blocks/simple-payment/render.php';
require_once __DIR__ . '/src/admin/admin-page.php';

// Initialize admin page
add_action( 'admin_menu', 'FairPayment\Admin\register_admin_menu' );

/**
 * Register the Simple Payment block
 *
 * @return void
 */
function Register_Simple_Payment_block() {
	// Register block script
	wp_register_script(
		'simple-payment-block-editor',
		plugins_url( 'build/index.js', __FILE__ ),
		array( 'wp-blocks', 'wp-element', 'wp-editor', 'wp-components', 'wp-i18n' ),
		filemtime( plugin_dir_path( __FILE__ ) . 'build/index.js' )
	);

	// Register block styles
	wp_register_style(
		'simple-payment-block-style',
		plugins_url( 'src/blocks/simple-payment/style.css', __FILE__ ),
		array(),
		filemtime( plugin_dir_path( __FILE__ ) . 'src/blocks/simple-payment/style.css' )
	);

	// Register the block
	register_block_type(
		'fair-payment/simple-payment-block',
		array(
			'editor_script'   => 'simple-payment-block-editor',
			'style'           => 'simple-payment-block-style',
			'attributes'      => array(
				'amount'   => array(
					'type'    => 'string',
					'default' => '10',
				),
				'currency' => array(
					'type'    => 'string',
					'default' => 'EUR',
				),
			),
			'render_callback' => 'FairPayment\render_simple_payment_block',
		)
	);
}
add_action( 'init', 'FairPayment\Register_Simple_Payment_block' );
