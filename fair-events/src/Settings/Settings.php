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
		// Toggling CPT registration changes which rewrite rules exist.
		add_action( 'add_option_fair_events_register_post_type', array( $this, 'flush_rewrite_rules_on_slug_change' ) );
		add_action( 'update_option_fair_events_register_post_type', array( $this, 'flush_rewrite_rules_on_slug_change' ) );
		// Feature toggles can register/unregister rewrite rules (galleries).
		add_action( 'add_option_' . \FairEvents\Core\Features::OPTION, array( $this, 'flush_rewrite_rules_on_slug_change' ) );
		add_action( 'update_option_' . \FairEvents\Core\Features::OPTION, array( $this, 'flush_rewrite_rules_on_slug_change' ) );
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

		// Register enabled post types setting
		register_setting(
			'fair_events_settings',
			'fair_events_enabled_post_types',
			array(
				'type'              => 'array',
				'description'       => __( 'Post types that can have event data', 'fair-events' ),
				'sanitize_callback' => array( $this, 'sanitize_enabled_post_types' ),
				'show_in_rest'      => array(
					'schema' => array(
						'type'  => 'array',
						'items' => array( 'type' => 'string' ),
					),
				),
				'default'           => array(),
			)
		);

		// Feature flag bundle toggles — UI state only, never overrides a
		// wp-config constant (see Features::sanitize_option()).
		register_setting(
			'fair_events_settings',
			\FairEvents\Core\Features::OPTION,
			array(
				'type'              => 'object',
				'description'       => __( 'Per-bundle feature toggles', 'fair-events' ),
				'sanitize_callback' => array( \FairEvents\Core\Features::class, 'sanitize_option' ),
				'show_in_rest'      => array(
					'schema' => array(
						'type'                 => 'object',
						'additionalProperties' => array( 'type' => 'boolean' ),
					),
				),
				'default'           => array(),
			)
		);

		// Register the Events post type toggle. This single switch controls both
		// whether the fair_event CPT is registered and its membership in the
		// enabled post types, so the two can never contradict each other.
		register_setting(
			'fair_events_settings',
			'fair_events_register_post_type',
			array(
				'type'              => 'boolean',
				'description'       => __( 'Register the Events post type', 'fair-events' ),
				'sanitize_callback' => 'rest_sanitize_boolean',
				'show_in_rest'      => true,
				'default'           => true,
			)
		);

		// Opt-in "Powered by Fair Event Plugins" attribution. Read cross-plugin
		// by fair-audience (signup blocks + participant emails); lives here so it
		// sits with the rest of the public-facing event configuration. Off by
		// default so existing installs are unchanged until an admin opts in.
		register_setting(
			'fair_events_settings',
			'fair_events_powered_by_branding',
			array(
				'type'              => 'boolean',
				'description'       => __( 'Show a "Powered by Fair Event Plugins" line on signup forms and participant emails', 'fair-events' ),
				'sanitize_callback' => 'rest_sanitize_boolean',
				'show_in_rest'      => true,
				'default'           => false,
			)
		);
	}

	/**
	 * Whether the fair_event custom post type should be registered.
	 *
	 * @return bool True when the Events post type is enabled.
	 */
	public static function should_register_post_type() {
		return (bool) get_option( 'fair_events_register_post_type', true );
	}

	/**
	 * Get the global start-of-week setting for calendar/week-view blocks.
	 *
	 * Reads WordPress core's Settings → General → "Week Starts On" option.
	 *
	 * @return int 0-6 (0 = Sunday).
	 */
	public static function get_start_of_week() {
		return (int) get_option( 'start_of_week', 1 );
	}

	/**
	 * Get enabled post types for event data
	 *
	 * @return array Array of post type slugs.
	 */
	public static function get_enabled_post_types() {
		$types = get_option( 'fair_events_enabled_post_types', array() );
		if ( ! is_array( $types ) ) {
			$types = array();
		}

		// fair_event membership is owned by the registration switch, never the
		// stored list, so resolve it here regardless of how the options were saved.
		$types = array_values( array_diff( $types, array( 'fair_event' ) ) );

		if ( self::should_register_post_type() ) {
			array_unshift( $types, 'fair_event' );
		} elseif ( empty( $types ) ) {
			// Guarantee at least one type so queries/blocks keep working with the CPT off.
			$types = array( 'page' );
		}

		return array_values( array_unique( $types ) );
	}

	/**
	 * Sanitize enabled post types setting
	 *
	 * @param mixed $value Value to sanitize.
	 * @return array Sanitized array of post type slugs.
	 */
	public function sanitize_enabled_post_types( $value ) {
		if ( ! is_array( $value ) ) {
			$value = array();
		}

		// Sanitize each post type slug, dropping empties.
		$sanitized = array_filter( array_map( 'sanitize_key', $value ) );

		// fair_event is never stored here; its membership is driven by the
		// registration switch and resolved in get_enabled_post_types().
		$sanitized = array_diff( $sanitized, array( 'fair_event' ) );

		return array_values( array_unique( $sanitized ) );
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
