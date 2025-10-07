<?php
/**
 * Settings for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Settings;

defined( 'WPINC' ) || die;

/**
 * Settings class for registering plugin settings
 */
class Settings {
	/**
	 * Initialize settings
	 *
	 * @return void
	 */
	public function init() {
		add_action( 'init', array( $this, 'register_settings' ) );
		add_action( 'add_option_fair_events_slug', array( $this, 'flush_rewrite_rules_on_slug_change' ), 10, 2 );
		add_action( 'update_option_fair_events_slug', array( $this, 'flush_rewrite_rules_on_slug_change' ), 10, 2 );
		add_action( 'delete_option_fair_events_slug', array( $this, 'flush_rewrite_rules_on_slug_change' ) );
		add_filter( 'rest_pre_update_setting', array( $this, 'handle_empty_slug_via_rest' ), 10, 3 );
	}

	/**
	 * Register plugin settings
	 *
	 * @return void
	 */
	public function register_settings() {
		// Register event slug setting
		register_setting(
			'fair_events_settings',
			'fair_events_slug',
			array(
				'type'              => 'string',
				'description'       => __( 'URL slug for events', 'fair-events' ),
				'sanitize_callback' => array( $this, 'sanitize_slug' ),
				'show_in_rest'      => true,
				'default'           => 'fair-events',
			)
		);
	}

	/**
	 * Sanitize slug value
	 *
	 * @param string $value Slug value to sanitize.
	 * @return string Sanitized slug.
	 */
	public function sanitize_slug( $value ) {
		$sanitized = sanitize_title( $value );

		// Return empty string if sanitized is empty
		// The REST API filter will handle deletion
		return $sanitized;
	}

	/**
	 * Handle empty slug via REST API
	 *
	 * @param mixed  $result  Result to return instead of the value.
	 * @param string $name    Setting name.
	 * @param mixed  $value   Value to save.
	 * @return mixed Modified result or original value.
	 */
	public function handle_empty_slug_via_rest( $result, $name, $value ) {
		if ( 'fair_events_slug' !== $name ) {
			return $result;
		}

		// If empty value, delete the option and return default
		if ( empty( $value ) ) {
			delete_option( 'fair_events_slug' );
			// Return the default value
			return 'fair-events';
		}

		return $result;
	}

	/**
	 * Flush rewrite rules when event slug changes
	 *
	 * @param string $old_value Old slug value.
	 * @param string $new_value New slug value.
	 * @return void
	 */
	public function flush_rewrite_rules_on_slug_change() {
		// Schedule flush on shutdown to ensure all hooks are processed
		add_action( 'shutdown', array( $this, 'do_flush_rewrite_rules' ) );
	}

	/**
	 * Actually perform the rewrite rules flush
	 *
	 * @return void
	 */
	public function do_flush_rewrite_rules() {
		// Re-register post type with current slug
		\FairEvents\PostTypes\Event::register();
		// Flush rewrite rules
		flush_rewrite_rules();
	}
}
