<?php
/**
 * Event notifications bootstrap.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * Loads the weekly event notification types this plugin owns.
 *
 * Each type can have several configurations ({@see Configurations}), each
 * with its own settings, schedule, history and delivery records, so one
 * configuration failing, being turned off or waiting for a plugin update
 * never affects another. A new type adds its own classes here and a section
 * to the Event notifications page.
 *
 * A type's worker runs only once its single settings were migrated to a
 * configuration ({@see ConfigurationMigration}).
 */
class Notifications {
	public const HISTORY_CLEANUP_HOOK = 'fair_events_notification_history_cleanup';

	/**
	 * Start once every plugin had the chance to say whether it hands over.
	 *
	 * @return void
	 */
	public static function init() {
		// After Fair Events Experimental's own bootstrap (priority 5), which
		// is where its version constant is defined.
		add_action( 'plugins_loaded', array( self::class, 'boot' ), 20 );
	}

	/**
	 * Take over what is ready, then run the owned channels.
	 *
	 * @return void
	 */
	public static function boot() {
		Migration::run();

		if ( Ownership::owns( Ownership::TELEGRAM ) ) {
			TelegramConnector::init();
			if ( ConfigurationMigration::is_migrated( Configurations::TELEGRAM ) ) {
				TelegramDispatcher::init();
			}
		}

		if ( Ownership::owns( Ownership::BULK_EMAIL ) && ConfigurationMigration::is_migrated( Configurations::BULK_EMAIL ) ) {
			BulkEmailDispatcher::init();
		}

		// Sent by this plugin alone, so there is no former owner to wait for.
		if ( ConfigurationMigration::is_migrated( Configurations::INDIVIDUAL_EMAIL ) ) {
			IndividualEmailDispatcher::init();
		}

		// Whatever channels are on: history is kept for every type.
		add_action( self::HISTORY_CLEANUP_HOOK, array( self::class, 'clean_up_history' ) );
		if ( ! wp_next_scheduled( self::HISTORY_CLEANUP_HOOK ) ) {
			wp_schedule_event( time() + HOUR_IN_SECONDS, 'daily', self::HISTORY_CLEANUP_HOOK );
		}

		add_action(
			'rest_api_init',
			static function () {
				( new \FairEvents\API\EventNotificationsController() )->register_routes();
				( new \FairEvents\API\NotificationHistoryController() )->register_routes();
			}
		);
	}

	/**
	 * Daily: close executions abandoned mid-run and delete history past its retention.
	 *
	 * @return void
	 */
	public static function clean_up_history() {
		$history = new ExecutionHistory();
		$history->reconcile();
		$history->cleanup();
	}

	/**
	 * Stop every scheduled send when Fair Events is deactivated.
	 *
	 * Settings and history stay. Nothing else sends in the meantime: the
	 * former owners read the ownership marker and stay out.
	 *
	 * @return void
	 */
	public static function deactivate() {
		TelegramDispatcher::unschedule_all();
		BulkEmailDispatcher::unschedule_all();
		IndividualEmailDispatcher::unschedule_all();
		wp_unschedule_hook( self::HISTORY_CLEANUP_HOOK );
	}
}
