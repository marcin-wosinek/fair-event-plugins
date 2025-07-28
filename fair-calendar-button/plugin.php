<?php
/**
 * Fair Calendar Button
 *
 * Calendar integration plugin with fair pricing model.
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
 * Plugin Name: Fair Calendar Button
 * Plugin URI:  https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Calendar integration plugin with fair pricing model.
 * Author:      Marcin Wosinek <marcin.wosinek@gmail.com>
 * Version:     1.0.0
 */

namespace FairCalendarButton;

defined('WPINC') || die;
require_once __DIR__ . '/vendor/autoload.php';

/**
 * Initialize plugin when ready
 */
function init_plugin() {
    // Plugin initialization code will go here
}
add_action('init', 'FairCalendarButton\init_plugin');