<?php
/**
 * Feature flag registry for Fair Audience Experimental.
 *
 * Manages the thirteen advanced bundles carried by this companion: fees,
 * polls, galleries, Instagram, groups, collaborators, messaging,
 * image-templates, timeline, import, weekly-schedule, invitations,
 * manage-event-ext. All default to true — installing this plugin signals
 * intent to use the full internal feature set.
 *
 * Resolution order (first match wins):
 *   1. Per-feature constant `FAIR_AUDIENCE_EXPERIMENTAL_FEATURE_<UPPER>`
 *   2. Master switch `FAIR_AUDIENCE_EXPERIMENTAL_INTERNAL` (true → all bundles on)
 *   3. `fair_audience_experimental_feature_enabled` filter
 *   4. Stored option `fair_audience_experimental_features`
 *   5. Hardcoded default (true for all bundles)
 *
 * @package FairAudienceExperimental
 */

namespace FairAudienceExperimental\Core;

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
			'galleries'        => array(
				'label'       => 'Galleries',
				'description' => 'Photo participation, gallery access keys, media library hooks.',
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
			'collaborators'    => array(
				'label'       => 'Collaborators',
				'description' => 'Event collaborators.',
				'default'     => true,
			),
			'messaging'        => array(
				'label'       => 'Messaging',
				'description' => 'Custom mail, extra messages, scheduled messages.',
				'default'     => true,
			),
			'image-templates'  => array(
				'label'       => 'Image templates',
				'description' => 'Generated image templates.',
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
			'weekly-schedule'  => array(
				'label'       => 'Weekly schedule',
				'description' => 'Weekly schedule admin page.',
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
		return (bool) apply_filters( 'fair_audience_experimental_feature_enabled', $enabled, $key );
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
		$translated = array(
			'fees'             => array(
				'label'       => __( 'Fees', 'fair-audience-experimental' ),
				'description' => __( 'Event fees, fee payments, fee audit log.', 'fair-audience-experimental' ),
			),
			'polls'            => array(
				'label'       => __( 'Polls', 'fair-audience-experimental' ),
				'description' => __( 'Attendee polls and responses.', 'fair-audience-experimental' ),
			),
			'galleries'        => array(
				'label'       => __( 'Galleries', 'fair-audience-experimental' ),
				'description' => __( 'Photo participation, gallery access keys, media library hooks.', 'fair-audience-experimental' ),
			),
			'instagram'        => array(
				'label'       => __( 'Instagram', 'fair-audience-experimental' ),
				'description' => __( 'Instagram post import and scheduled posting.', 'fair-audience-experimental' ),
			),
			'groups'           => array(
				'label'       => __( 'Groups', 'fair-audience-experimental' ),
				'description' => __( 'Participant groups.', 'fair-audience-experimental' ),
			),
			'collaborators'    => array(
				'label'       => __( 'Collaborators', 'fair-audience-experimental' ),
				'description' => __( 'Event collaborators.', 'fair-audience-experimental' ),
			),
			'messaging'        => array(
				'label'       => __( 'Messaging', 'fair-audience-experimental' ),
				'description' => __( 'Custom mail, extra messages, scheduled messages.', 'fair-audience-experimental' ),
			),
			'image-templates'  => array(
				'label'       => __( 'Image templates', 'fair-audience-experimental' ),
				'description' => __( 'Generated image templates.', 'fair-audience-experimental' ),
			),
			'timeline'         => array(
				'label'       => __( 'Timeline', 'fair-audience-experimental' ),
				'description' => __( 'Participant activity timeline.', 'fair-audience-experimental' ),
			),
			'import'           => array(
				'label'       => __( 'Import', 'fair-audience-experimental' ),
				'description' => __( 'Bulk participant import.', 'fair-audience-experimental' ),
			),
			'weekly-schedule'  => array(
				'label'       => __( 'Weekly schedule', 'fair-audience-experimental' ),
				'description' => __( 'Weekly schedule admin page.', 'fair-audience-experimental' ),
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
	 * Per-feature constant name (e.g. `fees` → `FAIR_AUDIENCE_EXPERIMENTAL_FEATURE_FEES`).
	 *
	 * @param string $key Bundle key.
	 * @return string
	 */
	private static function feature_constant_name( $key ) {
		return 'FAIR_AUDIENCE_EXPERIMENTAL_FEATURE_' . strtoupper( str_replace( '-', '_', $key ) );
	}
}
