<?php
/**
 * Custom Mail optional integrations
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Says which optional parts of Custom Mail are available on this site.
 *
 * Sending to an event's participants needs only Fair Audience. The rest comes
 * from the fair-audience-experimental companion and its feature flags, and
 * must never be a dependency of the basic event email.
 */
class CustomMailFeatures {

	/**
	 * Whether a companion feature bundle is active.
	 *
	 * @param string $bundle Bundle key in the companion's feature registry.
	 * @return bool
	 */
	private static function companion_enabled( $bundle ) {
		return class_exists( \FairAudienceExperimental\Core\Features::class )
			&& \FairAudienceExperimental\Core\Features::is_enabled( $bundle );
	}

	/**
	 * Whether an email may be sent to the whole audience instead of one
	 * event's participants. Stays experimental (`messaging` bundle).
	 *
	 * @return bool
	 */
	public static function all_audience_available() {
		return self::companion_enabled( 'messaging' );
	}

	/**
	 * Whether recipients can be narrowed to participant groups.
	 *
	 * @return bool
	 */
	public static function groups_available() {
		return self::companion_enabled( 'groups' )
			&& class_exists( \FairAudienceExperimental\Database\GroupRepository::class );
	}

	/**
	 * Whether an active companion predates the move and still registers its
	 * own Custom Mail page and routes.
	 *
	 * Detected by the controller it shipped, which the compatible companion no
	 * longer has. While this is true Fair Audience leaves Custom Mail
	 * unregistered, so the page and each send exist exactly once.
	 *
	 * @return bool
	 */
	public static function outdated_companion_active() {
		return class_exists( '\FairAudienceExperimental\API\CustomMailController' );
	}

	/**
	 * Flags for the admin page script.
	 *
	 * @return array<string,bool>
	 */
	public static function for_script() {
		return array(
			'allAudience' => self::all_audience_available(),
			'groups'      => self::groups_available(),
		);
	}
}
