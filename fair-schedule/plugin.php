<?php
/**
 * Fair Schedule
 *
 * Event schedule management plugin, with fair pricing model.
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
 * Plugin Name: Fair Schedule
 * Plugin URI:  https://github.com/marcin-wosinek/fair-event-plugins
 * Description: Schedule management plugin for events, with fair pricing model.
 * Author:      Marcin Wosinek <marcin.wosinek@gmail.com>
 * Version:     1.0.0
 */

namespace FairSchedule;

defined('WPINC') || die;
require_once __DIR__ . '/vendor/autoload.php';

/**
 * Register the Time Block
 *
 * @return void
 */
function Register_Time_block()
{
    register_block_type(__DIR__ . '/src/blocks/time-block');
}

/**
 * Initialize blocks when ready
 *
 * @return void
 */
function Init_blocks()
{
    Register_Time_block();
}
add_action('init', 'FairSchedule\Init_blocks');