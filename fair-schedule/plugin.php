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
 * Initialize blocks when ready
 */
function init_blocks() {
    // Placeholder for future block registrations
    // Blocks will be registered here as they are developed
}
add_action('init', 'FairSchedule\init_blocks');