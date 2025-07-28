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
 * Register the Calendar Button block
 *
 * @return void
 */
function Register_Calendar_Button_block()
{
    // Register the block using block.json
    register_block_type(__DIR__ . '/build/blocks/calendar-button');
}

/**
 * Initialize plugin when ready
 *
 * @return void
 */
function Init_plugin()
{
    Register_Calendar_Button_block();
}
add_action('init', 'FairCalendarButton\Init_plugin');