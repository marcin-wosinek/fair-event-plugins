<?php
/**
 * Feature flag registry for Fair Events Experimental.
 *
 * Manages the advanced bundles moved out of fair-events:
 * sources, ticketing extensions, mailings, and Meta conversions.
 * Existing internal bundles default on; processing integrations that
 * require explicit consent and credentials default off.
 *
 * Resolution for is_enabled(), implemented by
 * {@see \FairEventsShared\FeatureFlags}:
 *
 *   1. Per-feature constant `FAIR_EVENTS_EXPERIMENTAL_FEATURE_<UPPER>` (true/false) wins outright;
 *      the filter is not applied.
 *   2. Master switch `FAIR_EVENTS_EXPERIMENTAL_INTERNAL` (strictly true) → enabled; otherwise
 *      the stored option `fair_events_experimental_features` ([ key => bool ]) from the
 *      Settings UI, then the hardcoded default in the registry below.
 *   3. `fair_events_experimental_feature_enabled` filter receives the step-2 result and has the
 *      last word — it can override the master switch, although
 *      is_forced() still reports the key as forced.
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Core;

use FairEventsShared\FeatureFlags;

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
			'sources'          => array(
				'label'       => 'Event feeds',
				'description' => 'Event feeds with iCal/JSON output, external calendar imports, Facebook import, event proposals.',
				'default'     => true,
			),
			'ticketing'        => array(
				'label'       => 'Ticketing extensions',
				'description' => 'Group pricing and group permission rules for tickets. Requires Ticketing in the Fair Events features and Fair Audience. Turning this off keeps base ticketing and stored rules.',
				'default'     => true,
			),
			'mailings'         => array(
				'label'       => 'Mailings',
				'description' => 'Scheduled email mailings for event attendees. Requires fair-audience.',
				'default'     => true,
			),
			'meta-conversions' => array(
				'label'       => 'Meta Conversions',
				'description' => 'Consent-gated server-side Meta measurement of event-button clicks, checkouts and purchases. Requires explicit credentials; checkout and purchase measurement also requires Fair Payments Connector.',
				'default'     => false,
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
		return self::flags()->is_enabled( $key );
	}

	/**
	 * Whether the resolved value is forced (always-on, a per-feature
	 * constant, or the master switch) — used by the Settings UI to render the
	 * toggle disabled and by the option sanitizer so a UI write cannot
	 * override wp-config.
	 *
	 * @param string $key Bundle key.
	 * @return bool
	 */
	public static function is_forced( $key ) {
		return self::flags()->is_forced( $key );
	}

	/**
	 * Full snapshot for the Settings UI.
	 *
	 * @return array<string,array{label:string,description:string,default:bool,always_on:bool,enabled:bool,forced:bool}>
	 */
	public static function all() {
		$out        = array();
		$translated = array(
			'sources'          => array(
				'label'       => __( 'Event feeds', 'fair-events-experimental' ),
				'description' => __( 'Event feeds with iCal/JSON output, external calendar imports, Facebook import, event proposals.', 'fair-events-experimental' ),
			),
			'ticketing'        => array(
				'label'       => __( 'Ticketing extensions', 'fair-events-experimental' ),
				'description' => __( 'Group pricing and group permission rules for tickets. Requires Ticketing in the Fair Events features and Fair Audience. Turning this off keeps base ticketing and stored rules.', 'fair-events-experimental' ),
			),
			'mailings'         => array(
				'label'       => __( 'Mailings', 'fair-events-experimental' ),
				'description' => __( 'Scheduled email mailings for event attendees. Requires fair-audience.', 'fair-events-experimental' ),
			),
			'meta-conversions' => array(
				'label'       => __( 'Meta Conversions', 'fair-events-experimental' ),
				'description' => __( 'Consent-gated server-side Meta measurement of event-button clicks, checkouts and purchases. Requires explicit credentials; checkout and purchase measurement also requires Fair Payments Connector.', 'fair-events-experimental' ),
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
	 * Sanitize an option payload to the known key set. Forced keys keep their
	 * stored value (so a UI write cannot contradict a wp-config decision) and
	 * known keys omitted from the payload keep their existing value.
	 *
	 * @param mixed $value Raw option value.
	 * @return array<string,bool>
	 */
	public static function sanitize_option( $value ) {
		return self::flags()->sanitize_option( $value );
	}

	/**
	 * Bundled translations path. This companion is never distributed on
	 * WordPress.org, so it always loads the .mo/.json files it ships instead
	 * of waiting on a language pack that will never exist.
	 *
	 * @return string
	 */
	public static function script_translations_path() {
		return FAIR_EVENTS_EXPERIMENTAL_PLUGIN_DIR . 'build/languages';
	}

	/**
	 * Shared resolver configured with this plugin's registry, option,
	 * constants, and filter. Built per call so nothing is cached.
	 *
	 * @return FeatureFlags
	 */
	private static function flags() {
		return new FeatureFlags(
			self::registry(),
			self::OPTION,
			'FAIR_EVENTS_EXPERIMENTAL_FEATURE_',
			self::MASTER_CONSTANT,
			'fair_events_experimental_feature_enabled'
		);
	}
}
