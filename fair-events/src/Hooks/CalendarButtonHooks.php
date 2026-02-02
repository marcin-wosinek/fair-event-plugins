<?php
/**
 * Calendar Button hooks for Fair Events
 *
 * Handles the calendar button block variation functionality:
 * - Injects event data from fair_event_dates table into button data attributes
 * - Enqueues frontend script for calendar dropdown
 * - Passes enabled post types to JavaScript
 *
 * @package FairEvents
 */

namespace FairEvents\Hooks;

use FairEvents\Models\EventDates;
use FairEvents\Settings\Settings;

defined( 'WPINC' ) || die;

/**
 * Handles calendar button block variation hooks
 */
class CalendarButtonHooks {

	/**
	 * Constructor - registers WordPress hooks
	 */
	public function __construct() {
		add_filter( 'register_block_type_args', array( $this, 'add_calendar_button_attribute' ), 10, 2 );
		add_filter( 'render_block_core/button', array( $this, 'inject_calendar_data' ), 10, 2 );
		add_action( 'enqueue_block_editor_assets', array( $this, 'enqueue_editor_assets' ) );
		add_action( 'wp_enqueue_scripts', array( $this, 'maybe_enqueue_frontend' ) );
	}

	/**
	 * Add isCalendarButton attribute to core/button block
	 *
	 * This filter adds a custom attribute that allows us to identify
	 * calendar button variations of the core/button block.
	 *
	 * @param array  $args       Block registration arguments.
	 * @param string $block_type Block type name.
	 * @return array Modified block registration arguments.
	 */
	public function add_calendar_button_attribute( $args, $block_type ) {
		if ( 'core/button' !== $block_type ) {
			return $args;
		}

		// Add the isCalendarButton attribute.
		if ( ! isset( $args['attributes'] ) ) {
			$args['attributes'] = array();
		}

		$args['attributes']['isCalendarButton'] = array(
			'type'    => 'boolean',
			'default' => false,
		);

		return $args;
	}

	/**
	 * Inject calendar data attributes into button block
	 *
	 * @param string $content Block HTML content.
	 * @param array  $block   Block data including attributes.
	 * @return string Modified block content.
	 */
	public function inject_calendar_data( $content, $block ) {
		// Only process calendar buttons.
		if ( empty( $block['attrs']['isCalendarButton'] ) ) {
			return $content;
		}

		// Get current post.
		$post_id = get_the_ID();
		if ( ! $post_id ) {
			return $content;
		}

		// Check if post type is enabled for events.
		$post_type     = get_post_type( $post_id );
		$enabled_types = Settings::get_enabled_post_types();
		if ( ! in_array( $post_type, $enabled_types, true ) ) {
			return $content;
		}

		// Get event dates from database.
		$event_dates = EventDates::get_by_event_id( $post_id );
		if ( ! $event_dates ) {
			return $content;
		}

		// Get post data for calendar event.
		$title       = get_the_title( $post_id );
		$url         = get_permalink( $post_id );
		$location    = get_post_meta( $post_id, 'event_location', true );
		$description = get_the_excerpt( $post_id );

		// Get RRULE if available.
		$rrule     = $event_dates->rrule ?? '';
		$recurring = ! empty( $rrule );

		// Build data attributes.
		$data_attrs = sprintf(
			'data-calendar-button="true" data-start="%s" data-end="%s" data-all-day="%s" data-title="%s" data-url="%s" data-location="%s" data-description="%s" data-recurring="%s" data-rrule="%s"',
			esc_attr( $event_dates->start_datetime ),
			esc_attr( $event_dates->end_datetime ?? $event_dates->start_datetime ),
			$event_dates->all_day ? 'true' : 'false',
			esc_attr( $title ),
			esc_attr( $url ),
			esc_attr( $location ),
			esc_attr( $description ),
			$recurring ? 'true' : 'false',
			esc_attr( $rrule )
		);

		// Inject data attributes into the button element.
		// The button is an <a> tag with class wp-block-button__link.
		$content = preg_replace(
			'/<a\s+class="wp-block-button__link/',
			'<a ' . $data_attrs . ' class="wp-block-button__link',
			$content
		);

		// Also handle case where class might have a prefix.
		$content = preg_replace(
			'/<a\s+([^>]*?)class="([^"]*?)wp-block-button__link/',
			'<a $1' . $data_attrs . ' class="$2wp-block-button__link',
			$content
		);

		return $content;
	}

	/**
	 * Enqueue editor assets
	 *
	 * @return void
	 */
	public function enqueue_editor_assets() {
		$script_path = FAIR_EVENTS_PLUGIN_DIR . 'build/blocks/calendar-button/editor.js';
		$script_url  = FAIR_EVENTS_PLUGIN_URL . 'build/blocks/calendar-button/editor.js';

		if ( ! file_exists( $script_path ) ) {
			return;
		}

		$asset_file = FAIR_EVENTS_PLUGIN_DIR . 'build/blocks/calendar-button/editor.asset.php';
		$asset      = file_exists( $asset_file )
			? require $asset_file
			: array(
				'dependencies' => array( 'wp-blocks', 'wp-data', 'wp-i18n', 'wp-dom-ready' ),
				'version'      => filemtime( $script_path ),
			);

		wp_enqueue_script(
			'fair-events-calendar-button-editor',
			$script_url,
			$asset['dependencies'],
			$asset['version'],
			true
		);

		// Pass enabled post types to JavaScript.
		wp_localize_script(
			'fair-events-calendar-button-editor',
			'fairEventsData',
			array( 'enabledPostTypes' => Settings::get_enabled_post_types() )
		);

		// Set script translations.
		wp_set_script_translations(
			'fair-events-calendar-button-editor',
			'fair-events',
			FAIR_EVENTS_PLUGIN_DIR . 'build/languages'
		);
	}

	/**
	 * Maybe enqueue frontend assets
	 *
	 * Only enqueues if viewing a single post of an enabled type.
	 *
	 * @return void
	 */
	public function maybe_enqueue_frontend() {
		if ( ! is_singular() ) {
			return;
		}

		$post_id       = get_the_ID();
		$post_type     = get_post_type( $post_id );
		$enabled_types = Settings::get_enabled_post_types();

		if ( ! in_array( $post_type, $enabled_types, true ) ) {
			return;
		}

		// Check if the post has event dates.
		$event_dates = EventDates::get_by_event_id( $post_id );
		if ( ! $event_dates ) {
			return;
		}

		$script_path = FAIR_EVENTS_PLUGIN_DIR . 'build/blocks/calendar-button/frontend.js';
		$script_url  = FAIR_EVENTS_PLUGIN_URL . 'build/blocks/calendar-button/frontend.js';

		if ( ! file_exists( $script_path ) ) {
			return;
		}

		$asset_file = FAIR_EVENTS_PLUGIN_DIR . 'build/blocks/calendar-button/frontend.asset.php';
		$asset      = file_exists( $asset_file )
			? require $asset_file
			: array(
				'dependencies' => array( 'wp-i18n' ),
				'version'      => filemtime( $script_path ),
			);

		wp_enqueue_script(
			'fair-events-calendar-button-frontend',
			$script_url,
			$asset['dependencies'],
			$asset['version'],
			true
		);

		// Enqueue the CSS.
		$style_path = FAIR_EVENTS_PLUGIN_DIR . 'build/blocks/calendar-button/frontend.css';
		$style_url  = FAIR_EVENTS_PLUGIN_URL . 'build/blocks/calendar-button/frontend.css';

		if ( file_exists( $style_path ) ) {
			wp_enqueue_style(
				'fair-events-calendar-button-frontend',
				$style_url,
				array(),
				$asset['version']
			);
		}

		// Set script translations.
		wp_set_script_translations(
			'fair-events-calendar-button-frontend',
			'fair-events',
			FAIR_EVENTS_PLUGIN_DIR . 'build/languages'
		);
	}
}
