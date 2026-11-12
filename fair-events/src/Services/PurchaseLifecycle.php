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
 * Fair Audience's purchase route, activity add-ons and series upgrades go
 * through the same service (§8.12): Audience records each attempt here
 * before the buyer pays, Events applies their paid notifications to its
 * purchases (confirmation, the add-on's activities, the upgraded ticket
 * type) and then announces what it committed
 * (`fair_events_purchase_payment_applied`), which Audience projects onto
 * its relationships, activities and ledger. Only an Audience that says it
 * does this (PaymentHistoryCompatibility::audience_lifecycle_available())
 * gets those notifications handled here.
 *
 * The lifecycle is unconditional (#2251): it no longer waits for the
 * recorded stage 4 activation, and a purchase with no payment links is
 * never resolved from the transaction's metadata or a latest-attempt
 * pointer instead.
 */
class PurchaseLifecycle {

	/**
	 * Seconds the request confirming a purchase has to announce it before
	 * the retry cron does.
	 */
	const ANNOUNCE_GRACE = 300;

	/**
	 * Fires after a paid Fair Audience attempt changed its purchases.
	 */
	const APPLIED_HOOK = 'fair_events_purchase_payment_applied';

	/**
	 * Whether the lifecycle is authoritative on this site: always, since
	 * Fair Events owns purchases and their payment history (#2251). Kept
	 * for Fair Audience, which checks it before using the lifecycle.
	 *
	 * @return bool
	 */
	public static function active() {
		return true;
	}

	/**
	 * Whether payments from Fair Audience's routes are applied here: Fair
	 * Audience, when active, projects what Events commits instead of
	 * confirming its own relationships. Fair Audience checks this before
	 * leaving its paid notifications to Events.
	 *
	 * @return bool
	 */
	public static function handles_audience_sources() {
		return PaymentHistoryCompatibility::audience_lifecycle_available();
	}

	/**
	 * Write an attempt's links: the purchases its evidence names, with the
	 * allocation each gets (PaymentAttribution, §8.8). Repeating it is a
	 * no-op, so a checkout continued after an interruption can call it
	 * again. On success any recovery work still queued for the transaction
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

		// A Fair Audience attempt pays for the purchases its relationships
		// stand for. A new Audience checkout has none until its shadow
		// purchase is created, so the relationships it names are brought in
		// step first.
		if ( in_array( (string) ( $transaction['metadata']['source'] ?? '' ), self::audience_sources(), true ) ) {
			foreach ( self::named_relationships( $transaction['metadata'] ) as $relationship_id ) {
				$synced = ShadowPurchases::sync( $relationship_id );
				if ( is_wp_error( $synced ) ) {
					return $synced;
				}
			}
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
			foreach ( array_unique( array_column( $links, 'signup_id' ) ) as $signup_id ) {
				ShadowPurchases::refresh_amount( (int) $signup_id );
			}
			PaymentShadowWork::complete( PaymentShadowWork::KIND_TRANSACTION, $transaction_id );
		}
		return $written;
	}

	/**
	 * Bring the purchase of a Fair Audience registration in step now: a
	 * free signup, which records no attempt, gets its purchase (and so its
	 * places) at once. Repeating it is a no-op. A registration that doesn't
	 * qualify (§4.1) gets none. It opens its own database transaction, so a
	 * writer inside one calls relationship_changed() instead.
	 *
	 * @param int $relationship_id Fair Audience relationship ID.
	 * @return int|null|\WP_Error The purchase ID, null when there is none, or why it failed.
	 */
	public static function record_relationship( $relationship_id ) {
		$synced = ShadowPurchases::sync( (int) $relationship_id );
		if ( is_wp_error( $synced ) ) {
			return $synced;
		}
		return empty( $synced['signup_id'] ) ? null : (int) $synced['signup_id'];
	}

	/**
	 * A Fair Audience organizer added, relabelled, moved, retyped or removed
	 * a registration, or changed its activities: bring its purchase in step
	 * at the end of the request, after the writer's own database transaction
	 * (PurchaseRecovery::queue_relationship()). A sync that fails there is
	 * retried by the recovery cron.
	 *
	 * @param int $relationship_id Fair Audience relationship ID.
	 * @return void
	 */
	public static function relationship_changed( $relationship_id ) {
		PurchaseRecovery::queue_relationship( (int) $relationship_id );
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
	 * repeats, a cancellation releases and a failure fails. Only payment
	 * links say which purchases an attempt is for: an attempt with none
	 * (one the backfill left unresolved) has no purchases here, and the
	 * caller refuses the operation.
	 *
	 * @param object $transaction Connector transaction.
	 * @return int[] Signup IDs.
	 */
	public static function current_signup_ids( $transaction ) {
		$linked = self::linked_signup_ids( (int) $transaction->id );

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
		$source         = self::source( $transaction );
		if ( in_array( $source, self::audience_sources(), true ) && self::handles_audience_sources() ) {
			return self::handle_audience_paid( $transaction, $source );
		}
		if ( PaymentAttribution::SOURCE_GET_TICKETS !== $source ) {
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
		if ( PaymentShadowWork::KIND_PROJECTION === $kind ) {
			return self::finish_projection( $source_id );
		}

		$transaction = self::connector_transaction( $source_id );
		if ( ! $transaction ) {
			$code = PaymentHistoryCompatibility::payment_information_available() ? 'missing_transaction' : 'payment_information_unavailable';
			PaymentShadowWork::defer( $kind, $source_id, 'missing_transaction' === $code ? PaymentShadowWork::STATUS_UNRESOLVED : PaymentShadowWork::STATUS_FAILED, $code );
			return 'missing_transaction' === $code ? 'unresolved' : 'failed';
		}

		$source   = self::source( $transaction );
		$audience = in_array( $source, self::audience_sources(), true ) && self::handles_audience_sources();
		if ( PaymentAttribution::SOURCE_GET_TICKETS !== $source && ! $audience ) {
			PaymentShadowWork::complete( $kind, $source_id );
			return 'done';
		}

		if ( 'paid' === (string) $transaction->status ) {
			return self::handle_paid( $transaction )['resolved'] ? 'done' : 'failed';
		}
		if ( ! $audience && in_array( (string) $transaction->status, array( 'failed', 'canceled', 'expired' ), true ) ) {
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
		return PaymentAttribution::SOURCE_GET_TICKETS === self::source( $transaction );
	}

	/**
	 * The `source` a transaction's metadata names.
	 *
	 * @param object $transaction Connector transaction.
	 * @return string
	 */
	private static function source( $transaction ) {
		$metadata = PaymentAttributionDatabase::decode_metadata( $transaction->metadata ?? null );
		return (string) ( $metadata['source'] ?? '' );
	}

	/**
	 * Sources of Fair Audience's purchase route, add-ons and upgrades.
	 *
	 * @return string[]
	 */
	private static function audience_sources() {
		return array( PaymentAttribution::SOURCE_AUDIENCE, PaymentAttribution::SOURCE_ADDON, PaymentAttribution::SOURCE_UPGRADE );
	}

	/**
	 * The link role an Audience source's attempt pays for.
	 *
	 * @param string $source Metadata source.
	 * @return string
	 */
	private static function audience_role( $source ) {
		if ( PaymentAttribution::SOURCE_ADDON === $source ) {
			return SignupPaymentLink::ROLE_ADDITIONAL_CHARGE;
		}
		if ( PaymentAttribution::SOURCE_UPGRADE === $source ) {
			return SignupPaymentLink::ROLE_UPGRADE;
		}
		return SignupPaymentLink::ROLE_CHARGE;
	}

	/**
	 * Relationship IDs a transaction's metadata names.
	 *
	 * @param array $metadata Metadata.
	 * @return int[]
	 */
	private static function named_relationships( array $metadata ) {
		$ids = isset( $metadata['event_participant_ids'] ) && is_array( $metadata['event_participant_ids'] ) ? $metadata['event_participant_ids'] : array();
		if ( ! empty( $metadata['event_participant_id'] ) ) {
			$ids[] = $metadata['event_participant_id'];
		}
		return array_values( array_unique( array_filter( array_map( 'intval', $ids ) ) ) );
	}

	/**
	 * Apply a paid notification of a Fair Audience attempt to the purchases
	 * its links name, then announce what changed so Audience can project
	 * it. Each change is made once, under the transaction's link lock: a
	 * replayed or concurrent notification finds it made and announces
	 * nothing.
	 *
	 * - Purchase route: confirm each purchase (shared multi-occurrence
	 *   checkouts link several), as for get-tickets.
	 * - Add-on: confirm the activities on the purchase's ticket.
	 * - Upgrade: give the purchase the whole-series ticket type. Its
	 *   original charge stays linked as it was.
	 *
	 * @param object $transaction Connector transaction (status paid).
	 * @param string $source      Metadata source.
	 * @return array{resolved: bool, confirmed: int[]} Whether purchases were found, and those that changed.
	 */
	private static function handle_audience_paid( $transaction, $source ) {
		$transaction_id = (int) $transaction->id;
		$role           = self::audience_role( $source );
		$outcome        = array(
			'resolved'  => false,
			'confirmed' => array(),
		);

		$signup_ids = self::linked_signup_ids( $transaction_id, array( $role ) );
		if ( ! $signup_ids ) {
			$recorded = self::record_attempt( $transaction_id );
			if ( is_wp_error( $recorded ) ) {
				$status = 'payment_attempt_unattributed' === $recorded->get_error_code() ? PaymentShadowWork::STATUS_UNRESOLVED : PaymentShadowWork::STATUS_FAILED;
				PaymentShadowWork::defer( PaymentShadowWork::KIND_PAYMENT, $transaction_id, $status, $recorded->get_error_code(), array( 'message' => $recorded->get_error_message() ) );
				return $outcome;
			}
			$signup_ids = self::linked_signup_ids( $transaction_id, array( $role ) );
		}

		if ( ! PaymentLinks::acquire_lock( $transaction_id ) ) {
			PaymentShadowWork::defer( PaymentShadowWork::KIND_PAYMENT, $transaction_id, PaymentShadowWork::STATUS_FAILED, 'payment_links_busy' );
			return $outcome;
		}

		$metadata = PaymentAttributionDatabase::decode_metadata( $transaction->metadata ?? null );
		$changed  = array();
		try {
			foreach ( $signup_ids as $signup_id ) {
				if ( PaymentAttribution::SOURCE_ADDON === $source ) {
					$applied = self::confirm_addon( $signup_id, $metadata );
				} elseif ( PaymentAttribution::SOURCE_UPGRADE === $source ) {
					$applied = self::upgrade_purchase( $signup_id, (int) ( $metadata['ticket_type_id'] ?? 0 ) );
				} else {
					$applied = self::confirm_paid_signup( $signup_id );
				}
				if ( is_wp_error( $applied ) ) {
					PaymentShadowWork::defer( PaymentShadowWork::KIND_PAYMENT, $transaction_id, PaymentShadowWork::STATUS_FAILED, $applied->get_error_code(), array( 'message' => $applied->get_error_message() ) );
					return $outcome;
				}
				if ( $applied ) {
					$changed[] = $signup_id;
				}
			}
		} finally {
			PaymentLinks::release_lock( $transaction_id );
		}

		$outcome['resolved']  = true;
		$outcome['confirmed'] = $changed;
		if ( $changed ) {
			self::project( $transaction, $source, $changed );
		}

		if ( PaymentAttribution::SOURCE_ADDON !== $source ) {
			self::report_multiple_paid_attempts( $signup_ids );
		}
		PaymentShadowWork::complete( PaymentShadowWork::KIND_PAYMENT, $transaction_id );

		return $outcome;
	}

	/**
	 * Confirm a paid add-on's activities on the purchase's ticket: the one
	 * the add-on was bought for, else the buyer's ticket of that purchase,
	 * else its first ticket (a shadow purchase has exactly one). The
	 * payment is always honoured. Activities whose hold lapsed released
	 * their places, so they are rechecked under the capacity lock and
	 * flagged over capacity, with the purchase, when they went past their
	 * limit meanwhile.
	 *
	 * @param int   $signup_id Purchase the add-on is linked to.
	 * @param array $metadata  Transaction metadata.
	 * @return bool|\WP_Error True when activities were confirmed by this call.
	 */
	private static function confirm_addon( $signup_id, array $metadata ) {
		$option_ids = array_values( array_unique( array_filter( array_map( 'intval', (array) ( $metadata['ticket_option_ids'] ?? array() ) ) ) ) );
		if ( ! $option_ids ) {
			return false;
		}

		$ticket = self::addon_ticket( $signup_id, (int) ( $metadata['ticket_id'] ?? 0 ), (int) ( $metadata['participant_id'] ?? 0 ) );
		if ( ! $ticket ) {
			return new \WP_Error( 'addon_ticket_missing', 'The add-on\'s purchase has no ticket to carry its activities.', array( 'signup_id' => (int) $signup_id ) );
		}
		$ticket_id = (int) $ticket->id;

		$missing = array_values( array_diff( $option_ids, EventTicketActivity::get_option_ids( $ticket_id, true ) ) );
		$options = array();
		foreach ( $missing as $option_id ) {
			$option = \FairEvents\Models\TicketOption::get_by_id( $option_id );
			if ( $option ) {
				$options[] = array(
					'id'   => $option_id,
					'name' => (string) $option->name,
				);
			}
		}
		if ( ! $options ) {
			return false;
		}

		$held   = EventTicketActivity::get_active_option_ids( array( $ticket_id ) );
		$lapsed = array_values(
			array_filter(
				$options,
				static function ( $option ) use ( $held ) {
					return ! in_array( (int) $option['id'], $held, true );
				}
			)
		);
		if ( ! $lapsed ) {
			return EventTicketActivity::confirm( $ticket_id, $options )
				? true
				: new \WP_Error( 'addon_write_failed', 'The add-on\'s activities could not be confirmed.', array( 'ticket_id' => $ticket_id ) );
		}

		$demand = array(
			'event_date_id'  => (int) $ticket->event_date_id,
			'ticket_type_id' => (int) $ticket->ticket_type_id,
			'quantity'       => 0,
			'option_ids'     => array_map(
				static function ( $option ) {
					return (int) $option['id'];
				},
				$lapsed
			),
		);

		return TicketCapacity::with_capacity_lock(
			array( $demand ),
			static function ( $shortage ) use ( $ticket, $ticket_id, $options, $demand ) {
				$full_option_ids = array();
				if ( $shortage ) {
					foreach ( TicketCapacity::find_shortages( TicketCapacity::places_needed( array( $demand ) ) ) as $found ) {
						if ( 'ticket_option' === $found['scope'] ) {
							$full_option_ids[] = (int) $found['id'];
						}
					}
				}

				if ( ! EventTicketActivity::confirm( $ticket_id, $options ) ) {
					return new \WP_Error( 'addon_write_failed', 'The add-on\'s activities could not be confirmed.', array( 'ticket_id' => $ticket_id ) );
				}
				if ( $full_option_ids ) {
					EventTicketActivity::mark_over_capacity( $ticket_id, $full_option_ids );
					EventSignup::mark_over_capacity( (int) $ticket->signup_id );
				}
				return true;
			}
		);
	}

	/**
	 * The ticket of a purchase an add-on's activities go to.
	 *
	 * @param int $signup_id      Purchase.
	 * @param int $ticket_id      Ticket the add-on names, 0 for none.
	 * @param int $participant_id Buyer.
	 * @return object|null
	 */
	private static function addon_ticket( $signup_id, $ticket_id, $participant_id ) {
		if ( $ticket_id ) {
			$ticket = EventTicket::get_by_id( $ticket_id );
			if ( $ticket && (int) $ticket->signup_id === (int) $signup_id ) {
				return $ticket;
			}
		}

		$units = EventTicket::get_by_signup_id( (int) $signup_id );
		foreach ( $units as $unit ) {
			if ( $participant_id && (int) $unit->holder_participant_id === $participant_id ) {
				return $unit;
			}
		}
		return $units ? $units[0] : null;
	}

	/**
	 * Give a purchase and its active tickets another ticket type: a paid or
	 * free series upgrade.
	 *
	 * @param int $signup_id      Purchase.
	 * @param int $ticket_type_id Whole-series ticket type.
	 * @return bool|\WP_Error True when this call changed the type.
	 */
	public static function upgrade_purchase( $signup_id, $ticket_type_id ) {
		global $wpdb;

		$signup = EventSignup::get_by_id( (int) $signup_id );
		if ( ! $signup || (int) $ticket_type_id <= 0 || (int) $signup->ticket_type_id === (int) $ticket_type_id ) {
			return false;
		}

		$wpdb->query( 'START TRANSACTION' );
		if ( ! EventSignup::change_ticket_type_in_transaction( (int) $signup_id, (int) $ticket_type_id ) ) {
			$wpdb->query( 'ROLLBACK' );
			return new \WP_Error( 'upgrade_write_failed', 'The purchase\'s ticket type could not be changed.', array( 'signup_id' => (int) $signup_id ) );
		}
		$wpdb->query( 'COMMIT' );
		return true;
	}

	/**
	 * Announce a committed Audience payment change and keep a queued row
	 * until the announcement ran, so the retry cron finishes a request that
	 * stopped in between (at least once, as for confirmations).
	 *
	 * @param object $transaction Connector transaction.
	 * @param string $source      Metadata source.
	 * @param int[]  $signup_ids  Purchases the change was made on.
	 * @return void
	 */
	private static function project( $transaction, $source, array $signup_ids ) {
		$transaction_id = (int) $transaction->id;
		PaymentShadowWork::enqueue_later( PaymentShadowWork::KIND_PROJECTION, $transaction_id, self::ANNOUNCE_GRACE, array( 'source' => $source ) );
		self::announce_applied( $transaction, $source, $signup_ids );
		PaymentShadowWork::complete( PaymentShadowWork::KIND_PROJECTION, $transaction_id );
	}

	/**
	 * Tell Fair Audience what a paid attempt of one of its routes changed.
	 *
	 * @param object $transaction Connector transaction.
	 * @param string $source      Metadata source.
	 * @param int[]  $signup_ids  Purchases the change was made on.
	 * @return void
	 */
	private static function announce_applied( $transaction, $source, array $signup_ids ) {
		$signups = array();
		foreach ( $signup_ids as $signup_id ) {
			$signup = EventSignup::get_by_id( (int) $signup_id );
			if ( $signup ) {
				$signups[] = $signup;
			}
		}

		/**
		 * Fires after a paid Fair Audience attempt (purchase route, activity
		 * add-on or series upgrade) changed its purchases, once the change
		 * committed: confirmed them, confirmed the add-on's activities or
		 * gave them the whole-series ticket type. Fair Audience projects it
		 * onto its relationships, activities and ledger and sends its
		 * emails. Fired once per change, or again by the retry cron when the
		 * request stopped before it finished.
		 *
		 * @param object   $transaction Connector transaction.
		 * @param array    $applied {
		 *     @type string   $source  Metadata source of the transaction.
		 *     @type string   $role    Link role: charge, additional_charge or upgrade.
		 *     @type object[] $signups The purchases (fair_events_signups rows) after the change.
		 * }
		 */
		do_action(
			self::APPLIED_HOOK,
			$transaction,
			array(
				'source'  => $source,
				'role'    => self::audience_role( $source ),
				'signups' => $signups,
			)
		);
	}

	/**
	 * Announce an Audience payment change whose request stopped before it
	 * could. Purchases no longer in the changed state (a confirmation an
	 * organizer cancelled since) aren't announced.
	 *
	 * @param int $transaction_id Connector transaction ID.
	 * @return string Outcome.
	 */
	private static function finish_projection( $transaction_id ) {
		$kind        = PaymentShadowWork::KIND_PROJECTION;
		$transaction = self::connector_transaction( $transaction_id );
		if ( ! $transaction ) {
			if ( ! PaymentHistoryCompatibility::payment_information_available() ) {
				PaymentShadowWork::defer( $kind, $transaction_id, PaymentShadowWork::STATUS_FAILED, 'payment_information_unavailable' );
				return 'failed';
			}
			PaymentShadowWork::complete( $kind, $transaction_id );
			return 'done';
		}

		$source     = self::source( $transaction );
		$signup_ids = in_array( $source, self::audience_sources(), true )
			? self::linked_signup_ids( $transaction_id, array( self::audience_role( $source ) ) )
			: array();
		if ( PaymentAttribution::SOURCE_AUDIENCE === $source ) {
			$signup_ids = array_values(
				array_filter(
					$signup_ids,
					static function ( $signup_id ) {
						$signup = EventSignup::get_by_id( $signup_id );
						return $signup && 'confirmed' === $signup->status;
					}
				)
			);
		}

		if ( $signup_ids ) {
			self::announce_applied( $transaction, $source, $signup_ids );
		}
		PaymentShadowWork::complete( $kind, $transaction_id );
		return 'done';
	}

	/**
	 * What a relationship's purchase has paid, for the price of a series
	 * upgrade (§5.6): the series price minus this purchase's own paid
	 * allocations, never other purchases' on the same date (gap G4).
	 *
	 * @param int    $relationship_id Fair Audience relationship being upgraded.
	 * @param string $currency        Currency to sum; allocations in others are left out.
	 * @return array{signup_id: int, paid: float}|\WP_Error The purchase and what it paid, or why it can't be told.
	 */
	public static function upgrade_credit( $relationship_id, $currency ) {
		$signup_id = self::relationship_purchase( (int) $relationship_id );
		if ( ! $signup_id ) {
			return new \WP_Error( 'upgrade_purchase_ambiguous', 'The registration being upgraded doesn\'t map to exactly one purchase.', array( 'event_participant_id' => (int) $relationship_id ) );
		}

		$history = PaymentLinks::get_for_signup( $signup_id );
		if ( 'available' !== $history['payment_information'] ) {
			return new \WP_Error( 'payment_information_unavailable', 'Payment information can\'t be read because Fair Payments Connector is inactive or not installed.' );
		}

		return array(
			'signup_id' => $signup_id,
			'paid'      => self::paid_allocation_total( $history['links'], (string) $currency ),
		);
	}

	/**
	 * Upgrade a relationship's purchase when nothing is left to pay.
	 *
	 * @param int $relationship_id Fair Audience relationship being upgraded.
	 * @param int $ticket_type_id  Whole-series ticket type.
	 * @return true|\WP_Error
	 */
	public static function upgrade_without_payment( $relationship_id, $ticket_type_id ) {
		$signup_id = self::relationship_purchase( (int) $relationship_id );
		if ( ! $signup_id ) {
			return new \WP_Error( 'upgrade_purchase_ambiguous', 'The registration being upgraded doesn\'t map to exactly one purchase.', array( 'event_participant_id' => (int) $relationship_id ) );
		}

		$upgraded = self::upgrade_purchase( $signup_id, (int) $ticket_type_id );
		return is_wp_error( $upgraded ) ? $upgraded : true;
	}

	/**
	 * Sum of a purchase's paid allocations in one currency. Refund-labelled
	 * legacy records never count (§11).
	 *
	 * @param array[] $links    Links as PaymentLinks::get_for_signup() returns them.
	 * @param string  $currency Currency.
	 * @return float
	 */
	public static function paid_allocation_total( array $links, $currency ) {
		$cents = 0;
		foreach ( $links as $link ) {
			if ( SignupPaymentLink::ROLE_LEGACY_REFUND_RECORD === (string) $link['role']
				|| strtoupper( (string) $link['currency'] ) !== strtoupper( (string) $currency )
				|| empty( $link['transaction'] )
				|| 'paid' !== (string) $link['transaction']['status']
			) {
				continue;
			}
			$cents += (int) round( (float) $link['allocated_amount'] * 100 );
		}
		return $cents / 100.0;
	}

	/**
	 * Whether a purchase has a paid upgrade: its ticket type is then the
	 * lifecycle's, whatever its relationship still says.
	 *
	 * @param int $signup_id Purchase.
	 * @return bool
	 */
	public static function has_paid_upgrade( $signup_id ) {
		foreach ( SignupPaymentLink::get_by_signup_id( (int) $signup_id ) as $link ) {
			if ( SignupPaymentLink::ROLE_UPGRADE !== (string) $link['role'] ) {
				continue;
			}
			$transaction = self::connector_transaction( (int) $link['transaction_id'] );
			if ( $transaction && 'paid' === (string) $transaction->status ) {
				return true;
			}
		}
		return false;
	}

	/**
	 * Whether a failed add-on attempt was superseded by a newer attempt
	 * for some of the same activities on the same purchase that is still
	 * open or paid. Its failure must not release the holds that attempt
	 * relies on.
	 *
	 * @param object $transaction The failed add-on transaction.
	 * @return bool
	 */
	public static function addon_attempt_superseded( $transaction ) {
		$transaction_id = (int) $transaction->id;
		$metadata       = PaymentAttributionDatabase::decode_metadata( $transaction->metadata ?? null );
		$option_ids     = array_map( 'intval', (array) ( $metadata['ticket_option_ids'] ?? array() ) );

		foreach ( self::linked_signup_ids( $transaction_id, array( SignupPaymentLink::ROLE_ADDITIONAL_CHARGE ) ) as $signup_id ) {
			foreach ( SignupPaymentLink::get_by_signup_id( $signup_id ) as $link ) {
				if ( SignupPaymentLink::ROLE_ADDITIONAL_CHARGE !== (string) $link['role'] || (int) $link['transaction_id'] <= $transaction_id ) {
					continue;
				}
				$newer = self::connector_transaction( (int) $link['transaction_id'] );
				if ( ! $newer || in_array( (string) $newer->status, array( 'failed', 'canceled', 'expired' ), true ) ) {
					continue;
				}
				$newer_options = array_map( 'intval', (array) ( PaymentAttributionDatabase::decode_metadata( $newer->metadata ?? null )['ticket_option_ids'] ?? array() ) );
				if ( array_intersect( $option_ids, $newer_options ) ) {
					return true;
				}
			}
		}
		return false;
	}

	/**
	 * The purchase a relationship represents (§5.6, as attribution decides
	 * it): the one naming it as its provenance, else the participant's
	 * single active purchase on its date.
	 *
	 * @param int $relationship_id Relationship ID.
	 * @return int|null
	 */
	private static function relationship_purchase( $relationship_id ) {
		// A free registration's purchase may not exist yet: bring it in step
		// first, as record_attempt() does for a checkout.
		self::record_relationship( (int) $relationship_id );
		return ( new PaymentAttribution( new PaymentAttributionDatabase() ) )->relationship_purchase( (int) $relationship_id );
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
