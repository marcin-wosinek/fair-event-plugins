<?php
/**
 * Gives each type's former single settings a configuration ID.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * Turns each notification type's single settings into its first
 * configuration, once.
 *
 * Before configurations had IDs, each type kept one set of settings, next
 * send, run history and last sent week in options of its own, and its queued
 * cron events carried only the week. For each type this:
 *
 * - creates the configuration with the type's stable ID
 *   ({@see Configurations::legacy_id()}), with the saved settings and on/off
 *   state, or the defaults (off) where nothing was saved. An existing
 *   configuration is never overwritten, so a repeated or interrupted run
 *   keeps later edits;
 * - copies the run history and last sent week where the configuration has
 *   none yet;
 * - re-queues every queued send with the configuration ID at the same time
 *   and for the same week, then removes the old event. Nothing is sent and
 *   nothing missed is replayed: a send still due runs as it would have, and
 *   is handled by the usual expiry rules.
 *
 * Delivery claims are assigned in {@see DeliveryLog::maybe_install()}, which
 * runs first. The type's marker is written last, after checking that the
 * configuration exists and no event without an ID is left; until then the
 * type's worker is not registered. Telegram and bulk email wait until they
 * were taken over from their former owners ({@see Migration}).
 *
 * Call while holding {@see Lock::MIGRATION}.
 */
class ConfigurationMigration {
	public const VERSION = '1';

	/**
	 * Option recording, per type, the migration version that completed.
	 */
	public const OPTION = 'fair_events_notification_configuration_migration';

	/**
	 * Migrate every type that is ready and not migrated yet.
	 *
	 * @return void
	 */
	public static function run() {
		foreach ( Configurations::TYPES as $type ) {
			if ( ! self::is_migrated( $type ) && self::ready( $type ) ) {
				$details = self::migrate( $type );
				if ( null !== $details ) {
					self::mark_migrated( $type, $details );
				}
			}
		}
	}

	/**
	 * Whether every type was migrated.
	 *
	 * @return bool
	 */
	public static function is_complete() {
		foreach ( Configurations::TYPES as $type ) {
			if ( ! self::is_migrated( $type ) ) {
				return false;
			}
		}
		return true;
	}

	/**
	 * Whether a type was migrated at the current version.
	 *
	 * @param string $type Notification type.
	 * @return bool
	 */
	public static function is_migrated( $type ) {
		$state = get_option( self::OPTION, array() );
		return is_array( $state ) && self::VERSION === ( $state[ $type ]['version'] ?? null );
	}

	/**
	 * Whether a type's single settings belong to this plugin yet.
	 *
	 * @param string $type Notification type.
	 * @return bool
	 */
	public static function ready( $type ) {
		return Configurations::INDIVIDUAL_EMAIL === $type || Ownership::is_migrated( $type );
	}

	/**
	 * Move one type's single settings and state to its configuration.
	 *
	 * @param string $type Notification type.
	 * @return array|null What was moved, or null when the migration is not complete.
	 */
	public static function migrate( $type ) {
		$source = self::source( $type );
		$id     = Configurations::legacy_id( $type );

		$saved   = get_option( $source['settings_option'], false );
		$created = false;
		if ( ! Configurations::exists( $id, $type ) ) {
			// Once migrated, the bulk email option holds a summary, not settings.
			$settings = is_array( $saved ) && empty( $saved['summary'] ) ? $saved : array();
			if ( ! Configurations::create( $type, '', call_user_func( $source['normalize'], $settings ), $id ) ) {
				return null;
			}
			$created = true;
		}

		foreach ( $source['state'] as $suffix => $legacy_option ) {
			$value = get_option( $legacy_option, null );
			if ( null !== $value && false === get_option( Configurations::option( $id, $suffix ), false ) ) {
				update_option( Configurations::option( $id, $suffix ), $value, false );
			}
		}

		$hook  = $source['hook'];
		$moved = 0;
		foreach ( ScheduledSends::without_configuration( $hook ) as list( $timestamp, $args ) ) {
			$with_id = array( $args[0], $id );
			if ( ! wp_next_scheduled( $hook, $with_id ) ) {
				wp_schedule_single_event( $timestamp, $hook, $with_id );
			}
			wp_unschedule_event( $timestamp, $hook, $args );
			++$moved;
		}

		$next      = get_option( $source['next_run_option'], null );
		$next_week = is_array( $next ) ? (string) ( $next[ $source['week_key'] ] ?? '' ) : '';
		if ( '' !== $next_week
			&& false === get_option( Configurations::option( $id, 'next_run' ), false )
			&& wp_next_scheduled( $hook, array( $next_week, $id ) )
		) {
			update_option( Configurations::option( $id, 'next_run' ), $next, false );
		}
		delete_option( $source['next_run_option'] );

		if ( ! Configurations::exists( $id, $type ) || ScheduledSends::without_configuration( $hook ) ) {
			return null;
		}

		if ( Configurations::BULK_EMAIL === $type ) {
			BulkEmailSettings::refresh_summary();
		}

		return array(
			'configuration_id' => $id,
			'created'          => $created,
			'had_settings'     => is_array( $saved ) && empty( $saved['summary'] ),
			'moved_sends'      => $moved,
		);
	}

	/**
	 * Record that a type was migrated.
	 *
	 * @param string $type    Notification type.
	 * @param array  $details What the migration moved, kept for support.
	 * @return void
	 */
	private static function mark_migrated( $type, array $details ) {
		$state          = get_option( self::OPTION, array() );
		$state          = is_array( $state ) ? $state : array();
		$state[ $type ] = array_merge(
			$details,
			array(
				'version'     => self::VERSION,
				'migrated_at' => gmdate( 'Y-m-d H:i:s' ),
			)
		);
		update_option( self::OPTION, $state, true );
	}

	/**
	 * Where a type kept its single settings and state.
	 *
	 * @param string $type Notification type.
	 * @return array
	 */
	private static function source( $type ) {
		switch ( $type ) {
			case Configurations::TELEGRAM:
				return array(
					'settings_option' => TelegramSettings::OPTION,
					'normalize'       => array( TelegramSettings::class, 'normalize' ),
					'hook'            => TelegramDispatcher::HOOK,
					'next_run_option' => TelegramDispatcher::LEGACY_NEXT_RUN_OPTION,
					'week_key'        => 'week_start',
					'state'           => array( 'runs' => TelegramDispatcher::LEGACY_RUNS_OPTION ),
				);
			case Configurations::BULK_EMAIL:
				return array(
					'settings_option' => BulkEmailSettings::OPTION,
					'normalize'       => array( BulkEmailSettings::class, 'sanitize' ),
					'hook'            => BulkEmailDispatcher::HOOK,
					'next_run_option' => BulkEmailDispatcher::LEGACY_NEXT_RUN_OPTION,
					'week_key'        => 'send_week',
					'state'           => array(
						'runs'           => BulkEmailDispatcher::LEGACY_RUNS_OPTION,
						'last_sent_week' => BulkEmailDispatcher::LEGACY_LAST_SENT_OPTION,
					),
				);
			default:
				return array(
					'settings_option' => IndividualEmailSettings::OPTION,
					'normalize'       => array( IndividualEmailSettings::class, 'sanitize' ),
					'hook'            => IndividualEmailDispatcher::HOOK,
					'next_run_option' => IndividualEmailDispatcher::LEGACY_NEXT_RUN_OPTION,
					'week_key'        => 'send_week',
					'state'           => array(
						'runs'           => IndividualEmailDispatcher::LEGACY_RUNS_OPTION,
						'last_sent_week' => IndividualEmailDispatcher::LEGACY_LAST_SENT_OPTION,
					),
				);
		}
	}
}
