<?php
/**
 * Plugin Name: Fair E2E notification startup
 * Description: Test-only. While the `fair_e2e_notification_startup` option is set, stands in for the integrations that warned when Fair Events notification startup ran too early (#2059) and logs what each request's startup did.
 *
 * Two stand-ins, both loaded before any normal plugin, behave like the
 * integrations in the original reports:
 *
 * - An option-update observer that needs a scheduler data store set up on
 *   `init` priority 1, like Hostinger's integration and Action Scheduler.
 *   An option written before then raises `_doing_it_wrong()`.
 * - A translated `cron_schedules` label, like Ultimate Addons for
 *   Gutenberg, Fair Payments Connector and Fair Audience. Building it before
 *   translations are set up on `init` priority 10 raises the same notice
 *   WordPress raises for translations loaded too early.
 *
 * Every `_doing_it_wrong()` of the request is recorded, marked when Fair
 * Events notification code is on the call stack. On `wp_loaded` the log
 * records which notification workers, handlers and connector settings are in
 * place. Each request appends one entry to the
 * `fair_e2e_notification_startup_log` option, except the runs of
 * scripts/notification-startup-fixture.php, which skip notification startup
 * altogether.
 *
 * Mounted only into the wp-env tests instance via .wp-env.json — never
 * shipped.
 *
 * @package FairEventsE2E
 */

defined( 'ABSPATH' ) || exit;

if ( ! get_option( 'fair_e2e_notification_startup' ) ) {
	return;
}

// No cron loopback from page requests: each startup the spec makes stays
// one log entry, and wp-cron.php still runs when requested directly.
if ( ! defined( 'DISABLE_WP_CRON' ) ) {
	define( 'DISABLE_WP_CRON', true );
}

// The fixture script seeds and reads state between the startups under test,
// so its own WP-CLI runs neither start notifications nor add to the log.
if ( defined( 'WP_CLI' ) && WP_CLI ) {
	foreach ( (array) ( $GLOBALS['argv'] ?? array() ) as $fair_e2e_argument ) {
		if ( 'notification-startup-fixture.php' === basename( (string) $fair_e2e_argument ) ) {
			$GLOBALS['fair_e2e_notification_startup_quiet'] = true;
			add_action(
				'plugins_loaded',
				static function () {
					remove_action( 'init', array( 'FairEvents\Notifications\Notifications', 'start' ), 11 );
				},
				21
			);
		}
	}
}

$GLOBALS['fair_e2e_notification_startup'] = array(
	'scheduler_ready'    => false,
	'translations_ready' => false,
	'entry'              => array(
		'context'     => defined( 'WP_CLI' ) && WP_CLI ? 'cli' : ( wp_doing_cron() ? 'cron' : 'http' ),
		'uri'         => isset( $_SERVER['REQUEST_URI'] ) ? sanitize_text_field( wp_unslash( $_SERVER['REQUEST_URI'] ) ) : '',
		'diagnostics' => array(),
		'early_cron'  => array(),
		'writes'      => array(),
		'stages'      => array(),
		'cleanup_ran' => false,
	),
);

/**
 * The Fair plugin code on the call stack, outermost first.
 *
 * @return string[] Class or function names in a `Fair*` namespace.
 */
function fair_e2e_notification_startup_fair_callers() {
	$callers = array();
	// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_debug_backtrace -- test fixture.
	foreach ( array_reverse( debug_backtrace( DEBUG_BACKTRACE_IGNORE_ARGS ) ) as $frame ) {
		$name = $frame['class'] ?? $frame['function'] ?? '';
		if ( preg_match( '/^Fair[A-Za-z]*\\\\/', $name ) ) {
			$callers[] = $name;
		}
	}
	return array_values( array_unique( $callers ) );
}

/**
 * Whether Fair Events notification code is on the call stack.
 *
 * @return bool
 */
function fair_e2e_notification_startup_from_notifications() {
	// phpcs:ignore WordPress.PHP.DevelopmentFunctions.error_log_debug_backtrace -- test fixture.
	foreach ( debug_backtrace( DEBUG_BACKTRACE_IGNORE_ARGS ) as $frame ) {
		if ( isset( $frame['class'] ) && 0 === strpos( $frame['class'], 'FairEvents\\Notifications\\' ) ) {
			return true;
		}
	}
	return false;
}

// The stand-ins' setup, ahead of every plugin's callbacks at the same priority.
add_action(
	'init',
	static function () {
		$GLOBALS['fair_e2e_notification_startup']['scheduler_ready'] = true;
	},
	1
);
add_action(
	'init',
	static function () {
		$GLOBALS['fair_e2e_notification_startup']['translations_ready'] = true;
	},
	10
);

$fair_e2e_notification_startup_observer = static function ( $option ) {
	$from_notifications = fair_e2e_notification_startup_from_notifications();
	if ( $from_notifications ) {
		$GLOBALS['fair_e2e_notification_startup']['entry']['writes'][] = $option;
	}
	if ( ! $GLOBALS['fair_e2e_notification_startup']['scheduler_ready'] ) {
		_doing_it_wrong(
			'Fair_E2E_Scheduler_Store::instance',
			sprintf( 'Option %s was updated before the scheduler data store was initialized.', esc_html( $option ) ),
			'0.0.0'
		);
	}
};
add_action( 'added_option', $fair_e2e_notification_startup_observer );
add_action( 'updated_option', $fair_e2e_notification_startup_observer );

add_filter(
	'cron_schedules', // phpcs:ignore WordPress.WP.CronInterval.ChangeDetected -- test fixture.
	static function ( $schedules ) {
		if ( ! $GLOBALS['fair_e2e_notification_startup']['translations_ready'] ) {
			// Which plugin scheduled before `init` (#2064).
			$callers = fair_e2e_notification_startup_fair_callers();
			if ( $callers ) {
				$GLOBALS['fair_e2e_notification_startup']['entry']['early_cron'][] = $callers[0];
			}
			_doing_it_wrong(
				'_load_textdomain_just_in_time',
				'Translation loading for the <code>fair-e2e-startup</code> domain was triggered too early.',
				'6.7.0'
			);
		}
		$schedules['fair_e2e_startup_fortnightly'] = array(
			'interval' => 2 * WEEK_IN_SECONDS,
			'display'  => __( 'Every two weeks', 'fair-e2e-startup' ),
		);
		return $schedules;
	}
);

add_action(
	'doing_it_wrong_run',
	static function ( $function_name, $message ) {
		$GLOBALS['fair_e2e_notification_startup']['entry']['diagnostics'][] = array(
			'function'      => $function_name,
			'message'       => wp_strip_all_tags( $message ),
			'notifications' => fair_e2e_notification_startup_from_notifications(),
		);
	},
	10,
	2
);

/**
 * Recurring events each active plugin should keep scheduled, by hook.
 *
 * Feature-gated events are expected exactly while their feature is on, and
 * Payments digests (one per frequency) while Fair Payments Connector runs
 * payment notifications.
 *
 * @return array<string,int>
 */
function fair_e2e_notification_startup_expected_recurring() {
	$expected = array();
	if ( defined( 'FAIR_EVENTS_VERSION' ) ) {
		$expected['fair_events_cleanup_expired_ticket_signups'] = 1;
		$expected['fair_events_notification_history_cleanup']   = 1;
	}
	if ( defined( 'FAIR_AUDIENCE_VERSION' ) ) {
		$expected['fair_audience_cleanup_expired_signups']           = 1;
		$expected['fair_audience_pending_subscription_timeout_tick'] = 1;
	}
	if ( class_exists( '\FairPaymentsConnector\Core\NotificationOwnership' ) ) {
		$expected['fair_payment_prune_payment_log'] = 1;
		if ( \FairPaymentsConnector\Core\NotificationOwnership::is_owner() ) {
			$expected['fair_payment_flush_digest'] = 3;
		}
	}
	if ( defined( 'FAIR_EVENTS_EXPERIMENTAL_VERSION' ) ) {
		$expected['fair_events_experimental_whatsapp_cleanup'] = 1;
		$expected['fair_events_experimental_meta_cleanup']     = \FairEventsExperimental\Core\Features::is_enabled( 'meta-conversions' ) ? 1 : 0;
	}
	if ( defined( 'FAIR_AUDIENCE_EXPERIMENTAL_VERSION' ) ) {
		$messaging = \FairAudienceExperimental\Core\Features::is_enabled( 'messaging' ) ? 1 : 0;
		$instagram = \FairAudienceExperimental\Core\Features::is_enabled( 'instagram' ) ? 1 : 0;

		$expected['fair_audience_send_scheduled_messages']            = $messaging;
		$expected['fair_audience_cleanup_instagram_temp_attachments'] = $instagram;
		$expected['fair_audience_refresh_instagram_token']            = $instagram;
	}
	return $expected;
}

add_action(
	'wp_loaded',
	static function () {
		$notifications = '\FairEvents\Notifications\\';
		$stages        = array(
			'telegram_owned' => class_exists( $notifications . 'Ownership' ) && \FairEvents\Notifications\Ownership::owns( 'telegram' ),
		);
		foreach (
			array(
				'telegram_worker'         => 'fair_events_notification_telegram',
				'bulk_email_worker'       => 'fair_events_notification_bulk_email',
				'individual_email_worker' => 'fair_events_notification_individual_email',
				'cleanup_handler'         => 'fair_events_notification_history_cleanup',
			) as $stage => $hook
		) {
			$stages[ $stage ] = (bool) has_action( $hook );
		}

		$settings                     = get_registered_settings();
		$stages['telegram_setting']   = isset( $settings['fair_events_experimental_weekly_telegram_token'] );
		$stages['telegram_connector'] = function_exists( 'wp_is_connector_registered' )
			? wp_is_connector_registered( 'fair-events-telegram' )
			: null;
		$stages['schedule_label']     = wp_get_schedules()['fair_e2e_startup_fortnightly']['display'] ?? '';

		// Each plugin's recurring events once WordPress finished loading, and
		// how many it should own on this site (#2064).
		$stages['recurring']          = array();
		$stages['expected_recurring'] = array();
		foreach ( fair_e2e_notification_startup_expected_recurring() as $hook => $expected ) {
			$count = 0;
			foreach ( (array) _get_cron_array() as $hooks ) {
				$count += count( $hooks[ $hook ] ?? array() );
			}
			$stages['recurring'][ $hook ]          = $count;
			$stages['expected_recurring'][ $hook ] = $expected;
		}

		$GLOBALS['fair_e2e_notification_startup']['entry']['stages'] = $stages;
	}
);

// After the plugin's own handler, so it reports whether that handler ran.
add_action(
	'fair_events_notification_history_cleanup',
	static function () {
		$GLOBALS['fair_e2e_notification_startup']['entry']['cleanup_ran'] = (bool) has_action(
			'fair_events_notification_history_cleanup',
			array( 'FairEvents\Notifications\Notifications', 'clean_up_history' )
		);
	},
	20
);

add_action(
	'shutdown',
	static function () {
		if ( ! empty( $GLOBALS['fair_e2e_notification_startup_quiet'] ) ) {
			return;
		}
		$log   = get_option( 'fair_e2e_notification_startup_log', array() );
		$log   = is_array( $log ) ? $log : array();
		$log[] = $GLOBALS['fair_e2e_notification_startup']['entry'];
		update_option( 'fair_e2e_notification_startup_log', array_slice( $log, -20 ), false );
	}
);
