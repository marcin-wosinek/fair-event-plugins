<?php
/**
 * Takes event notifications over from the plugins that used to run them.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * Copies each channel's settings and history into Fair Events, once.
 *
 * Channels are taken over independently, and only while their former owner
 * is inactive or hands them over ({@see Ownership::legacy_yields()}). A
 * takeover never sends anything and never turns a channel on:
 *
 * - Settings are copied only where Fair Events has none yet, so a repeated or
 *   interrupted run keeps later edits.
 * - A channel whose former owner was not sending when it was taken over (the
 *   plugin, or its feature, was off) arrives turned off.
 * - The former owner's own copy is turned off and its queued cron events are
 *   removed, so no older release can send the same notification.
 * - The marker is written last. Until then this plugin registers no worker
 *   for the channel.
 *
 * Runs under a database lock; a request that does not get the lock leaves the
 * work to the one holding it.
 */
class Migration {
	// MySQL rejects lock names over 64 characters; lock_name() appends 33.
	private const LOCK = 'fair_events_notif_migration';

	public const LEGACY_TELEGRAM_OPTION   = 'fair_events_experimental_weekly_notifications';
	public const LEGACY_TELEGRAM_RUNS     = 'fair_events_experimental_weekly_notification_runs';
	public const LEGACY_TELEGRAM_NEXT_RUN = 'fair_events_experimental_weekly_notification_next_run';
	public const LEGACY_TELEGRAM_HOOK     = 'fair_events_experimental_weekly_notification';

	public const LEGACY_BULK_OPTION      = 'fair_audience_weekly_digest';
	public const LEGACY_BULK_LAST_SENT   = 'fair_audience_weekly_digest_last_sent_week';
	public const LEGACY_BULK_LAST_RESULT = 'fair_audience_weekly_digest_last_run_result';
	public const LEGACY_BULK_HOOK        = 'fair_audience_weekly_digest_tick';

	/**
	 * Take over every channel that is ready and not taken over yet.
	 *
	 * @return void
	 */
	public static function run() {
		$pending = array_filter(
			array( Ownership::TELEGRAM, Ownership::BULK_EMAIL ),
			static function ( $channel ) {
				return ! Ownership::is_migrated( $channel ) && Ownership::legacy_yields( $channel );
			}
		);
		if ( ! $pending || ! self::lock() ) {
			return;
		}

		try {
			// Another request may have finished while this one waited to start.
			wp_cache_delete( Ownership::OPTION, 'options' );
			wp_cache_delete( 'alloptions', 'options' );

			DeliveryLog::maybe_install();
			foreach ( $pending as $channel ) {
				if ( Ownership::is_migrated( $channel ) ) {
					continue;
				}
				$details = Ownership::TELEGRAM === $channel
					? self::telegram( new DeliveryLog() )
					: self::bulk_email( new DeliveryLog() );
				Ownership::mark_migrated( $channel, $details );
			}
		} finally {
			self::unlock();
		}
	}

	/**
	 * Take over the weekly Telegram summary.
	 *
	 * The bot token and the delivery records stay where they are: this plugin
	 * reads the same option and the same table.
	 *
	 * @param DeliveryLog $log Delivery record, unused: Telegram's records are already in it.
	 * @return array What was found.
	 */
	public static function telegram( $log ) {
		unset( $log );
		$legacy      = get_option( self::LEGACY_TELEGRAM_OPTION, null );
		$was_enabled = is_array( $legacy ) && ! empty( $legacy['enabled'] );
		$was_sending = $was_enabled && self::telegram_was_running();

		if ( is_array( $legacy ) && false === get_option( TelegramSettings::OPTION, false ) ) {
			$settings            = TelegramSettings::normalize( $legacy );
			$settings['enabled'] = $was_sending;
			TelegramSettings::save( $settings );
		}

		$runs = get_option( self::LEGACY_TELEGRAM_RUNS, null );
		if ( is_array( $runs ) && false === get_option( TelegramDispatcher::RUNS_OPTION, false ) ) {
			update_option( TelegramDispatcher::RUNS_OPTION, $runs, false );
		}

		if ( $was_enabled ) {
			$legacy['enabled'] = false;
			update_option( self::LEGACY_TELEGRAM_OPTION, $legacy, false );
		}
		wp_unschedule_hook( self::LEGACY_TELEGRAM_HOOK );
		delete_option( self::LEGACY_TELEGRAM_NEXT_RUN );

		return array(
			'legacy_enabled' => $was_enabled,
			'kept_enabled'   => $was_sending,
		);
	}

	/**
	 * Take over the weekly email.
	 *
	 * @param DeliveryLog $log Delivery record.
	 * @return array What was found.
	 */
	public static function bulk_email( $log ) {
		$legacy      = get_option( self::LEGACY_BULK_OPTION, null );
		$was_enabled = is_array( $legacy ) && ! empty( $legacy['enabled'] );
		// Fair Audience sent it whenever it was active.
		$was_sending = $was_enabled && Ownership::legacy_active( Ownership::BULK_EMAIL );

		if ( is_array( $legacy ) && false === get_option( BulkEmailSettings::OPTION, false ) ) {
			$settings            = BulkEmailSettings::sanitize( $legacy );
			$settings['enabled'] = $was_sending;
			BulkEmailSettings::save( $settings );
		}

		// The week already sent stays used up.
		$last_sent  = (string) get_option( self::LEGACY_BULK_LAST_SENT, '' );
		$claim_date = BulkEmailDispatcher::week_start( $last_sent );
		if ( $claim_date ) {
			if ( false === get_option( BulkEmailDispatcher::LAST_SENT_OPTION, false ) ) {
				update_option( BulkEmailDispatcher::LAST_SENT_OPTION, $last_sent, false );
			}
			$log->claim( $claim_date, BulkEmailDispatcher::PROVIDER, BulkEmailDispatcher::DESTINATION, 1, 1, 'sent', 'migrated' );
		}

		$result = get_option( self::LEGACY_BULK_LAST_RESULT, null );
		if ( is_array( $result ) && ! empty( $result['status'] ) && false === get_option( BulkEmailDispatcher::RUNS_OPTION, false ) ) {
			$key = '' !== $last_sent ? $last_sent : 'migrated';
			update_option(
				BulkEmailDispatcher::RUNS_OPTION,
				array(
					$key => array(
						'send_week'  => $claim_date ? $last_sent : '',
						'week_start' => '',
						'week_end'   => '',
						'status'     => 'skipped' === $result['status'] ? 'skipped_empty' : sanitize_key( $result['status'] ),
						'message'    => sanitize_text_field( (string) ( $result['message'] ?? '' ) ),
						'counts'     => array(),
						'time'       => self::local_to_utc( (string) ( $result['timestamp'] ?? '' ) ),
					),
				),
				false
			);
		}

		if ( $was_enabled ) {
			$legacy['enabled'] = false;
			update_option( self::LEGACY_BULK_OPTION, $legacy );
		}
		wp_clear_scheduled_hook( self::LEGACY_BULK_HOOK );

		return array(
			'legacy_enabled' => $was_enabled,
			'kept_enabled'   => $was_sending,
		);
	}

	/**
	 * Whether Fair Events Experimental was running the Telegram summary.
	 *
	 * It did so only while active with its event sources bundle on.
	 *
	 * @return bool
	 */
	private static function telegram_was_running() {
		if ( ! Ownership::legacy_active( Ownership::TELEGRAM ) ) {
			return false;
		}

		$features = '\FairEventsExperimental\Core\Features';
		return ! method_exists( $features, 'is_enabled' ) || $features::is_enabled( 'sources' );
	}

	/**
	 * Convert a site-local 'Y-m-d H:i:s' time to UTC.
	 *
	 * @param string $local Site-local time.
	 * @return string UTC time, or the current one when the value is not a time.
	 */
	private static function local_to_utc( $local ) {
		$moment = \DateTimeImmutable::createFromFormat( 'Y-m-d H:i:s', $local, wp_timezone() );
		return $moment
			? $moment->setTimezone( new \DateTimeZone( 'UTC' ) )->format( 'Y-m-d H:i:s' )
			: gmdate( 'Y-m-d H:i:s' );
	}

	/**
	 * Take the migration lock without waiting.
	 *
	 * @return bool
	 */
	private static function lock() {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- a session lock, nothing to cache.
		return '1' === (string) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, 0)', self::lock_name() ) );
	}

	/**
	 * Release the migration lock.
	 *
	 * @return void
	 */
	private static function unlock() {
		global $wpdb;
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery -- a session lock, nothing to cache.
		$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', self::lock_name() ) );
	}

	/**
	 * Lock name, unique per site on a shared database server.
	 *
	 * @return string
	 */
	private static function lock_name() {
		global $wpdb;
		return self::LOCK . '_' . md5( DB_NAME . $wpdb->prefix );
	}
}
