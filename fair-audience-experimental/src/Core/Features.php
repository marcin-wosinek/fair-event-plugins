<?php
/**
 * Feature flag registry for Fair Audience Experimental.
 *
 * Manages the nine advanced bundles carried by this companion: fees,
 * polls, Instagram, groups, messaging, timeline, import, invitations,
 * manage-event-ext. All default to true — installing this plugin signals
 * intent to use the full internal feature set.
 *
 * Resolution for is_enabled(), implemented by
 * {@see \FairEventsShared\FeatureFlags}:
 *
 *   1. Per-feature constant `FAIR_AUDIENCE_EXPERIMENTAL_FEATURE_<UPPER>` (true/false) wins outright;
 *      the filter is not applied.
 *   2. Master switch `FAIR_AUDIENCE_EXPERIMENTAL_INTERNAL` (strictly true) → enabled; otherwise
 *      the stored option `fair_audience_experimental_features` ([ key => bool ]) from the
 *      Settings UI, then the hardcoded default in the registry below.
 *   3. `fair_audience_experimental_feature_enabled` filter receives the step-2 result and has the
 *      last word — it can override the master switch, although
 *      is_forced() still reports the key as forced.
 *
 * @package FairAudienceExperimental
 */

namespace FairAudienceExperimental\Core;

use FairEventsShared\FeatureFlags;

defined( 'WPINC' ) || die;

/**
 * Feature flag registry for experimental bundles.
 */
class Features {

	/**
	 * Option key holding user-toggled feature state.
	 */
	public const OPTION = 'fair_audience_experimental_features';

	/**
	 * Master switch constant.
	 */
	public const MASTER_CONSTANT = 'FAIR_AUDIENCE_EXPERIMENTAL_INTERNAL';

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
			'fees'             => array(
				'label'       => 'Fees',
				'description' => 'Event fees, fee payments, fee audit log.',
				'default'     => true,
			),
			'polls'            => array(
				'label'       => 'Polls',
				'description' => 'Attendee polls and responses.',
				'default'     => true,
			),
			'instagram'        => array(
				'label'       => 'Instagram',
				'description' => 'Instagram post import and scheduled posting.',
				'default'     => true,
			),
			'groups'           => array(
				'label'       => 'Groups',
				'description' => 'Participant groups.',
				'default'     => true,
			),
			'messaging'        => array(
				'label'       => 'Messaging',
				'description' => 'Custom mail to the whole audience, extra messages, scheduled messages.',
				'default'     => true,
			),
			'timeline'         => array(
				'label'       => 'Timeline',
				'description' => 'Participant activity timeline.',
				'default'     => true,
			),
			'import'           => array(
				'label'       => 'Import',
				'description' => 'Bulk participant import.',
				'default'     => true,
			),
			'invitations'      => array(
				'label'       => 'Invitations',
				'description' => 'Event invitations, consumed by fair-events-experimental ticketing.',
				'default'     => true,
			),
			'manage-event-ext' => array(
				'label'       => 'Manage-event extensions',
				'description' => 'The Mailings tab in the manage-event admin UI.',
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
		$translated = array(
			'fees'             => array(
				'label'       => __( 'Fees', 'fair-audience-experimental' ),
				'description' => __( 'Event fees, fee payments, fee audit log.', 'fair-audience-experimental' ),
			),
			'polls'            => array(
				'label'       => __( 'Polls', 'fair-audience-experimental' ),
				'description' => __( 'Attendee polls and responses.', 'fair-audience-experimental' ),
			),
			'instagram'        => array(
				'label'       => __( 'Instagram', 'fair-audience-experimental' ),
				'description' => __( 'Instagram post import and scheduled posting.', 'fair-audience-experimental' ),
			),
			'groups'           => array(
				'label'       => __( 'Groups', 'fair-audience-experimental' ),
				'description' => __( 'Participant groups.', 'fair-audience-experimental' ),
			),
			'messaging'        => array(
				'label'       => __( 'Messaging', 'fair-audience-experimental' ),
				'description' => __( 'Custom mail to the whole audience, extra messages, scheduled messages.', 'fair-audience-experimental' ),
			),
			'timeline'         => array(
				'label'       => __( 'Timeline', 'fair-audience-experimental' ),
				'description' => __( 'Participant activity timeline.', 'fair-audience-experimental' ),
			),
			'import'           => array(
				'label'       => __( 'Import', 'fair-audience-experimental' ),
				'description' => __( 'Bulk participant import.', 'fair-audience-experimental' ),
			),
			'invitations'      => array(
				'label'       => __( 'Invitations', 'fair-audience-experimental' ),
				'description' => __( 'Event invitations, consumed by fair-events-experimental ticketing.', 'fair-audience-experimental' ),
			),
			'manage-event-ext' => array(
				'label'       => __( 'Manage-event extensions', 'fair-audience-experimental' ),
				'description' => __( 'The Mailings tab in the manage-event admin UI.', 'fair-audience-experimental' ),
			),
		);

		$out = array();
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
		return FAIR_AUDIENCE_EXPERIMENTAL_PLUGIN_DIR . 'build/languages';
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
			'FAIR_AUDIENCE_EXPERIMENTAL_FEATURE_',
			self::MASTER_CONSTANT,
			'fair_audience_experimental_feature_enabled'
		);
	}
}
