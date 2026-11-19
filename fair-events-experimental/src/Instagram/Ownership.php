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
 * The feature is off by default and only an administrator turns it on: an
 * existing connection alone never does. Nothing is recorded permanently:
 * turning the feature off, or deactivating this plugin, gives the connection
 * back to Fair Audience on the next request with the same stored, encrypted
 * values.
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
	 * Why this plugin does or does not own the connection on this request;
	 * see {@see self::reason()}. Credential-free, safe to show administrators.
	 */
	const REASON_MANAGED_HERE = 'managed_here';
	const REASON_FEATURE_OFF  = 'feature_disabled';
	// The active Fair Audience is a release without the handoff.
	const REASON_AUDIENCE_HANDOFF_MISSING = 'audience_handoff_missing';
	// Fair Audience's files on disk hand over, but the code that ran did not:
	// the update has not taken effect (a PHP opcode cache, or an update
	// still being copied).
	const REASON_AUDIENCE_UPDATE_NOT_LOADED = 'audience_update_not_loaded';
	// Nothing blocks the handoff now, but the claim did not happen while the
	// plugins loaded.
	const REASON_NOT_CLAIMED = 'not_claimed';

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
	 * Why this plugin does or does not own the connection on this request.
	 *
	 * @return string One of the REASON_* constants.
	 */
	public static function reason() {
		$audience_active = defined( self::AUDIENCE_ACTIVE );
		$hands_off       = defined( self::AUDIENCE_HANDOFF );

		return self::resolve_reason(
			self::owns(),
			Features::is_enabled( 'instagram' ),
			$audience_active,
			$hands_off,
			// Read only when it decides the answer.
			$audience_active && ! $hands_off && ! self::owns() && self::audience_files_hand_off()
		);
	}

	/**
	 * Decide the ownership reason from the request's state.
	 *
	 * A missing handoff is blamed on an old Fair Audience only when its files
	 * on disk lack it too; otherwise the update simply has not taken effect.
	 *
	 * @param bool $owns                 Whether this plugin claimed the connection.
	 * @param bool $feature_on           Whether the `instagram` feature is on.
	 * @param bool $audience_active      Whether any Fair Audience release is active.
	 * @param bool $audience_hands_off   Whether the running Fair Audience hands over.
	 * @param bool $audience_files_hand_off Whether its main file on disk hands over.
	 * @return string One of the REASON_* constants.
	 */
	public static function resolve_reason( $owns, $feature_on, $audience_active, $audience_hands_off, $audience_files_hand_off ) {
		if ( $owns ) {
			return self::REASON_MANAGED_HERE;
		}
		if ( ! $feature_on ) {
			return self::REASON_FEATURE_OFF;
		}
		if ( $audience_active && ! $audience_hands_off ) {
			return $audience_files_hand_off
				? self::REASON_AUDIENCE_UPDATE_NOT_LOADED
				: self::REASON_AUDIENCE_HANDOFF_MISSING;
		}
		return self::REASON_NOT_CLAIMED;
	}

	/**
	 * Whether the active Fair Audience's main file on disk defines the
	 * handoff constant. A capability check, not a version comparison: it
	 * tells an old release apart from an update that has not loaded yet.
	 *
	 * @return bool
	 */
	private static function audience_files_hand_off() {
		if ( ! defined( 'FAIR_AUDIENCE_PLUGIN_DIR' ) ) {
			return false;
		}
		$file = trailingslashit( (string) constant( 'FAIR_AUDIENCE_PLUGIN_DIR' ) ) . 'fair-audience.php';
		if ( ! is_readable( $file ) ) {
			return false;
		}
		// phpcs:ignore WordPress.WP.AlternativeFunctions.file_get_contents_file_get_contents -- a local plugin file, read only while the handoff is missing.
		$source = file_get_contents( $file );

		return is_string( $source ) && false !== strpos( $source, "'" . self::AUDIENCE_HANDOFF . "'" );
	}
}
