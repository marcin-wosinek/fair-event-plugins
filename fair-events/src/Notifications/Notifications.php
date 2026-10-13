<?php
/**
 * Event notifications bootstrap.
 *
 * @package FairEvents
 */

namespace FairEvents\Notifications;

defined( 'WPINC' ) || die;

/**
 * Loads the weekly event notification channels this plugin owns.
 *
 * Each channel has its own settings, schedule, cron hook and history, so one
 * channel failing, being turned off or waiting for a plugin update never
 * affects another. A new channel adds its own classes here and a section to
 * the Event notifications page.
 */
class Notifications {

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
			TelegramDispatcher::init();
		}

		if ( Ownership::owns( Ownership::BULK_EMAIL ) ) {
			BulkEmailDispatcher::init();
		}

		// Sent by this plugin alone, so there is no former owner to wait for,
		// and no migration that would have created the delivery record.
		DeliveryLog::maybe_install();
		IndividualEmailDispatcher::init();

		add_action(
			'rest_api_init',
			static function () {
				( new \FairEvents\API\EventNotificationsController() )->register_routes();
			}
		);
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
		TelegramDispatcher::unschedule();
		BulkEmailDispatcher::unschedule();
		IndividualEmailDispatcher::unschedule();
	}
}
