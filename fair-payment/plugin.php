<?php
/**
 * Fair Payment
 *
 * Simple payment plugin, with fair pricing model.
 *
 * PHP version 8.2
 *
 * @category WordPress_Plugin
 * @package  TODO
 * @author   Marcin Wosinek <marcin.wosinek@gmail.com>
 * @license  GPLv3 <https://www.gnu.org/licenses/gpl-3.0.en.html>
 * @link     https://github.com/marcin-wosinek/fair-event-plugins
 * @since    TODO: Date
 *
 * @wordpress-plugin
 * Plugin Name: Fair Payment
 * Plugin URI:  https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Payment plugin, with fair pricing model.
 * Author:      Marcin Wosinek <marcin.wosinek@gmail.com>
 * Version:     1.0.0
 */

namespace FairPayment;

defined('WPINC') || die;
require_once __DIR__ . '/vendor/autoload.php';
require_once __DIR__ . '/src/blocks/simple-payment/render.php';
require_once __DIR__ . '/src/admin/admin-page.php';

// Initialize admin page
add_action('admin_menu', 'FairPayment\Admin\register_admin_menu');

/**
 * Register the Simple Payment block
 *
 * @return void
 */
function Register_Simple_Payment_block()
{
    // Register block script
    wp_register_script(
        'simple-payment-block-editor',
        plugins_url('build/index.js', __FILE__),
        array('wp-blocks', 'wp-element', 'wp-editor', 'wp-components', 'wp-i18n'),
        filemtime(plugin_dir_path(__FILE__) . 'build/index.js')
    );

    // Register block styles
    wp_register_style(
        'simple-payment-block-style',
        plugins_url('src/blocks/simple-payment/style.css', __FILE__),
        array(),
        filemtime(plugin_dir_path(__FILE__) . 'src/blocks/simple-payment/style.css')
    );

    // Register the block
    register_block_type(
        'fair-payment/simple-payment-block', array(
        'editor_script' => 'simple-payment-block-editor',
        'style' => 'simple-payment-block-style',
        'attributes' => array(
            'amount' => array(
                'type' => 'string',
                'default' => '10',
            ),
            'currency' => array(
                'type' => 'string',
                'default' => 'EUR',
            ),
        ),
        'render_callback' => 'FairPayment\render_simple_payment_block',
        )
    );
}
add_action('init', 'FairPayment\Register_Simple_Payment_block');
