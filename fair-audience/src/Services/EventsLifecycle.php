<?php
/**
 * Fair Audience's side of the Fair Events purchase lifecycle
 *
 * @package FairAudience
 */

namespace FairAudience\Services;

use WP_Error;

defined( 'WPINC' ) || die;

/**
 * Runs Fair Audience's purchase route, activity add-ons and series upgrades
 * through Fair Events' purchase lifecycle (PAYMENT_HISTORY_MIGRATION.md
 * §8.12), which owns purchases and their payment history:
 *
 * - Every attempt is recorded in Fair Events (its purchase and payment
 *   links) before the buyer is sent to pay. When that fails the buyer gets a
 *   503 and nothing is charged.
 * - Paid notifications of these routes are applied by Fair Events, which
 *   then fires `fair_events_purchase_payment_applied`; Fair Audience
 *   projects that onto its relationships, activities and ledger
 *   (PaymentHooks::project_payment_applied()) instead of confirming them
 *   itself.
 * - A series upgrade is priced from the purchase's own paid allocations.
 *
 * When Fair Events is inactive or lacks the lifecycle, these operations are
 * refused with an error the buyer can read (#2251): Fair Audience no longer
 * keeps purchase accounting of its own. Its other features don't depend on
 * this. Fair Events checks supports_purchase_lifecycle() before leaving
 * these routes' paid notifications to this plugin's projection.
 */
class EventsLifecycle {

	/**
	 * Capability marker read by Fair Events
	 * (PaymentHistoryCompatibility::audience_lifecycle_available()): this
	 * Fair Audience records its attempts in the lifecycle and projects what
	 * Fair Events commits.
	 *
	 * @return bool
	 */
	public static function supports_purchase_lifecycle() {
		return true;
	}

	/**
	 * Whether Fair Events applies payments of Fair Audience's routes: it is
	 * active and has the purchase lifecycle.
	 *
	 * @return bool
	 */
	public static function active() {
		$lifecycle = 'FairEvents\\Services\\PurchaseLifecycle';
		return class_exists( $lifecycle )
			&& method_exists( $lifecycle, 'handles_audience_sources' )
			&& true === $lifecycle::handles_audience_sources();
	}

	/**
	 * Record an attempt in Fair Events before the buyer pays. Repeating it
	 * is a no-op.
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return true|WP_Error True when recorded; an error the buyer can retry otherwise.
	 */
	public static function record_attempt( $transaction_id ) {
		if ( ! self::active() ) {
			return self::unavailable_error();
		}

		$recorded = \FairEvents\Services\PurchaseLifecycle::record_attempt( (int) $transaction_id );
		if ( ! is_wp_error( $recorded ) ) {
			return true;
		}

		return new WP_Error(
			'payment_not_recorded',
			__( 'Your purchase could not be recorded right now. Please try again in a moment.', 'fair-audience' ),
			array(
				'status' => 503,
				'reason' => $recorded->get_error_code(),
			)
		);
	}

	/**
	 * Give a free registration its Fair Events purchase now, so it takes
	 * its places at once. Best effort: when it can't be recorded, Fair
	 * Events' shadow writer catches up on its next sweep.
	 *
	 * @param int $event_participant_id Registration just signed up.
	 * @return void
	 */
	public static function record_signup( $event_participant_id ) {
		$lifecycle = 'FairEvents\\Services\\PurchaseLifecycle';
		if ( (int) $event_participant_id <= 0 || ! self::active() || ! method_exists( $lifecycle, 'record_relationship' ) ) {
			return;
		}
		$lifecycle::record_relationship( (int) $event_participant_id );
	}

	/**
	 * What the purchase behind a registration has paid, for a series
	 * upgrade's price, in the site currency.
	 *
	 * @param int    $event_participant_id Registration being upgraded.
	 * @param string $currency             Site currency.
	 * @return float|WP_Error What it paid; an error when it can't be told.
	 */
	public static function upgrade_credit( $event_participant_id, $currency ) {
		if ( ! self::active() ) {
			return self::unavailable_error();
		}

		$credit = \FairEvents\Services\PurchaseLifecycle::upgrade_credit( (int) $event_participant_id, (string) $currency );
		if ( is_wp_error( $credit ) ) {
			return self::upgrade_error( $credit );
		}
		return (float) $credit['paid'];
	}

	/**
	 * Give the purchase behind a registration the whole-series ticket type
	 * when nothing is left to pay.
	 *
	 * @param int $event_participant_id Registration being upgraded.
	 * @param int $ticket_type_id       Whole-series ticket type.
	 * @return true|WP_Error
	 */
	public static function upgrade_without_payment( $event_participant_id, $ticket_type_id ) {
		if ( ! self::active() ) {
			return self::unavailable_error();
		}

		$upgraded = \FairEvents\Services\PurchaseLifecycle::upgrade_without_payment( (int) $event_participant_id, (int) $ticket_type_id );
		return is_wp_error( $upgraded ) ? self::upgrade_error( $upgraded ) : true;
	}

	/**
	 * Whether a failed add-on attempt was superseded by a newer one for the
	 * same activities, whose holds it must leave alone.
	 *
	 * @param object $transaction Failed add-on transaction.
	 * @return bool
	 */
	public static function addon_attempt_superseded( $transaction ) {
		return self::active() && \FairEvents\Services\PurchaseLifecycle::addon_attempt_superseded( $transaction );
	}

	/**
	 * A buyer-facing error for a purchase operation while Fair Events can't
	 * account for it (inactive, or without the lifecycle).
	 *
	 * @return WP_Error
	 */
	private static function unavailable_error() {
		return new WP_Error(
			'payment_not_recorded',
			__( 'Your purchase could not be recorded right now. Please try again in a moment.', 'fair-audience' ),
			array(
				'status' => 503,
				'reason' => 'events_lifecycle_unavailable',
			)
		);
	}

	/**
	 * A buyer-facing error for an upgrade the lifecycle can't price or
	 * apply.
	 *
	 * @param WP_Error $error Lifecycle error.
	 * @return WP_Error
	 */
	private static function upgrade_error( WP_Error $error ) {
		if ( 'upgrade_purchase_ambiguous' === $error->get_error_code() ) {
			return new WP_Error(
				'upgrade_unavailable',
				__( 'This registration can’t be upgraded online. Please contact the organizer.', 'fair-audience' ),
				array( 'status' => 409 )
			);
		}

		return new WP_Error(
			'payment_not_recorded',
			__( 'Your purchase could not be recorded right now. Please try again in a moment.', 'fair-audience' ),
			array(
				'status' => 503,
				'reason' => $error->get_error_code(),
			)
		);
	}
}
