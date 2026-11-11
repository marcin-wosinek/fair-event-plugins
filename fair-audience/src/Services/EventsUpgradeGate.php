<?php
/**
 * Fair Events' upgrade check, as Fair Audience follows it
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

defined( 'WPINC' ) || die;

/**
 * Whether Fair Audience may initialize on this site
 * (PAYMENT_HISTORY_MIGRATION.md §8.17). This version no longer confirms its
 * own purchases or counts its relationships as admissions, so on a site
 * that never finished the payment history migration it would change what
 * the intermediate release still counts. Fair Events decides, through
 * `FairEvents\Services\PaymentHistoryUpgrade::allows_initialization()`;
 * Fair Audience follows it, so updating Audience alone can't bypass it.
 *
 * - Fair Events inactive: allowed. Audience's purchase routes refuse
 *   without Fair Events (503 `payment_not_recorded`), and Fair Events
 *   checks again when it is activated.
 * - Fair Events active without the check (older than this release):
 *   refused until Fair Events is updated first, as the update order
 *   requires (Connector, Events, Audience).
 * - Otherwise: Fair Events' decision.
 */
class EventsUpgradeGate {

	/**
	 * Fair Events' check.
	 */
	const EVENTS_GATE = 'FairEvents\\Services\\PaymentHistoryUpgrade';

	/**
	 * Refused: Fair Events is older than the check.
	 */
	const REASON_EVENTS_OUTDATED = 'events_outdated';

	/**
	 * Refused: Fair Events refused this site.
	 */
	const REASON_UPGRADE_UNSUPPORTED = 'upgrade_unsupported';

	/**
	 * The decision for this request, once made.
	 *
	 * @var bool|null
	 */
	private static $allowed = null;

	/**
	 * Why the decision refused, if it did.
	 *
	 * @var string|null
	 */
	private static $reason = null;

	/**
	 * Whether Fair Audience may initialize and upgrade its tables.
	 *
	 * @return bool
	 */
	public static function allows_initialization() {
		if ( null !== self::$allowed ) {
			return self::$allowed;
		}

		self::$reason = null;
		if ( ! defined( 'FAIR_EVENTS_VERSION' ) ) {
			self::$allowed = true;
		} elseif ( ! class_exists( self::EVENTS_GATE ) || ! method_exists( self::EVENTS_GATE, 'allows_initialization' ) ) {
			self::$reason  = self::REASON_EVENTS_OUTDATED;
			self::$allowed = false;
		} else {
			$gate          = self::EVENTS_GATE;
			self::$allowed = true === $gate::allows_initialization();
			if ( ! self::$allowed ) {
				self::$reason = self::REASON_UPGRADE_UNSUPPORTED;
			}
		}
		return self::$allowed;
	}

	/**
	 * Why initialization was refused, or null.
	 *
	 * @return string|null
	 */
	public static function refusal_reason() {
		return self::$reason;
	}

	/**
	 * Start nothing but the administrator notice explaining the refusal.
	 *
	 * @return void
	 */
	public static function refuse_initialization() {
		add_action( 'admin_notices', array( static::class, 'render_refusal_notice' ) );
	}

	/**
	 * Explain to administrators why Fair Audience didn't start.
	 *
	 * @return void
	 */
	public static function render_refusal_notice() {
		if ( ! current_user_can( 'manage_options' ) ) {
			return;
		}

		echo '<div class="notice notice-error"><p><strong>';
		echo esc_html__( 'Fair Audience is paused until Fair Events can run on this site.', 'fair-audience' );
		echo '</strong></p><p>';
		if ( self::REASON_EVENTS_OUTDATED === self::$reason ) {
			echo esc_html__( 'This version of Fair Audience needs a newer Fair Events. Update Fair Payments Connector, then Fair Events, then Fair Audience. Nothing on this site was changed.', 'fair-audience' );
		} else {
			echo esc_html__( 'This site hasn’t finished the payment history migration. Follow the steps in the Fair Events notice. Nothing on this site was changed.', 'fair-audience' );
		}
		echo '</p></div>';
	}

	/**
	 * Forget this request's decision, e.g. in tests.
	 *
	 * @return void
	 */
	public static function reset() {
		self::$allowed = null;
		self::$reason  = null;
	}
}
