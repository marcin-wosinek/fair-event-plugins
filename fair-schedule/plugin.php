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
    // Register block script
    wp_register_script(
        'time-block-editor',
        plugins_url('build/time-block.js', __FILE__),
        array('wp-blocks', 'wp-element', 'wp-editor', 'wp-components', 'wp-i18n'),
        filemtime(plugin_dir_path(__FILE__) . 'build/time-block.js')
    );

    // Register block styles
    wp_register_style(
        'time-block-style',
        plugins_url('src/blocks/time-block/style.css', __FILE__),
        array(),
        filemtime(plugin_dir_path(__FILE__) . 'src/blocks/time-block/style.css')
    );

    // Register editor styles
    wp_register_style(
        'time-block-editor-style',
        plugins_url('src/blocks/time-block/style.css', __FILE__),
        array('wp-edit-blocks'),
        filemtime(plugin_dir_path(__FILE__) . 'src/blocks/time-block/style.css')
    );

    // Register the block
    register_block_type(
        'fair-schedule/time-block', array(
        'editor_script' => 'time-block-editor',
        'style' => 'time-block-style',
        'editor_style' => 'time-block-editor-style',
        'attributes' => array(
            'title' => array(
                'type' => 'string',
                'default' => '',
            ),
            'startHour' => array(
                'type' => 'string',
                'default' => '09:00',
            ),
            'endHour' => array(
                'type' => 'string',
                'default' => '10:00',
            ),
        ),
        )
    );
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