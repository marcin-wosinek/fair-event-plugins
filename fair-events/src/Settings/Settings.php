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
		add_action( 'update_option_fair_events_slug', array( $this, 'flush_rewrite_rules_on_slug_change' ), 10, 2 );
		add_action( 'delete_option_fair_events_slug', array( $this, 'flush_rewrite_rules_on_slug_delete' ) );
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

		// If empty string, delete the option and return default
		if ( empty( $sanitized ) ) {
			delete_option( 'fair_events_slug' );
			return 'fair-events';
		}

		return $sanitized;
	}

	/**
	 * Flush rewrite rules when event slug changes
	 *
	 * @param string $old_value Old slug value.
	 * @param string $new_value New slug value.
	 * @return void
	 */
	public function flush_rewrite_rules_on_slug_change( $old_value, $new_value ) {
		// Only flush if the value actually changed
		if ( $old_value !== $new_value ) {
			// Re-register post type with new slug
			\FairEvents\PostTypes\Event::register();
			// Flush rewrite rules
			flush_rewrite_rules();
		}
	}

	/**
	 * Flush rewrite rules when event slug is deleted (reset to default)
	 *
	 * @return void
	 */
	public function flush_rewrite_rules_on_slug_delete() {
		// Re-register post type with default slug
		\FairEvents\PostTypes\Event::register();
		// Flush rewrite rules
		flush_rewrite_rules();
	}
}
