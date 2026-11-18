<?php
/**
 * Instagram connection ownership for Fair Events Experimental
 *
 * @package FairEventsExperimental
 */

namespace FairEventsExperimental\Instagram;

use FairEventsExperimental\Core\Features;

defined( 'WPINC' ) || die;

/**
 * Decides whether this plugin owns the Instagram connection on this request.
 *
 * The connection used to belong to Fair Audience (encrypted token storage and
 * the settings tab) and Fair Audience Experimental (connection test and the
 * daily token refresh). The stored options keep their names, so moving
 * ownership needs no credential re-entry. Exactly one plugin protects the
 * token and exactly one refreshes it:
 *
 * - Updated releases of the former owners define a handoff constant when
 *   their main file loads.
 * - This plugin claims the connection on `plugins_loaded` (priority 5) when
 *   its `instagram` feature is on and Fair Audience is inactive or hands the
 *   connection over. It then defines OWNER_CONSTANT; the updated former owners
 *   check it from priority 6 on and stay out.
 * - A former owner older than the handoff defines no handoff constant and
 *   keeps its part, so this plugin leaves that part alone until it is updated.
 *
 * Nothing is recorded permanently: turning the feature off, or deactivating
 * this plugin, gives the connection back to Fair Audience on the next request
 * with the same stored, encrypted values.
 */
class Ownership {

	/**
	 * Defined on requests where this plugin owns the connection.
	 */
	const OWNER_CONSTANT = 'FAIR_EVENTS_EXPERIMENTAL_INSTAGRAM_OWNER';

	/**
	 * Fair Audience: defined by every release while active, and by releases
	 * that hand the connection over.
	 */
	const AUDIENCE_ACTIVE  = 'FAIR_AUDIENCE_VERSION';
	const AUDIENCE_HANDOFF = 'FAIR_AUDIENCE_INSTAGRAM_HANDOFF';

	/**
	 * Fair Audience Experimental: the same pair, for the token refresh.
	 */
	const AUDIENCE_EXPERIMENTAL_ACTIVE  = 'FAIR_AUDIENCE_EXPERIMENTAL_VERSION';
	const AUDIENCE_EXPERIMENTAL_HANDOFF = 'FAIR_AUDIENCE_EXPERIMENTAL_INSTAGRAM_HANDOFF';

	/**
	 * Set once the feature default was decided for an existing connection.
	 */
	const FEATURE_MIGRATION_OPTION = 'fair_events_experimental_instagram_feature_migrated';

	/**
	 * Whether a part of the connection can be taken over.
	 *
	 * @param bool $legacy_active    Whether any release of the former owner is active.
	 * @param bool $legacy_hands_off Whether that release hands its part over.
	 * @return bool
	 */
	public static function resolve( $legacy_active, $legacy_hands_off ) {
		return ! $legacy_active || $legacy_hands_off;
	}

	/**
	 * Whether this plugin should own the connection on this request.
	 *
	 * @return bool
	 */
	public static function claims() {
		return Features::is_enabled( 'instagram' )
			&& self::resolve( defined( self::AUDIENCE_ACTIVE ), defined( self::AUDIENCE_HANDOFF ) );
	}

	/**
	 * Whether the feature is on but an older Fair Audience still owns the
	 * connection, so the page can say what to update.
	 *
	 * @return bool
	 */
	public static function blocked_by_legacy() {
		return Features::is_enabled( 'instagram' ) && ! self::claims();
	}

	/**
	 * Claim the connection for this request. Runs once, on `plugins_loaded`.
	 *
	 * @return bool Whether this plugin owns the connection.
	 */
	public static function claim() {
		if ( defined( self::OWNER_CONSTANT ) ) {
			return true;
		}
		if ( ! self::claims() ) {
			return false;
		}
		define( self::OWNER_CONSTANT, true );
		return true;
	}

	/**
	 * Whether this plugin owns the connection on this request.
	 *
	 * @return bool
	 */
	public static function owns() {
		return defined( self::OWNER_CONSTANT );
	}

	/**
	 * Whether the token refresh of a Fair Audience Experimental release
	 * older than the handoff still runs, given its state.
	 *
	 * @param bool $active           Whether Fair Audience Experimental is active.
	 * @param bool $hands_off        Whether it hands the refresh over.
	 * @param bool $instagram_on     Whether its own `instagram` feature is on.
	 * @return bool
	 */
	public static function legacy_refresh_runs( $active, $hands_off, $instagram_on ) {
		return $active && ! $hands_off && $instagram_on;
	}

	/**
	 * Whether this plugin refreshes the token on this request: it owns the
	 * connection and no older Fair Audience Experimental refreshes it too.
	 *
	 * @return bool
	 */
	public static function refreshes() {
		if ( ! self::owns() ) {
			return false;
		}

		$features = '\FairAudienceExperimental\Core\Features';

		return ! self::legacy_refresh_runs(
			defined( self::AUDIENCE_EXPERIMENTAL_ACTIVE ),
			defined( self::AUDIENCE_EXPERIMENTAL_HANDOFF ),
			class_exists( $features ) && $features::is_enabled( 'instagram' )
		);
	}

	/**
	 * The feature is off by default, but a site that is already connected
	 * keeps its connection: decided once, the first time this release runs.
	 * An explicit setting, a constant or the master switch is left alone.
	 *
	 * @return void
	 */
	public static function maybe_enable_for_existing_connection() {
		if ( get_option( self::FEATURE_MIGRATION_OPTION ) ) {
			return;
		}

		$stored = get_option( Features::OPTION, array() );
		$stored = is_array( $stored ) ? $stored : array();

		if ( ! array_key_exists( 'instagram', $stored )
			&& ! Features::is_forced( 'instagram' )
			&& get_option( Connection::CONNECTED_OPTION, false ) ) {
			$stored['instagram'] = true;
			update_option( Features::OPTION, $stored );
		}

		update_option( self::FEATURE_MIGRATION_OPTION, 1 );
	}
}
