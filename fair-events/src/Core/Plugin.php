<?php
/**
 * Plugin core class for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Core;

defined( 'WPINC' ) || die;

/**
 * Main plugin class implementing singleton pattern
 */
class Plugin {
	/**
	 * Single instance of the plugin
	 *
	 * @var Plugin|null
	 */
	private static $instance = null;

	/**
	 * Get singleton instance of the plugin
	 *
	 * @return Plugin Plugin instance
	 */
	public static function instance() {
		if ( null === self::$instance ) {
			self::$instance = new self();
		}
		return self::$instance;
	}

	/**
	 * Initialize the plugin
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'init', array( $this, 'register_post_types' ) );
		add_action( 'init', array( $this, 'register_block_templates' ) );
		$this->load_hooks();
		$this->load_patterns();
	}

	/**
	 * Load all plugin hooks and functionality
	 *
	 * @return void
	 */
	private function load_hooks() {
		new \FairEvents\Hooks\BlockHooks();
	}

	/**
	 * Load and initialize block patterns
	 *
	 * @return void
	 */
	private function load_patterns() {
		$patterns = new \FairEvents\Patterns\Patterns();
		$patterns->init();
	}

	/**
	 * Register custom post types
	 *
	 * @return void
	 */
	public function register_post_types() {
		\FairEvents\PostTypes\Event::register();
	}

	/**
	 * Register block templates for custom post types
	 *
	 * @return void
	 */
	public function register_block_templates() {
		add_filter( 'the_content', array( $this, 'add_event_metadata_to_content' ), 5 );
	}

	/**
	 * Add event metadata to the content
	 *
	 * @param string $content Post content.
	 * @return string Modified content with event metadata.
	 */
	public function add_event_metadata_to_content( $content ) {
		if ( ! is_singular( 'fair_event' ) || ! in_the_loop() || ! is_main_query() ) {
			return $content;
		}

		$event_start   = get_post_meta( get_the_ID(), 'event_start', true );
		$event_end     = get_post_meta( get_the_ID(), 'event_end', true );
		$event_all_day = get_post_meta( get_the_ID(), 'event_all_day', true );

		if ( ! $event_start && ! $event_end && ! $event_all_day ) {
			return $content;
		}

		$event_meta = '<div class="wp-block-group event-meta" style="margin-top:var(--wp--preset--spacing--40);margin-bottom:var(--wp--preset--spacing--40)">';

		if ( $event_start ) {
			$formatted_start = $this->format_event_datetime( $event_start );
			$event_meta     .= '<div class="event-datetime"><strong>' . esc_html__( 'Start:', 'fair-events' ) . '</strong> ' . esc_html( $formatted_start ) . '</div>';
		}

		if ( $event_end ) {
			$formatted_end = $this->format_event_datetime( $event_end );
			$event_meta   .= '<div class="event-datetime"><strong>' . esc_html__( 'End:', 'fair-events' ) . '</strong> ' . esc_html( $formatted_end ) . '</div>';
		}

		if ( $event_all_day ) {
			$event_meta .= '<div class="event-all-day"><strong>' . esc_html__( 'All Day Event', 'fair-events' ) . '</strong></div>';
		}

		$event_meta .= '</div>';

		return $event_meta . $content;
	}

	/**
	 * Format event datetime using WordPress date/time functions
	 *
	 * @param string $datetime Datetime string in format YYYY-MM-DDTHH:MM.
	 * @return string Formatted datetime string.
	 */
	private function format_event_datetime( $datetime ) {
		if ( empty( $datetime ) ) {
			return '';
		}

		// Convert datetime-local format to timestamp
		$timestamp = strtotime( $datetime );
		if ( false === $timestamp ) {
			return $datetime;
		}

		// Get WordPress date and time formats
		$date_format = get_option( 'date_format' );
		$time_format = get_option( 'time_format' );

		// Format using WordPress functions
		return wp_date( $date_format . ' ' . $time_format, $timestamp );
	}

	/**
	 * Private constructor to prevent instantiation
	 */
	private function __construct() {
		// Prevent instantiation.
	}

	/**
	 * Prevent cloning
	 *
	 * @return void
	 */
	private function __clone() {
		// Prevent cloning.
	}

	/**
	 * Prevent unserialization
	 *
	 * @return void
	 */
	public function __wakeup() {
		// Prevent unserialization.
	}
}
