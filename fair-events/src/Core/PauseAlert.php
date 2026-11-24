<?php
/**
 * Administrator email when Fair Events is paused (#2445).
 *
 * @package FairEvents
 */

namespace FairEvents\Core;

use FairEvents\Notifications\Lock;
use FairEvents\Services\EmailService;

defined( 'WPINC' ) || die;

/**
 * Emails the site's administration address when Fair Events can't start,
 * once per incident.
 *
 * Two causes pause Fair Events: an outdated copy of the shared library
 * loaded before selection (Fair_Events_Shared_Loader reports a conflict),
 * or an existing site that hasn't finished the payment history migration
 * (PaymentHistoryUpgrade refuses initialization). The bootstrap and
 * Plugin::init() report what this request saw; delivery waits for late
 * `init`, which runs whether or not Fair Events started.
 *
 * State lives in one non-autoloaded option, one incident per cause. A
 * library conflict remembers the request contexts (admin, frontend) that
 * saw it, because another plugin may load its outdated copy in only one of
 * them: an incident closes once a healthy request has been seen in every
 * context that saw the conflict. A migration incident closes on the first
 * request whose decision allows initialization.
 *
 * Each incident gets at most MAX_ATTEMPTS sends: the first right away,
 * the second at least RETRY_DELAYS[1] seconds after the first, the third
 * at least RETRY_DELAYS[2] after the second, each made by the next request
 * that still sees the pause. An attempt is reserved under a non-waiting
 * lock before wp_mail() runs, so concurrent requests can't send twice, and
 * a request that stops mid-send still used its attempt. Nothing here may
 * stop the pause itself: mail failures are caught and only counted.
 *
 * Uses no shared-library class: it runs when those can't load.
 */
class PauseAlert {

	/**
	 * Option holding the open incidents.
	 */
	const OPTION = 'fair_events_pause_alert';

	/**
	 * An outdated shared-library copy loaded first.
	 */
	const CAUSE_LIBRARY = 'library_conflict';

	/**
	 * The payment history migration isn't finished.
	 */
	const CAUSE_MIGRATION = 'migration';

	/**
	 * Request in WordPress admin (including admin-ajax).
	 */
	const CONTEXT_ADMIN = 'admin';

	/**
	 * Any other request: pages, REST, cron.
	 */
	const CONTEXT_FRONTEND = 'frontend';

	/**
	 * Sends per incident, including failed ones.
	 */
	const MAX_ATTEMPTS = 3;

	/**
	 * Seconds after the previous attempt before attempt N+1 (keyed by the
	 * number of attempts already made).
	 */
	const RETRY_DELAYS = array(
		1 => HOUR_IN_SECONDS,
		2 => DAY_IN_SECONDS,
	);

	/**
	 * What this request saw, keyed by cause: paused (bool), context, and
	 * for a pause the diagnosis.
	 *
	 * @var array<string, array>
	 */
	private static $observations = array();

	/**
	 * Whether processing is hooked for this request.
	 *
	 * @var bool
	 */
	private static $scheduled = false;

	/**
	 * Record what the shared-library loader decided for this request.
	 *
	 * A conflict is a pause. A selection this plugin may use is recovery
	 * in this request's context. A pending selection, or a newer copy that
	 * waits for the next request, is neither.
	 *
	 * @param string $plugin_file Fair Events' main file.
	 * @return void
	 */
	public static function observe_library( $plugin_file ) {
		if ( ! class_exists( '\Fair_Events_Shared_Loader', false ) || ! method_exists( '\Fair_Events_Shared_Loader', 'report' ) ) {
			return;
		}

		$report = \Fair_Events_Shared_Loader::report();
		$state  = (string) ( $report['state'] ?? '' );

		if ( 'conflict' === $state ) {
			self::observe_pause( self::CAUSE_LIBRARY, self::library_diagnosis( (array) ( $report['conflicts'] ?? array() ) ) );
			return;
		}

		if ( 'selected' === $state && \Fair_Events_Shared_Loader::is_ready( $plugin_file ) ) {
			self::observe_recovery( self::CAUSE_LIBRARY );
		}
	}

	/**
	 * Record a refused payment-history decision.
	 *
	 * @param string[] $blockers From PaymentHistoryUpgrade::refusal_blockers().
	 * @return void
	 */
	public static function observe_migration_refusal( array $blockers ) {
		$blockers = array_values( array_intersect( array_map( 'strval', $blockers ), array_keys( \FairEvents\Services\PaymentHistoryUpgrade::refusal_labels() ) ) );
		self::observe_pause( self::CAUSE_MIGRATION, array( 'blockers' => $blockers ) );
	}

	/**
	 * Record a payment-history decision that allows initialization.
	 *
	 * @return void
	 */
	public static function observe_migration_allowed() {
		self::observe_recovery( self::CAUSE_MIGRATION );
	}

	/**
	 * Record a pause seen by this request.
	 *
	 * @param string      $cause     CAUSE_* constant.
	 * @param array       $diagnosis Facts the email shows; no paths or personal data.
	 * @param string|null $context   CONTEXT_* constant; this request's when null.
	 * @return void
	 */
	public static function observe_pause( $cause, array $diagnosis, $context = null ) {
		self::$observations[ $cause ] = array(
			'paused'    => true,
			'context'   => null === $context ? self::request_context() : $context,
			'diagnosis' => $diagnosis,
		);
		self::schedule();
	}

	/**
	 * Record that this request saw no pause of $cause.
	 *
	 * @param string      $cause   CAUSE_* constant.
	 * @param string|null $context CONTEXT_* constant; this request's when null.
	 * @return void
	 */
	public static function observe_recovery( $cause, $context = null ) {
		self::$observations[ $cause ] = array(
			'paused'  => false,
			'context' => null === $context ? self::request_context() : $context,
		);
		self::schedule();
	}

	/**
	 * Update the incidents from this request's observations and send any
	 * alert that is due. Hooked on late `init`.
	 *
	 * @param int|null $now Unix time; the current time when null.
	 * @return void
	 */
	public static function process( $now = null ) {
		$observations       = self::$observations;
		self::$observations = array();
		if ( empty( $observations ) ) {
			return;
		}
		$now = null === $now ? time() : (int) $now;

		// Most requests change nothing: skip the lock when the cached state
		// already reflects what this request saw.
		if ( ! self::needs_update( self::read_state( false ), $observations, $now ) ) {
			return;
		}

		if ( ! Lock::acquire( Lock::PAUSE_ALERT, 0 ) ) {
			return;
		}

		try {
			$state = self::read_state( true );
			$due   = array();
			foreach ( $observations as $cause => $observation ) {
				if ( empty( $observation['paused'] ) ) {
					$state = self::apply_recovery( $state, $cause, $observation['context'] );
					continue;
				}
				$state = self::apply_pause( $state, $cause, $observation, $now );
				if ( self::attempt_due( $state[ $cause ], $now ) ) {
					$state[ $cause ]['attempts']        = (int) $state[ $cause ]['attempts'] + 1;
					$state[ $cause ]['last_attempt_at'] = $now;
					$due[]                              = $cause;
				}
			}

			// The reservation must be stored before mailing; if it can't
			// be, nothing is sent on this request.
			if ( ! self::write_state( $state ) ) {
				return;
			}

			foreach ( $due as $cause ) {
				$state[ $cause ]['sent'] = self::send( $cause, $state[ $cause ]['diagnosis'] );
				self::write_state( $state );
			}
		} finally {
			Lock::release( Lock::PAUSE_ALERT );
		}
	}

	/**
	 * The stored incidents.
	 *
	 * @param bool $fresh Bypass the options cache, to read under the lock.
	 * @return array<string, array>
	 */
	public static function read_state( $fresh ) {
		if ( $fresh ) {
			wp_cache_delete( self::OPTION, 'options' );
			wp_cache_delete( 'notoptions', 'options' );
		}
		$state = get_option( self::OPTION, array() );
		return is_array( $state ) ? $state : array();
	}

	/**
	 * Forget this request's observations, e.g. in tests.
	 *
	 * @return void
	 */
	public static function reset() {
		self::$observations = array();
		self::$scheduled    = false;
	}

	/**
	 * Whether the observations would change the stored state or send.
	 *
	 * @param array $state        Stored incidents.
	 * @param array $observations This request's observations.
	 * @param int   $now          Unix time.
	 * @return bool
	 */
	private static function needs_update( array $state, array $observations, $now ) {
		foreach ( $observations as $cause => $observation ) {
			if ( empty( $observation['paused'] ) ) {
				$recovered = self::apply_recovery( $state, $cause, $observation['context'] );
				if ( $recovered !== $state ) {
					return true;
				}
				continue;
			}
			$updated = self::apply_pause( $state, $cause, $observation, $now );
			if ( $updated !== $state || self::attempt_due( $updated[ $cause ], $now ) ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Open or update the incident for an observed pause.
	 *
	 * @param array  $state       Incidents.
	 * @param string $cause       CAUSE_* constant.
	 * @param array  $observation Pause observation.
	 * @param int    $now         Unix time.
	 * @return array Incidents.
	 */
	private static function apply_pause( array $state, $cause, array $observation, $now ) {
		$incident = isset( $state[ $cause ] ) && is_array( $state[ $cause ] ) ? $state[ $cause ] : array(
			'opened_at'       => $now,
			'attempts'        => 0,
			'last_attempt_at' => 0,
			'sent'            => false,
			'contexts'        => array(),
		);

		$incident['diagnosis']                           = $observation['diagnosis'];
		$incident['contexts'][ $observation['context'] ] = true;
		ksort( $incident['contexts'] );

		$state[ $cause ] = $incident;
		return $state;
	}

	/**
	 * Close or narrow the incident for an observed recovery.
	 *
	 * @param array  $state   Incidents.
	 * @param string $cause   CAUSE_* constant.
	 * @param string $context CONTEXT_* constant.
	 * @return array Incidents.
	 */
	private static function apply_recovery( array $state, $cause, $context ) {
		if ( ! isset( $state[ $cause ] ) ) {
			return $state;
		}

		if ( self::CAUSE_LIBRARY !== $cause ) {
			unset( $state[ $cause ] );
			return $state;
		}

		// Healthy here says nothing about a context that saw the conflict.
		unset( $state[ $cause ]['contexts'][ $context ] );
		if ( empty( $state[ $cause ]['contexts'] ) ) {
			unset( $state[ $cause ] );
		}
		return $state;
	}

	/**
	 * Whether the incident's next attempt may run now.
	 *
	 * @param array $incident Incident.
	 * @param int   $now      Unix time.
	 * @return bool
	 */
	private static function attempt_due( array $incident, $now ) {
		$attempts = (int) ( $incident['attempts'] ?? 0 );
		if ( ! empty( $incident['sent'] ) || $attempts >= self::MAX_ATTEMPTS ) {
			return false;
		}
		if ( 0 === $attempts ) {
			return true;
		}
		$delay = self::RETRY_DELAYS[ $attempts ] ?? DAY_IN_SECONDS;
		return $now - (int) ( $incident['last_attempt_at'] ?? 0 ) >= $delay;
	}

	/**
	 * Store the incidents, or remove the option when none is open.
	 *
	 * @param array $state Incidents.
	 * @return bool Whether the stored value now equals $state.
	 */
	private static function write_state( array $state ) {
		if ( empty( $state ) ) {
			delete_option( self::OPTION );
			return true;
		}
		if ( self::read_state( false ) === $state ) {
			return true;
		}
		update_option( self::OPTION, $state, false );
		return self::read_state( true ) === $state;
	}

	/**
	 * Send the alert for one incident.
	 *
	 * @param string $cause     CAUSE_* constant.
	 * @param array  $diagnosis Incident diagnosis.
	 * @return bool Whether the local mail stack accepted it.
	 */
	private static function send( $cause, array $diagnosis ) {
		$to = (string) get_option( 'admin_email', '' );
		if ( '' === $to || ! is_email( $to ) ) {
			return false;
		}

		$switched = function_exists( 'switch_to_locale' ) && function_exists( 'get_locale' ) && switch_to_locale( get_locale() );
		try {
			$message = PauseAlertMessage::compose( $cause, $diagnosis );
			return ( new EmailService() )->send_plain_text( $to, $message['subject'], $message['body'] );
		} catch ( \Throwable $e ) {
			// A broken mail transport must not break the pause or its notice.
			return false;
		} finally {
			if ( $switched ) {
				restore_previous_locale();
			}
		}
	}

	/**
	 * Name the plugins whose outdated copy loaded first, from installed
	 * plugin metadata. Paths stay out of the stored diagnosis.
	 *
	 * @param array<string, string> $conflicts Symbol => file, from the loader report.
	 * @return array responsible (plugin names), unknown (bool: a copy
	 *               outside any installed plugin loaded too).
	 */
	private static function library_diagnosis( array $conflicts ) {
		$plugins = array();
		if ( defined( 'WP_PLUGIN_DIR' ) ) {
			if ( ! function_exists( 'get_plugins' ) && defined( 'ABSPATH' ) ) {
				require_once ABSPATH . 'wp-admin/includes/plugin.php';
			}
			if ( function_exists( 'get_plugins' ) ) {
				$plugins = get_plugins();
			}
		}

		$root        = rtrim( wp_normalize_path( defined( 'WP_PLUGIN_DIR' ) ? WP_PLUGIN_DIR : '' ), '/' ) . '/';
		$responsible = array();
		$unknown     = empty( $conflicts );
		foreach ( $conflicts as $file ) {
			$file  = wp_normalize_path( (string) $file );
			$found = false;
			foreach ( $plugins as $basename => $data ) {
				if ( false === strpos( $basename, '/' ) ) {
					continue;
				}
				if ( 0 === strpos( $file, $root . dirname( $basename ) . '/' ) ) {
					$responsible[ $basename ] = (string) ( $data['Name'] ?? dirname( $basename ) );
					$found                    = true;
					break;
				}
			}
			$unknown = $unknown || ! $found;
		}

		$names = array_values( array_unique( $responsible ) );
		sort( $names );
		return array(
			'responsible' => $names,
			'unknown'     => $unknown,
		);
	}

	/**
	 * This request's context.
	 *
	 * @return string CONTEXT_* constant.
	 */
	private static function request_context() {
		return is_admin() ? self::CONTEXT_ADMIN : self::CONTEXT_FRONTEND;
	}

	/**
	 * Process once this request's mail stack and translations are up: on
	 * late `init`, or at shutdown when `init` already ran (activation).
	 *
	 * @return void
	 */
	private static function schedule() {
		if ( self::$scheduled ) {
			return;
		}
		self::$scheduled = true;

		$process = static function () {
			self::process();
		};
		if ( did_action( 'init' ) && ! doing_action( 'init' ) ) {
			add_action( 'shutdown', $process );
			return;
		}
		add_action( 'init', $process, PHP_INT_MAX );
	}
}
