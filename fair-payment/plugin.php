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

defined( 'WPINC' ) || die;

define( 'FAIR_PAYMENT_FILE', __FILE__ );
define( 'FAIR_PAYMENT_URL', plugin_dir_url( __FILE__ ) );
define( 'FAIR_PAYMENT_PATH', plugin_dir_path( __FILE__ ) );

require_once __DIR__ . '/vendor/autoload.php';

add_action(
	'plugins_loaded',
	function () {
		\FairPayment\Core\Plugin::instance()->init();
	}
);
