<?php
/**
 * Feature flag registry for Fair Events Experimental.
 *
 * Manages the six advanced bundles moved out of fair-events:
 * galleries, sources, ticketing, event-tools, migration, venues.
 * All default to true — installing this plugin signals intent to use the full
 * internal feature set.
 *
 * Resolution order (first match wins):
 *   1. Per-feature constant `FAIR_EVENTS_EXPERIMENTAL_FEATURE_<UPPER>`
 *   2. Master switch `FAIR_EVENTS_EXPERIMENTAL_INTERNAL` (true → all bundles on)
 *   3. `fair_events_experimental_feature_enabled` filter
 *   4. Stored option `fair_events_experimental_features`
 *   5. Hardcoded default (true for all bundles)
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Core;

defined( 'WPINC' ) || die;

/**
 * Feature flag registry for experimental bundles.
 */
class Features {

	/**
	 * Option key holding user-toggled feature state.
	 */
	public const OPTION = 'fair_events_experimental_features';

	/**
	 * Master switch constant.
	 */
	public const MASTER_CONSTANT = 'FAIR_EVENTS_EXPERIMENTAL_INTERNAL';

	/**
	 * Canonical bundle registry.
	 *
	 * Labels are intentionally untranslated here; translation is applied in
	 * {@see self::all()} which only runs in admin REST contexts.
	 *
	 * @return array<string,array{label:string,description:string,default:bool,always_on?:bool}>
	 */
	public static function registry() {
		return array(
			'galleries'           => array(
				'label'       => 'Galleries',
				'description' => 'Per-event photo galleries, photo likes/downloads, image exports, media library hooks.',
				'default'     => true,
			),
			'sources'             => array(
				'label'       => 'Event sources & feeds',
				'description' => 'External event sources, Facebook import, iCal/JSON feeds, event proposals, weekly schedule.',
				'default'     => true,
			),
			'ticketing'           => array(
				'label'       => 'Ticketing',
				'description' => 'Tickets, group pricing/permission rules, invitations. Requires fair-audience.',
				'default'     => true,
			),
			'event-tools'         => array(
				'label'       => 'Event tools',
				'description' => 'Event duplication, merge, and admin-bar Copy button.',
				'default'     => true,
			),
			'migration'           => array(
				'label'       => 'Migration',
				'description' => 'One-time post → event migration tooling.',
				'default'     => true,
			),
			'venues'              => array(
				'label'       => 'Venues',
				'description' => 'Venues admin page and REST controller.',
				'default'     => true,
			),
			'audience-statistics' => array(
				'label'       => 'Audience statistics',
				'description' => 'Per-event statistics charts (activity breakdown, sales lead time). Requires fair-audience.',
				'default'     => true,
			),
		);
	}

	/**
	 * Resolve whether a feature bundle is enabled.
	 *
	 * @param string $key Bundle key from registry().
	 * @return bool
	 */
	public static function is_enabled( $key ) {
		$registry = self::registry();
		if ( ! isset( $registry[ $key ] ) ) {
			return false;
		}

		// 1. Per-feature constant always wins.
		$constant = self::feature_constant_name( $key );
		if ( defined( $constant ) ) {
			return (bool) constant( $constant );
		}

		// 2. Master switch flips every bundle on.
		if ( defined( self::MASTER_CONSTANT ) && true === constant( self::MASTER_CONSTANT ) ) {
			$enabled = true;
		} else {
			// 4. Stored option, then 5. hardcoded default.
			$stored  = get_option( self::OPTION, array() );
			$enabled = is_array( $stored ) && array_key_exists( $key, $stored )
				? (bool) $stored[ $key ]
				: (bool) $registry[ $key ]['default'];
		}

		// 3. Filter runs after constants.
		return (bool) apply_filters( 'fair_events_experimental_feature_enabled', $enabled, $key );
	}

	/**
	 * Whether the resolved value is forced by a constant.
	 *
	 * @param string $key Bundle key.
	 * @return bool
	 */
	public static function is_forced( $key ) {
		$registry = self::registry();
		if ( ! isset( $registry[ $key ] ) ) {
			return false;
		}

		if ( defined( self::feature_constant_name( $key ) ) ) {
			return true;
		}

		return defined( self::MASTER_CONSTANT ) && true === constant( self::MASTER_CONSTANT );
	}

	/**
	 * Full snapshot for the Settings UI.
	 *
	 * @return array<string,array{label:string,description:string,default:bool,always_on:bool,enabled:bool,forced:bool}>
	 */
	public static function all() {
		$out        = array();
		$translated = array(
			'galleries'           => array(
				'label'       => __( 'Galleries', 'fair-events-experimental' ),
				'description' => __( 'Per-event photo galleries, photo likes/downloads, image exports, media library hooks.', 'fair-events-experimental' ),
			),
			'sources'             => array(
				'label'       => __( 'Event sources & feeds', 'fair-events-experimental' ),
				'description' => __( 'External event sources, Facebook import, iCal/JSON feeds, event proposals, weekly schedule.', 'fair-events-experimental' ),
			),
			'ticketing'           => array(
				'label'       => __( 'Ticketing', 'fair-events-experimental' ),
				'description' => __( 'Tickets, group pricing/permission rules, invitations. Requires fair-audience.', 'fair-events-experimental' ),
			),
			'event-tools'         => array(
				'label'       => __( 'Event tools', 'fair-events-experimental' ),
				'description' => __( 'Event duplication, merge, and admin-bar Copy button.', 'fair-events-experimental' ),
			),
			'migration'           => array(
				'label'       => __( 'Migration', 'fair-events-experimental' ),
				'description' => __( 'One-time post → event migration tooling.', 'fair-events-experimental' ),
			),
			'venues'              => array(
				'label'       => __( 'Venues', 'fair-events-experimental' ),
				'description' => __( 'Venues admin page and REST controller.', 'fair-events-experimental' ),
			),
			'audience-statistics' => array(
				'label'       => __( 'Audience statistics', 'fair-events-experimental' ),
				'description' => __( 'Per-event statistics charts (activity breakdown, sales lead time). Requires fair-audience.', 'fair-events-experimental' ),
			),
		);

		foreach ( self::registry() as $key => $entry ) {
			$out[ $key ] = array(
				'label'       => $translated[ $key ]['label'] ?? $entry['label'],
				'description' => $translated[ $key ]['description'] ?? $entry['description'],
				'default'     => (bool) $entry['default'],
				'always_on'   => ! empty( $entry['always_on'] ),
				'enabled'     => self::is_enabled( $key ),
				'forced'      => self::is_forced( $key ),
			);
		}
		return $out;
	}

	/**
	 * Sanitize an option payload for the known key set, dropping forced keys.
	 *
	 * @param mixed $value Raw option value.
	 * @return array<string,bool>
	 */
	public static function sanitize_option( $value ) {
		if ( ! is_array( $value ) ) {
			return array();
		}

		$existing = get_option( self::OPTION, array() );
		if ( ! is_array( $existing ) ) {
			$existing = array();
		}

		$registry = self::registry();
		$out      = array();
		foreach ( $registry as $key => $entry ) {
			if ( ! empty( $entry['always_on'] ) ) {
				continue;
			}

			if ( self::is_forced( $key ) ) {
				if ( array_key_exists( $key, $existing ) ) {
					$out[ $key ] = (bool) $existing[ $key ];
				}
				continue;
			}

			if ( array_key_exists( $key, $value ) ) {
				$out[ $key ] = (bool) $value[ $key ];
			} elseif ( array_key_exists( $key, $existing ) ) {
				$out[ $key ] = (bool) $existing[ $key ];
			}
		}
		return $out;
	}

	/**
	 * Per-feature constant name (e.g. `galleries` → `FAIR_EVENTS_EXPERIMENTAL_FEATURE_GALLERIES`).
	 *
	 * @param string $key Bundle key.
	 * @return string
	 */
	private static function feature_constant_name( $key ) {
		return 'FAIR_EVENTS_EXPERIMENTAL_FEATURE_' . strtoupper( str_replace( '-', '_', $key ) );
	}
}
