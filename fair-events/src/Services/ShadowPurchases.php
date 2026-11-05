<?php
/**
 * Shadow purchases for Fair Audience-only admissions
 *
 * @package FairEvents
 */

namespace FairEvents\Services;

use FairEvents\Models\EventTicket;

defined( 'WPINC' ) || die;

/**
 * Keeps one Events purchase in step with a Fair Audience relationship that
 * admits someone without an Events purchase behind it
 * (PAYMENT_HISTORY_MIGRATION.md §8.8): Audience's own purchase route, its
 * retries, and organizers adding participants by hand. Payment links need a
 * purchase, and those paths create none.
 *
 * The relationship stays authoritative. The purchase names it as its
 * provenance (legacy_event_participant_id), so both legacy filters skip
 * the relationship and its participant-scope activities, and the purchase's
 * single unit counts in their place. Its status, payment hold, event date,
 * ticket type, check-in and activities follow the relationship. It never
 * carries a transaction_id and fires no Events or Audience hook, so no
 * confirmation email, payment handler or bridge acts on it.
 *
 * A purchase is created only for a relationship newer than the coverage
 * floor (older ones are the historical backfill's) and only when it would
 * be an admission by the contract's rule (§4.1), or a pending Audience
 * checkout whose latest ledger charge comes from Audience's purchase route.
 *
 * phpcs:disable WordPress.DB.DirectDatabaseQuery
 */
class ShadowPurchases {

	/**
	 * Seconds a sync waits for another sync of the same relationship.
	 */
	const LOCK_TIMEOUT = 10;

	/**
	 * Bring a relationship's shadow purchase in step, creating it when the
	 * relationship is a new Audience-only admission.
	 *
	 * @param int $relationship_id Relationship ID.
	 * @param int $floor           Highest relationship ID left to the historical backfill.
	 * @return array{action: string, signup_id: int|null}|\WP_Error What happened: none, created or updated.
	 */
	public static function sync( $relationship_id, $floor ) {
		global $wpdb;

		$relationship_id = (int) $relationship_id;
		if ( ! PaymentHistoryCompatibility::storage_available() ) {
			return new \WP_Error( 'payment_links_unavailable', 'Payment history storage is not installed yet.' );
		}
		if ( ! self::audience_tables_exist() ) {
			return array(
				'action'    => 'none',
				'signup_id' => null,
			);
		}

		$lock = substr( $wpdb->prefix . 'fair_events_shadow_purchase_' . $relationship_id, 0, 64 );
		if ( '1' !== (string) $wpdb->get_var( $wpdb->prepare( 'SELECT GET_LOCK(%s, %d)', $lock, self::LOCK_TIMEOUT ) ) ) {
			return new \WP_Error( 'shadow_purchase_busy', 'Another writer is syncing this relationship.' );
		}

		try {
			$wpdb->query( 'START TRANSACTION' );
			$result = self::sync_locked( $relationship_id, (int) $floor );
			if ( is_wp_error( $result ) ) {
				$wpdb->query( 'ROLLBACK' );
			} else {
				$wpdb->query( 'COMMIT' );
			}
			return $result;
		} finally {
			$wpdb->get_var( $wpdb->prepare( 'SELECT RELEASE_LOCK(%s)', $lock ) );
		}
	}

	/**
	 * Body of sync(), inside its lock and database transaction.
	 *
	 * @param int $relationship_id Relationship ID.
	 * @param int $floor           Coverage floor.
	 * @return array|\WP_Error
	 */
	private static function sync_locked( $relationship_id, $floor ) {
		$relationship = self::relationship( $relationship_id );
		$signup       = self::purchase_for( $relationship_id );

		if ( ! $signup ) {
			if ( ! $relationship || $relationship_id <= $floor || ! self::qualifies( $relationship ) ) {
				return array(
					'action'    => 'none',
					'signup_id' => null,
				);
			}
			$signup_id = self::create( $relationship );
			if ( is_wp_error( $signup_id ) ) {
				return $signup_id;
			}
			$signup = self::purchase_for( $relationship_id );
			$action = 'created';
		} else {
			$updated = self::update( $signup, $relationship );
			if ( is_wp_error( $updated ) ) {
				return $updated;
			}
			$signup = self::purchase_for( $relationship_id );
			$action = 'updated';
		}

		if ( $relationship && $signup ) {
			$copied = self::copy_relationship_history( $signup, $relationship );
			if ( is_wp_error( $copied ) ) {
				return $copied;
			}
		}

		return array(
			'action'    => $action,
			'signup_id' => $signup ? (int) $signup->id : null,
		);
	}

	/**
	 * Whether a relationship without a purchase is a new admission to mirror:
	 * signed up, or a pending Audience checkout within its hold; the
	 * participant has no active Events purchase on the date (or of its
	 * ticket type) and holds no active ticket there (§4.1).
	 *
	 * @param object $relationship Relationship row.
	 * @return bool
	 */
	public static function qualifies( $relationship ) {
		global $wpdb;

		$now = gmdate( 'Y-m-d H:i:s' );
		if ( 'signed_up' !== $relationship->label ) {
			if ( 'pending_payment' !== $relationship->label
				|| empty( $relationship->payment_expires_at )
				|| (string) $relationship->payment_expires_at <= $now
				|| ! self::latest_charge_is_audience_checkout( (int) $relationship->id )
			) {
				return false;
			}
		}

		$active_purchase = $wpdb->get_var(
			$wpdb->prepare(
				"SELECT 1 FROM %i AS s
				WHERE s.participant_id = %d
				AND ( s.event_date_id = %d OR ( %d > 0 AND s.ticket_type_id = %d ) )
				AND ( s.status = 'confirmed' OR ( s.status = 'pending_payment' AND s.payment_expires_at IS NOT NULL AND s.payment_expires_at > %s ) )
				LIMIT 1",
				$wpdb->prefix . 'fair_events_signups',
				(int) $relationship->participant_id,
				(int) $relationship->event_date_id,
				(int) $relationship->ticket_type_id,
				(int) $relationship->ticket_type_id,
				$now
			)
		);
		if ( $active_purchase ) {
			return false;
		}

		return ! EventTicket::get_held_on_event_date( (int) $relationship->event_date_id, (int) $relationship->participant_id );
	}

	/**
	 * Whether the relationship's most recent ledger charge is a transaction
	 * from Audience's own purchase route, so its pending state belongs to an
	 * Audience checkout rather than to an Events purchase in flight.
	 *
	 * @param int $relationship_id Relationship ID.
	 * @return bool
	 */
	private static function latest_charge_is_audience_checkout( $relationship_id ) {
		global $wpdb;

		$transaction_id = (int) $wpdb->get_var(
			$wpdb->prepare(
				"SELECT transaction_id FROM %i WHERE event_participant_id = %d AND kind = 'charge' ORDER BY transaction_id DESC LIMIT 1",
				$wpdb->prefix . 'fair_audience_event_participant_transactions',
				$relationship_id
			)
		);
		if ( ! $transaction_id ) {
			return false;
		}

		$transaction = PaymentAttributionDatabase::transaction( $transaction_id );
		return $transaction && PaymentAttribution::SOURCE_AUDIENCE === ( $transaction['metadata']['source'] ?? '' );
	}

	/**
	 * The status a shadow purchase takes from its relationship.
	 *
	 * @param object|null $relationship Relationship row, or null when it was deleted.
	 * @param string      $current      The purchase's current status.
	 * @return array{status: string, payment_expires_at: string|null}
	 */
	public static function target_state( $relationship, $current ) {
		$now = gmdate( 'Y-m-d H:i:s' );

		if ( ! $relationship ) {
			return array(
				'status'             => 'pending_payment' === $current ? 'expired' : ( 'confirmed' === $current ? 'cancelled' : $current ),
				'payment_expires_at' => null,
			);
		}

		if ( 'signed_up' === $relationship->label ) {
			return array(
				'status'             => 'confirmed',
				'payment_expires_at' => null,
			);
		}

		if ( 'pending_payment' === $relationship->label ) {
			if ( ! empty( $relationship->payment_expires_at ) && (string) $relationship->payment_expires_at > $now ) {
				return array(
					'status'             => 'pending_payment',
					'payment_expires_at' => (string) $relationship->payment_expires_at,
				);
			}
			return array(
				'status'             => 'expired',
				'payment_expires_at' => null,
			);
		}

		return array(
			'status'             => 'cancelled',
			'payment_expires_at' => null,
		);
	}

	/**
	 * Create the purchase and its single unit. The relationship's creation
	 * time (database clock, UTC) becomes the purchase time in site time, as
	 * Events stores it.
	 *
	 * @param object $relationship Relationship row.
	 * @return int|\WP_Error Signup ID.
	 */
	private static function create( $relationship ) {
		global $wpdb;

		$state      = self::target_state( $relationship, '' );
		$profile    = self::participant_profile( (int) $relationship->participant_id );
		$created_at = ! empty( $relationship->created_at ) ? get_date_from_gmt( (string) $relationship->created_at ) : current_time( 'mysql' );

		$inserted = $wpdb->insert(
			$wpdb->prefix . 'fair_events_signups',
			array(
				'event_date_id'               => (int) $relationship->event_date_id,
				'ticket_type_id'              => $relationship->ticket_type_id ? (int) $relationship->ticket_type_id : null,
				'name'                        => $profile['name'],
				'email'                       => $profile['email'],
				'quantity'                    => 1,
				'mailing_opt_in'              => 0,
				'amount'                      => 0,
				'status'                      => $state['status'],
				'participant_id'              => (int) $relationship->participant_id,
				'payment_expires_at'          => $state['payment_expires_at'],
				'legacy_event_participant_id' => (int) $relationship->id,
				'created_at'                  => $created_at,
			),
			array( '%d', '%d', '%s', '%s', '%d', '%d', '%f', '%s', '%d', '%s', '%d', '%s' )
		);
		if ( ! $inserted ) {
			return new \WP_Error( 'shadow_purchase_write_failed', 'The shadow purchase could not be stored.', array( 'event_participant_id' => (int) $relationship->id ) );
		}

		$signup_id = (int) $wpdb->insert_id;
		$signup    = \FairEvents\Models\EventSignup::get_by_id( $signup_id );
		if ( ! $signup || false === EventTicket::reconcile_signup( $signup ) ) {
			return new \WP_Error( 'shadow_purchase_write_failed', 'The shadow purchase\'s ticket could not be stored.', array( 'event_participant_id' => (int) $relationship->id ) );
		}

		$wpdb->query(
			$wpdb->prepare( 'UPDATE %i SET created_at = %s WHERE signup_id = %d', EventTicket::table(), $created_at, $signup_id )
		);

		return $signup_id;
	}

	/**
	 * Follow the relationship's status, hold, date and ticket type. Units
	 * mirror the purchase entirely: the relationship decides the admission.
	 *
	 * @param object      $signup       Purchase row.
	 * @param object|null $relationship Relationship row, or null when deleted.
	 * @return true|\WP_Error
	 */
	private static function update( $signup, $relationship ) {
		global $wpdb;

		$state   = self::target_state( $relationship, (string) $signup->status );
		$changes = array();
		if ( $state['status'] !== (string) $signup->status ) {
			$changes['status'] = $state['status'];
		}
		if ( (string) $state['payment_expires_at'] !== (string) $signup->payment_expires_at ) {
			$changes['payment_expires_at'] = $state['payment_expires_at'];
		}
		if ( $relationship ) {
			if ( (int) $relationship->event_date_id !== (int) $signup->event_date_id ) {
				$changes['event_date_id'] = (int) $relationship->event_date_id;
			}
			if ( (int) $relationship->ticket_type_id !== (int) $signup->ticket_type_id ) {
				$changes['ticket_type_id'] = $relationship->ticket_type_id ? (int) $relationship->ticket_type_id : null;
			}
		}

		if ( ! $changes ) {
			return true;
		}

		if ( false === $wpdb->update( $wpdb->prefix . 'fair_events_signups', $changes, array( 'id' => (int) $signup->id ) ) ) {
			return new \WP_Error( 'shadow_purchase_write_failed', 'The shadow purchase could not be updated.', array( 'signup_id' => (int) $signup->id ) );
		}

		$unit_changes = array_intersect_key( $changes, array_flip( array( 'status', 'event_date_id', 'ticket_type_id' ) ) );
		if ( $unit_changes && false === $wpdb->update( EventTicket::table(), $unit_changes, array( 'signup_id' => (int) $signup->id ) ) ) {
			return new \WP_Error( 'shadow_purchase_write_failed', 'The shadow purchase\'s ticket could not be updated.', array( 'signup_id' => (int) $signup->id ) );
		}

		return true;
	}

	/**
	 * Copy the relationship's check-in and participant-scope activities
	 * onto the purchase's unit, the only candidate ticket (§4.4). Existing
	 * unit activities are updated to the relationship's status and hold, and
	 * never removed: a released hold expires on its own.
	 *
	 * @param object $signup       Purchase row.
	 * @param object $relationship Relationship row.
	 * @return true|\WP_Error
	 */
	private static function copy_relationship_history( $signup, $relationship ) {
		global $wpdb;

		$units = EventTicket::get_by_signup_id( (int) $signup->id );
		if ( ! $units ) {
			return true;
		}
		$ticket_id = (int) $units[0]->id;

		if ( ! empty( $relationship->attended_at ) && empty( $units[0]->attended_at ) ) {
			// Copied as stored, as TicketHistoryBackfill does.
			EventTicket::set_attended( $ticket_id, true, (string) $relationship->attended_at );
		}

		$options = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT ticket_option_id, ticket_option_name, status, expires_at FROM %i WHERE event_participant_id = %d AND ticket_id IS NULL',
				$wpdb->prefix . 'fair_audience_event_participant_options',
				(int) $relationship->id
			)
		);
		foreach ( (array) $options as $option ) {
			$status = 'pending_payment' === $option->status ? 'pending_payment' : 'confirmed';
			$result = $wpdb->query(
				$wpdb->prepare(
					'INSERT INTO %i (ticket_id, ticket_option_id, ticket_option_name, status, expires_at, created_at) VALUES (%d, %d, %s, %s, NULLIF(%s, \'\'), %s)
					ON DUPLICATE KEY UPDATE status = VALUES(status), expires_at = VALUES(expires_at)',
					\FairEvents\Models\EventTicketActivity::table(),
					$ticket_id,
					(int) $option->ticket_option_id,
					(string) $option->ticket_option_name,
					$status,
					'pending_payment' === $status ? (string) $option->expires_at : '',
					current_time( 'mysql' )
				)
			);
			if ( false === $result ) {
				return new \WP_Error( 'shadow_purchase_write_failed', 'An activity could not be copied to the shadow purchase.', array( 'signup_id' => (int) $signup->id ) );
			}
		}

		return true;
	}

	/**
	 * Set a shadow purchase's amount from its payment links: what its paid
	 * links allocate to it, or while nothing is paid, its latest charge
	 * attempt's allocation (§4.2).
	 *
	 * @param int $signup_id Signup ID.
	 * @return void
	 */
	public static function refresh_amount( $signup_id ) {
		global $wpdb;

		$history = PaymentLinks::get_for_signup( (int) $signup_id );
		if ( 'available' !== $history['payment_information'] ) {
			return;
		}

		$paid          = 0.0;
		$any_paid      = false;
		$latest_charge = null;
		foreach ( $history['links'] as $link ) {
			if ( \FairEvents\Models\SignupPaymentLink::ROLE_LEGACY_REFUND_RECORD === $link['role'] ) {
				continue;
			}
			if ( $link['transaction'] && 'paid' === $link['transaction']['status'] ) {
				$paid    += (float) $link['allocated_amount'];
				$any_paid = true;
			}
			if ( \FairEvents\Models\SignupPaymentLink::ROLE_CHARGE === $link['role'] ) {
				$latest_charge = (float) $link['allocated_amount'];
			}
		}

		$amount = $any_paid ? $paid : (float) $latest_charge;
		$wpdb->query(
			$wpdb->prepare(
				'UPDATE %i SET amount = %f WHERE id = %d AND legacy_event_participant_id IS NOT NULL',
				$wpdb->prefix . 'fair_events_signups',
				\FairEventsShared\LineItemTotals::normalize_amount( $amount ),
				(int) $signup_id
			)
		);
	}

	/**
	 * A relationship row.
	 *
	 * @param int $relationship_id Relationship ID.
	 * @return object|null
	 */
	public static function relationship( $relationship_id ) {
		global $wpdb;

		$row = $wpdb->get_row(
			$wpdb->prepare(
				'SELECT id, event_date_id, participant_id, label, payment_expires_at, ticket_type_id, attended_at, created_at FROM %i WHERE id = %d',
				$wpdb->prefix . 'fair_audience_event_participants',
				(int) $relationship_id
			)
		);
		return $row ? $row : null;
	}

	/**
	 * The purchase naming a relationship as its provenance.
	 *
	 * @param int $relationship_id Relationship ID.
	 * @return object|null
	 */
	public static function purchase_for( $relationship_id ) {
		global $wpdb;

		$row = $wpdb->get_row(
			$wpdb->prepare( 'SELECT * FROM %i WHERE legacy_event_participant_id = %d', $wpdb->prefix . 'fair_events_signups', (int) $relationship_id )
		);
		return $row ? $row : null;
	}

	/**
	 * Name and email from the participant profile; empty when it is gone or
	 * anonymized.
	 *
	 * @param int $participant_id Participant ID.
	 * @return array{name: string, email: string}
	 */
	private static function participant_profile( $participant_id ) {
		global $wpdb;

		$row = $wpdb->get_row(
			$wpdb->prepare( 'SELECT name, surname, email FROM %i WHERE id = %d', $wpdb->prefix . 'fair_audience_participants', (int) $participant_id )
		);

		return array(
			'name'  => $row ? trim( (string) $row->name . ' ' . (string) $row->surname ) : '',
			'email' => $row ? (string) $row->email : '',
		);
	}

	/**
	 * Whether Fair Audience's relationship, options, ledger and participant
	 * tables exist.
	 *
	 * @return bool
	 */
	public static function audience_tables_exist() {
		global $wpdb;

		static $exists = null;
		if ( null === $exists ) {
			$table  = $wpdb->prefix . 'fair_audience_event_participants';
			$exists = $table === $wpdb->get_var( $wpdb->prepare( 'SHOW TABLES LIKE %s', $wpdb->esc_like( $table ) ) );
		}
		return $exists;
	}
}
