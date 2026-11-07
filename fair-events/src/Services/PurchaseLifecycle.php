<?php
/**
 * Purchase and payment lifecycle after the payment history cutover
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\EventSignup;
use FairEvents\Models\EventTicket;
use FairEvents\Models\EventTicketActivity;
use FairEvents\Models\PaymentHistoryFinding;
use FairEvents\Models\PaymentShadowWork;
use FairEvents\Models\SignupPaymentLink;

defined( 'WPINC' ) || die;

/**
 * The Events-owned purchase lifecycle once payment links are authoritative
 * (PAYMENT_HISTORY_MIGRATION.md §8.1 stage 4, §8.11):
 *
 * - Every attempt's links are written synchronously, before the buyer is
 *   sent to pay (record_attempt()). Connector keeps the total, currency and
 *   status; the links say which purchases the attempt pays for.
 * - A paid notification resolves its purchases from those links, so a late
 *   payment for a superseded attempt is honoured like any other, and every
 *   paid attempt counts. More than one paid attempt for a purchase is
 *   reported as `multiple_paid_attempts` (§5.5).
 * - A failed notification only fails purchases whose latest attempt it is,
 *   and only while they await payment: it never undoes a confirmation or
 *   interferes with a newer attempt.
 * - Confirmations are announced (`fair_events_signup_confirmed`) after they
 *   commit, exactly once per transition, with a queued row that lets the
 *   retry cron finish an interrupted request.
 *
 * This first part covers the get-tickets flows. Fair Audience's routes keep
 * their previous behaviour, which stage 4's activation refuses to run
 * against (#2140).
 *
 * Before the cutover nothing here runs; the callers keep their previous
 * paths and the shadow writer records links after the fact.
 */
class PurchaseLifecycle {

	/**
	 * Seconds the request confirming a purchase has to announce it before
	 * the retry cron does.
	 */
	const ANNOUNCE_GRACE = 300;

	/**
	 * Whether the lifecycle is authoritative on this site.
	 *
	 * @return bool
	 */
	public static function active() {
		return PaymentHistoryCompatibility::ownership_cutover();
	}

	/**
	 * Write an attempt's links: the purchases its evidence names, with the
	 * allocation each gets (PaymentAttribution, §8.8). Repeating it is a
	 * no-op, so a checkout continued after an interruption can call it
	 * again. On success the shadow writer's queued work for the transaction
	 * is done too.
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return array|\WP_Error PaymentLinks::write() outcome, or why nothing was written.
	 */
	public static function record_attempt( $transaction_id ) {
		$transaction_id = (int) $transaction_id;
		$transaction    = PaymentAttributionDatabase::transaction( $transaction_id );
		if ( ! $transaction ) {
			return PaymentHistoryCompatibility::payment_information_available()
				? new \WP_Error( 'missing_transaction', 'The transaction does not exist in Fair Payments Connector.', array( 'transaction_id' => $transaction_id ) )
				: new \WP_Error( 'payment_information_unavailable', 'Payment information can\'t be read because Fair Payments Connector is inactive or not installed.', array( 'transaction_id' => $transaction_id ) );
		}

		$result = ( new PaymentAttribution( new PaymentAttributionDatabase() ) )->attribute( $transaction );
		if ( 'attributed' !== $result['outcome'] ) {
			return new \WP_Error(
				'payment_attempt_unattributed',
				'The payment\'s evidence names no purchase it can be linked to.',
				array(
					'transaction_id' => $transaction_id,
					'reason'         => $result['reason'],
					'detail'         => $result['detail'],
				)
			);
		}

		$links = array_map(
			static function ( $link ) {
				return $link + array( 'attribution' => SignupPaymentLink::ATTRIBUTION_LIVE );
			},
			$result['links']
		);

		$written = PaymentLinks::write( $transaction_id, $links );
		if ( ! is_wp_error( $written ) ) {
			PaymentShadowWork::complete( PaymentShadowWork::KIND_TRANSACTION, $transaction_id );
		}
		return $written;
	}

	/**
	 * Purchases a transaction is linked to.
	 *
	 * @param int      $transaction_id Connector transaction ID.
	 * @param string[] $roles          Link roles to include.
	 * @return int[] Signup IDs, ascending.
	 */
	public static function linked_signup_ids( $transaction_id, array $roles = array( SignupPaymentLink::ROLE_CHARGE ) ) {
		$ids = array();
		foreach ( SignupPaymentLink::get_by_transaction_id( (int) $transaction_id ) as $link ) {
			if ( in_array( (string) $link['role'], $roles, true ) ) {
				$ids[] = (int) $link['signup_id'];
			}
		}
		$ids = array_values( array_unique( $ids ) );
		sort( $ids );
		return $ids;
	}

	/**
	 * Purchases whose latest attempt is this transaction: the set a retry
	 * repeats, a cancellation releases and a failure fails. Before the
	 * cutover, and for an attempt with no links (one the backfill left
	 * unresolved), the purchases are resolved from the transaction's
	 * metadata as before.
	 *
	 * @param object $transaction Connector transaction.
	 * @return int[] Signup IDs.
	 */
	public static function current_signup_ids( $transaction ) {
		$linked = self::active() ? self::linked_signup_ids( (int) $transaction->id ) : array();
		if ( ! $linked ) {
			return EventSignup::resolve_signup_ids_from_transaction( $transaction );
		}

		return array_values(
			array_filter(
				$linked,
				static function ( $signup_id ) use ( $transaction ) {
					$signup = EventSignup::get_by_id( $signup_id );
					return $signup && (int) $signup->transaction_id === (int) $transaction->id;
				}
			)
		);
	}

	/**
	 * Apply a paid notification: confirm every purchase the attempt is
	 * linked to, whichever attempt is the purchase's latest. A purchase
	 * already confirmed stays as it is, so a replayed or concurrent
	 * notification confirms and announces nothing twice.
	 *
	 * When the attempt has no links yet they are written first. When that
	 * fails, the notification is queued and applied again by the retry
	 * cron.
	 *
	 * @param object $transaction Connector transaction (status paid).
	 * @return array{resolved: bool, confirmed: int[]} Whether purchases were found, and those that transitioned.
	 */
	public static function handle_paid( $transaction ) {
		$transaction_id = (int) $transaction->id;
		$outcome        = array(
			'resolved'  => false,
			'confirmed' => array(),
		);
		if ( ! self::is_get_tickets( $transaction ) ) {
			return $outcome;
		}

		$signup_ids = self::linked_signup_ids( $transaction_id );
		if ( ! $signup_ids ) {
			$recorded = self::record_attempt( $transaction_id );
			if ( is_wp_error( $recorded ) ) {
				$status = 'payment_attempt_unattributed' === $recorded->get_error_code() ? PaymentShadowWork::STATUS_UNRESOLVED : PaymentShadowWork::STATUS_FAILED;
				PaymentShadowWork::defer( PaymentShadowWork::KIND_PAYMENT, $transaction_id, $status, $recorded->get_error_code(), array( 'message' => $recorded->get_error_message() ) );
				return $outcome;
			}
			$signup_ids = self::linked_signup_ids( $transaction_id );
		}

		$outcome['resolved'] = true;
		foreach ( $signup_ids as $signup_id ) {
			if ( self::confirm_and_announce( $signup_id, $transaction ) ) {
				$outcome['confirmed'][] = $signup_id;
			}
		}

		self::report_multiple_paid_attempts( $signup_ids );
		PaymentShadowWork::complete( PaymentShadowWork::KIND_PAYMENT, $transaction_id );

		return $outcome;
	}

	/**
	 * Apply a failed, cancelled or expired notification: fail the purchases
	 * whose latest attempt it is while they still await payment. A delayed
	 * failure of an older attempt, or of one that was paid since, changes
	 * nothing.
	 *
	 * @param object $transaction Connector transaction.
	 * @return int[] Signup IDs that transitioned to failed.
	 */
	public static function handle_failed( $transaction ) {
		if ( ! self::is_get_tickets( $transaction ) ) {
			return array();
		}

		$failed = array();
		foreach ( self::current_signup_ids( $transaction ) as $signup_id ) {
			if ( EventSignup::fail_pending( $signup_id ) ) {
				$failed[] = $signup_id;
			}
		}
		PaymentShadowWork::complete( PaymentShadowWork::KIND_PAYMENT, (int) $transaction->id );
		return $failed;
	}

	/**
	 * Confirm a paid purchase. The payment is always honored. A purchase
	 * whose hold had already lapsed no longer held its places, nor the places
	 * of its tickets' activities, so they are rechecked under the capacity
	 * lock; when they have been taken in the meantime the purchase is
	 * flagged over capacity for the organizer, and so is each activity that
	 * went past its limit.
	 *
	 * @param int $signup_id Signup row ID.
	 * @return bool True when the purchase transitioned to confirmed.
	 */
	public static function confirm_paid_signup( $signup_id ) {
		$signup = EventSignup::get_by_id( (int) $signup_id );
		if ( ! $signup ) {
			return false;
		}

		if ( TicketCapacity::signup_holds_places( $signup ) ) {
			return EventSignup::confirm_paid( (int) $signup_id );
		}

		// Each ticket asks for its place where it now is: one moved on its
		// own on its new date, and one cancelled on its own nowhere.
		$demands = TicketCapacity::demands_for_signup( $signup );

		return TicketCapacity::with_capacity_lock(
			$demands,
			static function ( $shortage ) use ( $signup_id, $demands ) {
				$shortages = $shortage
					? TicketCapacity::find_shortages( TicketCapacity::places_needed( $demands ) )
					: array();

				if ( ! EventSignup::confirm_paid( (int) $signup_id ) ) {
					return false;
				}
				if ( $shortage ) {
					EventSignup::mark_over_capacity( (int) $signup_id );
				}

				$full_option_ids = array();
				foreach ( $shortages as $found ) {
					if ( 'ticket_option' === $found['scope'] ) {
						$full_option_ids[] = (int) $found['id'];
					}
				}
				if ( $full_option_ids ) {
					foreach ( EventTicket::get_by_signup_id( (int) $signup_id ) as $ticket ) {
						EventTicketActivity::mark_over_capacity( (int) $ticket->id, $full_option_ids );
					}
				}

				return true;
			}
		);
	}

	/**
	 * Announce a confirmed purchase to the other plugins (participant link,
	 * confirmation email).
	 *
	 * @param object $signup      The fair_events_signups row (status confirmed).
	 * @param object $transaction Connector transaction that paid for it.
	 * @return void
	 */
	public static function announce_confirmed( $signup, $transaction ) {
		/**
		 * Fires when a base-route signup's payment is confirmed.
		 *
		 * @param object $signup      The fair_events_signups row (status already 'confirmed').
		 * @param object $transaction Transaction object from fair-payments-connector.
		 */
		do_action( 'fair_events_signup_confirmed', $signup, $transaction );
	}

	/**
	 * Do one piece of queued lifecycle work, for the retry cron.
	 *
	 * @param string $kind      PaymentShadowWork::KIND_PAYMENT or KIND_CONFIRMATION.
	 * @param int    $source_id Transaction or signup ID.
	 * @return string Outcome: done, failed or unresolved.
	 */
	public static function process_work( $kind, $source_id ) {
		$source_id = (int) $source_id;
		if ( PaymentShadowWork::KIND_CONFIRMATION === $kind ) {
			return self::finish_confirmation( $source_id );
		}

		$transaction = self::connector_transaction( $source_id );
		if ( ! $transaction ) {
			$code = PaymentHistoryCompatibility::payment_information_available() ? 'missing_transaction' : 'payment_information_unavailable';
			PaymentShadowWork::defer( $kind, $source_id, 'missing_transaction' === $code ? PaymentShadowWork::STATUS_UNRESOLVED : PaymentShadowWork::STATUS_FAILED, $code );
			return 'missing_transaction' === $code ? 'unresolved' : 'failed';
		}

		if ( ! self::is_get_tickets( $transaction ) ) {
			PaymentShadowWork::complete( $kind, $source_id );
			return 'done';
		}

		if ( 'paid' === (string) $transaction->status ) {
			return self::handle_paid( $transaction )['resolved'] ? 'done' : 'failed';
		}
		if ( in_array( (string) $transaction->status, array( 'failed', 'canceled', 'expired' ), true ) ) {
			foreach ( self::handle_failed( $transaction ) as $signup_id ) {
				self::announce_failed( $signup_id, $transaction );
			}
			return 'done';
		}

		// Neither paid nor over: nothing to apply until Connector reports.
		PaymentShadowWork::complete( $kind, $source_id );
		return 'done';
	}

	/**
	 * Announce a purchase whose payment failed.
	 *
	 * @param int    $signup_id   Signup row ID.
	 * @param object $transaction Connector transaction.
	 * @return void
	 */
	public static function announce_failed( $signup_id, $transaction ) {
		$signup = EventSignup::get_by_id( (int) $signup_id );
		if ( $signup ) {
			/**
			 * Fires when a base-route signup's payment fails/cancels/expires.
			 *
			 * @param object $signup      The fair_events_signups row (status already 'failed').
			 * @param object $transaction Transaction object from fair-payments-connector.
			 */
			do_action( 'fair_events_signup_payment_failed', $signup, $transaction );
		}
	}

	/**
	 * Confirm one purchase and announce it once it committed. Only the
	 * request whose transition succeeded queues the confirmation row, right
	 * after it, and removes it once the hook ran: a request interrupted
	 * while announcing (the participant link, the confirmation email) is
	 * finished by the retry cron, and a concurrent or replayed notification
	 * that found the purchase confirmed already neither announces nor
	 * touches the row.
	 *
	 * @param int    $signup_id   Signup row ID.
	 * @param object $transaction Connector transaction.
	 * @return bool True when this call confirmed the purchase.
	 */
	private static function confirm_and_announce( $signup_id, $transaction ) {
		if ( ! self::confirm_paid_signup( $signup_id ) ) {
			return false;
		}

		PaymentShadowWork::enqueue_later(
			PaymentShadowWork::KIND_CONFIRMATION,
			$signup_id,
			self::ANNOUNCE_GRACE,
			array( 'transaction_id' => (int) $transaction->id )
		);

		$signup = EventSignup::get_by_id( $signup_id );
		if ( $signup ) {
			self::announce_confirmed( $signup, $transaction );
		}
		PaymentShadowWork::complete( PaymentShadowWork::KIND_CONFIRMATION, $signup_id );
		return true;
	}

	/**
	 * Announce a confirmation whose request stopped before it could. A
	 * purchase that is no longer confirmed (an organizer cancelled it since)
	 * isn't announced.
	 *
	 * @param int $signup_id Signup row ID.
	 * @return string Outcome.
	 */
	private static function finish_confirmation( $signup_id ) {
		$kind   = PaymentShadowWork::KIND_CONFIRMATION;
		$row    = PaymentShadowWork::get( $kind, $signup_id );
		$detail = $row ? json_decode( (string) ( $row['detail'] ?? '' ), true ) : array();
		$signup = EventSignup::get_by_id( $signup_id );
		if ( ! $signup || 'confirmed' !== $signup->status ) {
			PaymentShadowWork::complete( $kind, $signup_id );
			return 'done';
		}

		$transaction = self::connector_transaction( (int) ( is_array( $detail ) ? ( $detail['transaction_id'] ?? 0 ) : 0 ) );
		if ( ! $transaction ) {
			if ( ! PaymentHistoryCompatibility::payment_information_available() ) {
				PaymentShadowWork::defer( $kind, $signup_id, PaymentShadowWork::STATUS_FAILED, 'payment_information_unavailable' );
				return 'failed';
			}
			PaymentShadowWork::complete( $kind, $signup_id );
			return 'done';
		}

		self::announce_confirmed( $signup, $transaction );
		PaymentShadowWork::complete( $kind, $signup_id );
		return 'done';
	}

	/**
	 * Report purchases with more than one paid attempt for the same role
	 * (§5.5): each is money received and counts, and the organizer decides
	 * what to do. Recorded as the backfill's informational finding, the
	 * same one its verification records.
	 *
	 * @param int[] $signup_ids Signup IDs.
	 * @return void
	 */
	private static function report_multiple_paid_attempts( array $signup_ids ) {
		if ( ! PaymentHistoryCompatibility::reconciliation_available() ) {
			return;
		}

		foreach ( $signup_ids as $signup_id ) {
			$paid = array();
			foreach ( SignupPaymentLink::get_by_signup_id( $signup_id ) as $link ) {
				if ( ! in_array( (string) $link['role'], array( SignupPaymentLink::ROLE_CHARGE, SignupPaymentLink::ROLE_UPGRADE ), true ) ) {
					continue;
				}
				$transaction = self::connector_transaction( (int) $link['transaction_id'] );
				if ( $transaction && 'paid' === (string) $transaction->status ) {
					$paid[ (string) $link['role'] ][] = (int) $link['transaction_id'];
				}
			}

			foreach ( $paid as $role => $transaction_ids ) {
				if ( count( $transaction_ids ) < 2 ) {
					continue;
				}
				sort( $transaction_ids );
				$signup = EventSignup::get_by_id( $signup_id );
				PaymentHistoryFinding::record(
					PaymentHistoryFinding::MODE_BACKFILL,
					'multiple_paid_attempts',
					PaymentHistoryFinding::SOURCE_SIGNUP,
					$signup_id,
					$signup ? (int) $signup->event_date_id : null,
					array(
						'role'            => $role,
						'transaction_ids' => $transaction_ids,
					)
				);
			}
		}
	}

	/**
	 * Whether a transaction comes from a get-tickets checkout or retry.
	 *
	 * @param object $transaction Connector transaction.
	 * @return bool
	 */
	private static function is_get_tickets( $transaction ) {
		$metadata = PaymentAttributionDatabase::decode_metadata( $transaction->metadata ?? null );
		return PaymentAttribution::SOURCE_GET_TICKETS === ( $metadata['source'] ?? '' );
	}

	/**
	 * A Connector transaction, or null when it can't be read.
	 *
	 * @param int $transaction_id Transaction ID.
	 * @return object|null
	 */
	private static function connector_transaction( $transaction_id ) {
		if ( $transaction_id <= 0 || ! PaymentHistoryCompatibility::payment_information_available() ) {
			return null;
		}
		$transaction = \FairPaymentsConnector\Models\Transaction::get_by_id( (int) $transaction_id );
		return $transaction ? $transaction : null;
	}
}
