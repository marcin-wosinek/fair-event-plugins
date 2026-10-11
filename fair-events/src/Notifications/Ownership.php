<?php
/**
 * Event notification ownership for Fair Events
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * Decides, per channel, whether this plugin runs event notifications.
 *
 * Telegram summaries moved here from Fair Events Experimental and the weekly
 * email from Fair Audience. Each channel has exactly one sender:
 *
 * - This plugin defines OWNS_CONSTANT when its main file loads. An updated
 *   legacy plugin no longer ships a sender and points its entry to this one.
 * - An updated legacy plugin defines its handoff constant when its main file
 *   loads.
 * - A legacy release older than the handoff defines no handoff constant and
 *   keeps sending itself, so this plugin leaves that channel alone until the
 *   release is updated or deactivated. The other channel is not affected.
 *
 * Once a channel's settings and history were taken over, a marker is saved in
 * OPTION. It is never removed: the legacy plugins read it and stay out for
 * good, also while this plugin is inactive.
 *
 * Fair Events Experimental defines its version constant on `plugins_loaded`
 * (priority 5), so ask on a later priority.
 */
class Ownership {

	/**
	 * Defined by this plugin's main file: this release can own notifications.
	 */
	const OWNS_CONSTANT = 'FAIR_EVENTS_OWNS_EVENT_NOTIFICATIONS';

	/**
	 * Option holding the channels taken over, keyed by channel.
	 */
	const OPTION = 'fair_events_notification_ownership';

	const TELEGRAM   = 'telegram';
	const BULK_EMAIL = 'bulk_email';

	/**
	 * Per channel: the constant every release of the former owner defines
	 * while active, and the one it defines when it hands the channel over.
	 */
	const LEGACY = array(
		self::TELEGRAM   => array(
			'active'  => 'FAIR_EVENTS_EXPERIMENTAL_VERSION',
			'handoff' => 'FAIR_EVENTS_EXPERIMENTAL_NOTIFICATIONS_HANDOFF',
		),
		self::BULK_EMAIL => array(
			'active'  => 'FAIR_AUDIENCE_VERSION',
			'handoff' => 'FAIR_AUDIENCE_EVENT_NOTIFICATIONS_HANDOFF',
		),
	);

	/**
	 * Whether a channel can be taken over for a given legacy-plugin state.
	 *
	 * @param bool $legacy_active    Whether any release of the former owner is active.
	 * @param bool $legacy_hands_off Whether that release hands the channel over.
	 * @return bool
	 */
	public static function resolve( $legacy_active, $legacy_hands_off ) {
		return ! $legacy_active || $legacy_hands_off;
	}

	/**
	 * Whether the former owner of a channel is active.
	 *
	 * @param string $channel Channel key.
	 * @return bool
	 */
	public static function legacy_active( $channel ) {
		return defined( self::LEGACY[ $channel ]['active'] );
	}

	/**
	 * Whether the former owner of a channel is out of the way on this request.
	 *
	 * @param string $channel Channel key.
	 * @return bool
	 */
	public static function legacy_yields( $channel ) {
		return self::resolve(
			self::legacy_active( $channel ),
			defined( self::LEGACY[ $channel ]['handoff'] )
		);
	}

	/**
	 * Whether a channel's settings and history were taken over.
	 *
	 * @param string $channel Channel key.
	 * @return bool
	 */
	public static function is_migrated( $channel ) {
		$state = get_option( self::OPTION, array() );
		return is_array( $state ) && ! empty( $state[ $channel ] );
	}

	/**
	 * Record that a channel was taken over.
	 *
	 * @param string $channel Channel key.
	 * @param array  $details What the takeover found, kept for support.
	 * @return void
	 */
	public static function mark_migrated( $channel, array $details = array() ) {
		$state             = get_option( self::OPTION, array() );
		$state             = is_array( $state ) ? $state : array();
		$state[ $channel ] = array_merge( $details, array( 'migrated_at' => gmdate( 'Y-m-d H:i:s' ) ) );
		update_option( self::OPTION, $state, true );
	}

	/**
	 * Whether this plugin runs a channel on this request.
	 *
	 * @param string $channel Channel key.
	 * @return bool
	 */
	public static function owns( $channel ) {
		return self::is_migrated( $channel ) && self::legacy_yields( $channel );
	}
}
