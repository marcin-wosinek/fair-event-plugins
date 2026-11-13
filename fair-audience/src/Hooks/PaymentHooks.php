<?php
/**
 * Payment Hooks
 *
 * Listens to fair-payments-connector webhook actions to update fee payment status.
 *
 * @package FairAudience
 */

namespace FairAudience\Hooks;

use FairAudienceExperimental\Database\FeePaymentRepository;
use FairAudienceExperimental\Database\FeeAuditLogRepository;
use FairAudienceExperimental\Database\FeeRepository;
use FairAudience\Core\Cron;
use FairAudience\Database\ParticipantRepository;
use FairAudience\Database\EventParticipantRepository;
use FairAudience\Services\EmailService;
use FairAudience\Services\EventsLifecycle;
use FairAudience\Services\TicketActivities;
use FairAudience\Services\TransactionPurchases;
use FairEventsShared\Money;

defined( 'WPINC' ) || die;

/**
 * Hooks into fair-payments-connector webhook to handle fee payment completion.
 */
class PaymentHooks {

	/**
	 * Cron hook releasing expired pending-payment signups.
	 */
	const CLEANUP_HOOK = 'fair_audience_cleanup_expired_signups';

	/**
	 * Initialize hooks.
	 */
	public static function init() {
		add_action( 'fair_payment_paid', array( static::class, 'handle_payment_paid' ), 10, 2 );
		add_action( 'fair_payment_failed', array( static::class, 'handle_payment_failed' ), 10, 2 );
		add_action( 'fair_payment_failed', array( static::class, 'handle_signup_failed' ), 10, 2 );
		add_action( 'fair_payment_failed', array( static::class, 'handle_activities_added_failed' ), 10, 2 );
		add_action( 'fair_events_purchase_payment_applied', array( static::class, 'project_payment_applied' ), 10, 2 );

		add_action( 'fair_audience_event_signup_paid', array( static::class, 'send_signup_confirmation_email' ), 10, 2 );
		add_action( 'fair_audience_event_signup_failed', array( static::class, 'send_signup_payment_failed_email' ), 10, 2 );
		add_action( 'fair_audience_event_activities_added', array( static::class, 'send_activities_added_email' ), 10, 3 );

		add_filter( 'fair_payment_resolve_participant_id', array( static::class, 'resolve_participant_id' ), 10, 2 );
		add_filter( 'fair_payment_prepare_participant', array( static::class, 'prepare_participant' ), 10, 2 );
		add_filter( 'fair_payment_participant_search_source', array( static::class, 'participant_search_source' ) );
		add_filter( 'fair_payment_notification_context', array( static::class, 'enrich_notification_context' ), 10, 3 );
		add_action( 'fair_payment_backfill_participant_ids', array( static::class, 'backfill_participant_ids' ) );

		// Expire pending signup rows whose payment never completed.
		// The interval is registered before anything schedules with it, and
		// scheduling waits for `init`: it runs every plugin's translated
		// `cron_schedules` labels.
		Cron::register_interval();
		add_action( self::CLEANUP_HOOK, array( static::class, 'cleanup_expired_signups' ) );
		add_action( 'init', array( static::class, 'schedule_cleanup' ), 11 );
	}

	/**
	 * Resolve a participant ID from transaction creation context.
	 *
	 * Resolution order: explicit metadata → email lookup → wp_user_id lookup.
	 * Returns null when no participant matches; fair-payments-connector then falls back
	 * to storing only user_id on the transaction row.
	 *
	 * @param int|null $participant_id Current value (null if not yet resolved).
	 * @param array    $context        Context: user_id, email, metadata.
	 * @return int|null Participant ID or null.
	 */
	public static function resolve_participant_id( $participant_id, $context ) {
		if ( null !== $participant_id ) {
			return $participant_id;
		}

		$repository = new ParticipantRepository();

		if ( ! empty( $context['metadata']['participant_id'] ) ) {
			$participant = $repository->get_by_id( (int) $context['metadata']['participant_id'] );
			if ( $participant ) {
				return $participant->id;
			}
		}

		if ( ! empty( $context['email'] ) ) {
			$participant = $repository->get_by_email( $context['email'] );
			if ( $participant ) {
				return $participant->id;
			}
		}

		if ( ! empty( $context['user_id'] ) ) {
			$participant = $repository->get_by_user_id( (int) $context['user_id'] );
			if ( $participant ) {
				return $participant->id;
			}
		}

		return null;
	}

	/**
	 * Prepare a participant summary for API responses.
	 *
	 * @param array|null $prepared       Current value (null if not yet prepared).
	 * @param int|null   $participant_id Participant ID.
	 * @return array|null Summary with id, name, email, admin_url — or null.
	 */
	public static function prepare_participant( $prepared, $participant_id ) {
		if ( null !== $prepared || empty( $participant_id ) ) {
			return $prepared;
		}

		$repository  = new ParticipantRepository();
		$participant = $repository->get_by_id( (int) $participant_id );

		if ( ! $participant ) {
			return null;
		}

		$full_name = trim( $participant->name . ' ' . $participant->surname );

		return array(
			'id'        => (int) $participant->id,
			'name'      => $full_name,
			'email'     => $participant->email,
			'admin_url' => admin_url( 'admin.php?page=fair-audience-participant-detail&participant_id=' . (int) $participant->id ),
		);
	}

	/**
	 * Tell fair-payments-connector where participant names and emails live,
	 * so its transaction search can match the person prepare_participant()
	 * displays. Identifiers only; fair-payments-connector builds the query.
	 *
	 * @param array|null $source Current value (null if not yet provided).
	 * @return array Source descriptor: table, id_column, name_columns, email_column.
	 */
	public static function participant_search_source( $source ) {
		if ( null !== $source ) {
			return $source;
		}

		global $wpdb;

		return array(
			'table'        => $wpdb->prefix . 'fair_audience_participants',
			'id_column'    => 'id',
			'name_columns' => array( 'name', 'surname' ),
			'email_column' => 'email',
		);
	}

	/**
	 * Enrich the fair-payments-connector notification context with participant and event
	 * details derived from the audience tables. Used by the Telegram notification
	 * (and any future channel) so the rendered message can include human-friendly
	 * names and admin links.
	 *
	 * @param array  $context     Default context from fair-payments-connector.
	 * @param object $transaction Transaction row.
	 * @param object $payment     Mollie payment object.
	 * @return array
	 */
	public static function enrich_notification_context( $context, $transaction, $payment ) {
		global $wpdb;

		// A transaction is either a membership-fee payment (metadata carries
		// fee_payment_id, no purchase is ever linked to it) or an event
		// purchase — never both, so skip the purchase lookup entirely for
		// fee payments instead of querying it for a guaranteed-empty result.
		$metadata           = ! empty( $transaction->metadata ) ? json_decode( $transaction->metadata, true ) : array();
		$metadata           = is_array( $metadata ) ? $metadata : array();
		$is_fee_payment     = ! empty( $metadata['fee_payment_id'] );
		$event_participants = array();

		if ( ! $is_fee_payment ) {
			// The purchases this transaction paid for, from Fair Events'
			// payment links (PAYMENT_HISTORY_MIGRATION.md §8.15). Without
			// them nothing is named: never the ledger, nor another purchase
			// of the same participant (#2250, #2251).
			$event_participants = TransactionPurchases::create()->for_transaction( (int) $transaction->id );
		} elseif ( class_exists( FeeRepository::class ) ) {
			// Membership-fee payments — resolve the group/fee names so the
			// notification names what was actually purchased instead of the
			// (always empty, for this transaction type) event-ticket fields.
			$fee_payment_repo = new FeePaymentRepository();
			$fee_payment      = $fee_payment_repo->get_by_id( (int) $metadata['fee_payment_id'] );
			if ( $fee_payment ) {
				$fee_repo = new FeeRepository();
				$fee      = $fee_repo->get_by_id_with_group( (int) $fee_payment->fee_id );
				if ( $fee ) {
					$context['fee_label']   = isset( $fee['name'] ) ? (string) $fee['name'] : '';
					$context['group_label'] = isset( $fee['group_name'] ) ? (string) $fee['group_name'] : '';
				}
			}
		}

		$summary = TransactionPurchases::summary( $event_participants );

		// Participant branch — prefer transaction->participant_id, but fall
		// back to the purchaser when every resolved purchase has the same
		// one. A 'multiple_instances' purchase can charge one transaction
		// against several registrants, and picking an arbitrary one there
		// would misattribute the notification.
		$participant_id = isset( $transaction->participant_id ) ? (int) $transaction->participant_id : 0;
		if ( $participant_id <= 0 ) {
			$participant_id = $summary['participant_id'];
		}

		if ( $participant_id > 0 ) {
			$participant_repo = new ParticipantRepository();
			$participant      = $participant_repo->get_by_id( $participant_id );
			if ( $participant ) {
				$full_name                         = trim( $participant->name . ' ' . $participant->surname );
				$surname                           = trim( (string) $participant->surname );
				$surname_initial                   = '' !== $surname ? mb_strtoupper( mb_substr( $surname, 0, 1 ) ) . '.' : '';
				$context['participant_name']       = $full_name;
				$context['participant_name_short'] = trim( $participant->name . ' ' . $surname_initial );
				$context['participant_email']      = isset( $participant->email ) ? (string) $participant->email : '';
				$context['participant_url']        = admin_url( 'admin.php?page=fair-audience-participant-detail&participant_id=' . (int) $participant->id );
			}
		}

		// The event only when every purchase is for the same one.
		if ( $summary['event_id'] > 0 ) {
			$event = get_post( $summary['event_id'] );
			if ( $event ) {
				$context['event_title'] = $event->post_title;
				$edit_link              = get_edit_post_link( $event->ID, 'raw' );
				$context['event_url']   = $edit_link ? $edit_link : get_permalink( $event->ID );
			}
		}

		// Ticket types (Regular, Student, Early bird, ...) of every purchase
		// the transaction paid for.
		$ticket_labels = array();
		foreach ( $summary['ticket_type_ids'] as $ticket_type_id ) {
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$ticket_type_name = $wpdb->get_var(
				$wpdb->prepare(
					'SELECT name FROM %i WHERE id = %d',
					$wpdb->prefix . 'fair_events_ticket_types',
					$ticket_type_id
				)
			);
			if ( $ticket_type_name ) {
				$ticket_labels[] = (string) $ticket_type_name;
			}
		}
		$ticket_labels = array_values( array_unique( $ticket_labels ) );
		if ( ! empty( $ticket_labels ) ) {
			$context['ticket_label'] = implode( ', ', $ticket_labels );
		}

		// Activities — the ticket options selected with each purchase.
		// Telegram notifications stay readable on mobile, so prefer the
		// curated `short_name` when set; fall back to the full `name`, then
		// the snapshot `epo.ticket_option_name` for options whose row was
		// deleted after signup. Discounts — group rule, plus any
		// activity-collaborator discounts detected from the transaction
		// line items — follow the same purchase.
		$option_names = array();
		$parts        = array();
		foreach ( $event_participants as $event_participant ) {
			foreach ( self::get_activity_options( $event_participant ) as $activity ) {
				$option_names[] = $activity['short_name'];
			}

			$group_label = self::format_applied_discount( $event_participant, $transaction );
			if ( '' !== $group_label ) {
				$parts[] = $group_label;
			}

			foreach ( self::detect_activity_collaborator_discounts( $event_participant, $transaction ) as $label ) {
				$parts[] = $label;
			}
		}

		$option_names = array_values( array_unique( array_filter( $option_names ) ) );
		if ( ! empty( $option_names ) ) {
			$context['activities'] = implode( ', ', $option_names );
		}

		if ( $event_participants ) {
			$context['discounts'] = implode( '; ', array_values( array_unique( $parts ) ) );
		}

		return $context;
	}

	/**
	 * Format the applied group-discount rule as a human-readable label.
	 *
	 * Re-resolves the rule that actually won against the participant's
	 * ticket type's real price — the same resolution EventSignupController
	 * uses at charge time (issue #1297) — and formats it as e.g.
	 * "Students -20%" or "Members -5.00 EUR". Signups with no ticket type
	 * (options-only events) have no single price to resolve a rule against,
	 * so no label is shown for them.
	 *
	 * @param object $event_participant Event participant row.
	 * @param object $transaction       Transaction row.
	 * @return string Formatted label, or empty string when no discount applies.
	 */
	private static function format_applied_discount( $event_participant, $transaction ) {
		if ( empty( $event_participant->ticket_type_id ) ) {
			return '';
		}

		$resolved = \FairAudience\Services\SignupPriceResolver::resolve_price_and_rule_for_ticket_type(
			(int) $event_participant->ticket_type_id,
			(int) $event_participant->participant_id
		);
		$rule     = $resolved['rule'] ?? null;
		if ( ! $rule ) {
			return '';
		}

		$group_name = '';
		if ( class_exists( \FairAudienceExperimental\Database\GroupRepository::class ) ) {
			$group_repo = new \FairAudienceExperimental\Database\GroupRepository();
			$group      = $group_repo->get_by_id( (int) $rule->group_id );
			if ( $group && ! empty( $group->name ) ) {
				$group_name = (string) $group->name;
			}
		}

		if ( 'percentage' === $rule->discount_type ) {
			$value = rtrim( rtrim( number_format( (float) $rule->discount_value, 2, '.', '' ), '0' ), '.' );
			$label = '-' . $value . '%';
		} else {
			$currency = isset( $transaction->currency ) ? (string) $transaction->currency : '';
			$value    = Money::format_value( (float) $rule->discount_value );
			$label    = '-' . $value . ( '' !== $currency ? ' ' . $currency : '' );
		}

		return '' !== $group_name ? $group_name . ' ' . $label : $label;
	}

	/**
	 * Detect activity-collaborator discounts from the transaction line items.
	 *
	 * The inviter is not persisted on the participant row, so we infer the
	 * discount by comparing each option's actual charged amount (from
	 * fair_payment_line_items) against its base price. When the option has a
	 * non-null discounted_price, the event_date has activity_collaborator_discount
	 * enabled, and the line item was charged at the discounted_price, we surface
	 * it as an activity-collaborator discount.
	 *
	 * @param object $event_participant Event participant row.
	 * @param object $transaction       Transaction row.
	 * @return string[] Formatted labels, one per discounted option (possibly empty).
	 */
	private static function detect_activity_collaborator_discounts( $event_participant, $transaction ) {
		global $wpdb;

		if ( ! class_exists( \FairEvents\Models\EventDateSetting::class ) ) {
			return array();
		}

		$setting = (string) \FairEvents\Models\EventDateSetting::get( (int) $event_participant->event_date_id, 'activity_collaborator_discount' );
		if ( '1' !== $setting ) {
			return array();
		}

		// Pull selected options with their base/discounted prices.
		$options = array();
		foreach ( self::get_activity_options( $event_participant ) as $activity ) {
			if ( null !== $activity['discounted_price'] ) {
				$options[] = (object) $activity;
			}
		}
		if ( empty( $options ) ) {
			return array();
		}

		// Line items charged for this transaction, keyed by name for matching.
		$line_items_table = $wpdb->prefix . 'fair_payment_line_items';
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$rows            = $wpdb->get_results(
			$wpdb->prepare(
				'SELECT name, unit_amount FROM %i WHERE transaction_id = %d',
				$line_items_table,
				(int) $transaction->id
			)
		);
		$amounts_by_name = array();
		foreach ( (array) $rows as $row ) {
			$amounts_by_name[ (string) $row->name ] = (float) $row->unit_amount;
		}

		$currency = isset( $transaction->currency ) ? (string) $transaction->currency : '';
		$labels   = array();

		foreach ( $options as $opt ) {
			$name = (string) $opt->name;
			if ( class_exists( \FairEvents\Services\ActivityOptionPriceResolver::class ) ) {
				$resolved = \FairEvents\Services\ActivityOptionPriceResolver::resolve( $opt );
				$price    = null !== $resolved ? (float) $resolved : (float) $opt->price;
			} else {
				$price = (float) $opt->price;
			}
			$discounted_price = (float) $opt->discounted_price;
			if ( $discounted_price >= $price || ! isset( $amounts_by_name[ $name ] ) ) {
				continue;
			}
			// Charged at the discounted price → activity-collaborator discount applied.
			if ( abs( $amounts_by_name[ $name ] - $discounted_price ) > 0.005 ) {
				continue;
			}

			$delta    = Money::format_value( $price - $discounted_price );
			$labels[] = $name . ' collaborator -' . $delta . ( '' !== $currency ? ' ' . $currency : '' );
		}

		return $labels;
	}

	/**
	 * Backfill participant_id on transactions that only have user_id.
	 *
	 * Triggered by fair-payments-connector's v15 migration. Idempotent: only touches rows
	 * where participant_id IS NULL AND user_id IS NOT NULL, matching against
	 * the participants table by wp_user_id in a single UPDATE ... JOIN.
	 */
	public static function backfill_participant_ids() {
		global $wpdb;

		$transactions_table = $wpdb->prefix . 'fair_payment_transactions';
		$participants_table = $wpdb->prefix . 'fair_audience_participants';

		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$wpdb->query(
			$wpdb->prepare(
				'UPDATE %i AS t
				INNER JOIN %i AS p ON p.wp_user_id = t.user_id
				SET t.participant_id = p.id
				WHERE t.participant_id IS NULL AND t.user_id IS NOT NULL',
				$transactions_table,
				$participants_table
			)
		);
	}

	/**
	 * Restore the expired-signup cleanup when it is missing, keeping an existing one.
	 *
	 * @return true|string True when it is scheduled, or a failure code.
	 */
	public static function schedule_cleanup() {
		return Cron::ensure_recurring( self::CLEANUP_HOOK, Cron::EVERY_FIVE_MINUTES, time() + MINUTE_IN_SECONDS );
	}

	/**
	 * Delete pending_payment rows whose payment window has elapsed.
	 *
	 * Protects against lost webhook deliveries: stale rows still hold a slot
	 * until this cleanup runs (or a new request triggers the capacity check,
	 * which already filters on payment_expires_at). Also releases expired
	 * add-on activity holds (pending junction rows on an otherwise signed_up
	 * subscription), the same latency the base signup path already tolerates.
	 */
	public static function cleanup_expired_signups() {
		$repo = new EventParticipantRepository();
		$repo->delete_expired_pending_payments();
		$repo->delete_expired_pending_options();
	}

	/**
	 * The event_participant row(s) an Audience checkout or retry was made
	 * for, as its immutable metadata names them (PAYMENT_HISTORY_MIGRATION.md
	 * §6.1): every occurrence of a multiple_instances checkout, or the one
	 * registration of a single checkout or retry.
	 *
	 * @param EventParticipantRepository $repo     Event participant repository.
	 * @param array                      $metadata Transaction metadata.
	 * @return object[] EventParticipant rows, in the order the metadata names them.
	 */
	private static function resolve_event_participants_for_transaction( $repo, array $metadata ) {
		if ( isset( $metadata['event_participant_ids'] ) && is_array( $metadata['event_participant_ids'] ) ) {
			$event_participant_ids = $metadata['event_participant_ids'];
		} elseif ( ! empty( $metadata['event_participant_id'] ) ) {
			$event_participant_ids = array( $metadata['event_participant_id'] );
		} else {
			$event_participant_ids = array();
		}

		$event_participants = array();
		foreach ( array_unique( array_filter( array_map( 'intval', $event_participant_ids ) ) ) as $event_participant_id ) {
			$event_participant = $repo->get_by_id( $event_participant_id );
			if ( $event_participant ) {
				$event_participants[] = $event_participant;
			}
		}
		return $event_participants;
	}

	/**
	 * Mark a pending_payment row as having a failed transaction, while keeping
	 * the link to that transaction so the resume-link flow can surface the
	 * retry UI when the buyer returns via the email link.
	 *
	 * The row stays pending_payment with payment_expires_at intact: the user
	 * still holds capacity for the remainder of the original 15-minute window,
	 * and the cleanup cron releases the slot when that hold expires (capacity
	 * counts already filter out expired holds, so over-booking can't happen).
	 * retry_payment records a fresh attempt with Fair Events, so the failed
	 * one doesn't block subsequent retries.
	 *
	 * @param object $payment     Mollie payment object.
	 * @param object $transaction Transaction row from fair-payments-connector.
	 */
	public static function handle_signup_failed( $payment, $transaction ) {
		$metadata = ! empty( $transaction->metadata ) ? json_decode( $transaction->metadata, true ) : array();
		if ( empty( $metadata['source'] ) || 'fair-audience-signup' !== $metadata['source'] ) {
			return;
		}

		$repo = new EventParticipantRepository();

		// A 'multiple_instances' purchase shares one
		// transaction across several rows. Fire the action once, using the
		// first still-pending row, so the resume-link email is sent a single
		// time regardless of how many occurrences were selected.
		$event_participants = self::resolve_event_participants_for_transaction( $repo, is_array( $metadata ) ? $metadata : array() );
		foreach ( $event_participants as $event_participant ) {
			if ( 'pending_payment' !== $event_participant->label ) {
				continue;
			}

			do_action( 'fair_audience_event_signup_failed', $event_participant, $transaction );
			return;
		}
	}

	/**
	 * Release an add-on's holds as soon as its payment fails, is cancelled
	 * or expires, instead of waiting for the hold to lapse. Only the target
	 * ticket's (or relationship's) holds for this add-on's activities are
	 * released; confirmed activities and the base signup stay untouched.
	 *
	 * @param object $payment     Mollie payment object.
	 * @param object $transaction Transaction row from fair-payments-connector.
	 */
	public static function handle_activities_added_failed( $payment, $transaction ) {
		$metadata = ! empty( $transaction->metadata ) ? json_decode( $transaction->metadata, true ) : array();
		if ( empty( $metadata['source'] ) || 'fair-audience-activity-addon' !== $metadata['source'] ) {
			return;
		}

		// A delayed failure of an attempt the buyer has since retried for the
		// same activities must not release the holds the retry relies on.
		if ( EventsLifecycle::addon_attempt_superseded( $transaction ) ) {
			return;
		}

		$option_ids = isset( $metadata['ticket_option_ids'] ) && is_array( $metadata['ticket_option_ids'] )
			? array_map( 'intval', $metadata['ticket_option_ids'] )
			: array();
		if ( ! $option_ids ) {
			return;
		}

		$ticket_id = isset( $metadata['ticket_id'] ) ? (int) $metadata['ticket_id'] : 0;
		if ( $ticket_id ) {
			if ( TicketActivities::available() ) {
				\FairEvents\Models\EventTicketActivity::release_holds( $ticket_id, $option_ids );
			}
			return;
		}

		$event_participant_id = isset( $metadata['event_participant_id'] ) ? (int) $metadata['event_participant_id'] : 0;
		if ( $event_participant_id ) {
			( new EventParticipantRepository() )->release_pending_options( $event_participant_id, $option_ids );
		}
	}

	/**
	 * Follow what Fair Events committed for a paid attempt of this plugin's
	 * routes after the payment history cutover (PAYMENT_HISTORY_MIGRATION.md
	 * §8.12): the relationships and participant-scope activities are
	 * compatibility projections of the Events purchases (the ledger no longer
	 * is, §8.20), and the emails go out from here as before.
	 *
	 * Fair Events fires this once per change, or again from its retry cron
	 * when the request stopped before finishing, so every write here is
	 * idempotent; an email may then go out twice, never not at all.
	 *
	 * @param object $transaction Connector transaction.
	 * @param array  $applied     Source, role and the purchases (`signups`) after the change.
	 * @return void
	 */
	public static function project_payment_applied( $transaction, $applied ) {
		$metadata = ! empty( $transaction->metadata ) ? json_decode( $transaction->metadata, true ) : array();
		$metadata = is_array( $metadata ) ? $metadata : array();
		$source   = (string) ( $applied['source'] ?? '' );
		$repo     = new EventParticipantRepository();

		if ( 'fair-audience-signup' === $source ) {
			$confirmation_participant = null;
			foreach ( (array) ( $applied['signups'] ?? array() ) as $signup ) {
				$event_participant = self::projected_relationship( $repo, $signup );
				if ( ! $event_participant ) {
					continue;
				}

				if ( 'signed_up' !== $event_participant->label || null !== $event_participant->payment_expires_at ) {
					$event_participant->label              = 'signed_up';
					$event_participant->payment_expires_at = null;
					$event_participant->save();
				}

				if ( null === $confirmation_participant ) {
					$confirmation_participant = $event_participant;
				}
			}

			if ( null !== $confirmation_participant ) {
				do_action( 'fair_audience_event_signup_paid', $confirmation_participant, $transaction );
			}
			return;
		}

		$event_participant_id = (int) ( $metadata['event_participant_id'] ?? 0 );
		$event_participant    = $event_participant_id ? $repo->get_by_id( $event_participant_id ) : null;
		if ( ! $event_participant ) {
			return;
		}

		if ( 'fair-audience-activity-addon' === $source ) {
			$option_ids = array_map( 'intval', (array) ( $metadata['ticket_option_ids'] ?? array() ) );
			// Fair Events confirmed them on the purchase's ticket. An add-on
			// bought without a ticket was held at participant scope; it is
			// confirmed there too, as Audience screens read it.
			if ( empty( $metadata['ticket_id'] ) ) {
				$options = self::resolve_option_rows( $option_ids );
				if ( $options ) {
					$repo->add_options( $event_participant_id, $options );
				}
			}
			do_action( 'fair_audience_event_activities_added', $event_participant, $transaction, $option_ids );
			return;
		}

		if ( 'fair-audience-series-upgrade' === $source ) {
			$ticket_type_id = (int) ( $metadata['ticket_type_id'] ?? 0 );
			if ( $ticket_type_id && (int) $event_participant->ticket_type_id !== $ticket_type_id ) {
				$event_participant->ticket_type_id = $ticket_type_id;
				$event_participant->save();
			}
			do_action( 'fair_audience_event_signup_paid', $event_participant, $transaction );
		}
	}

	/**
	 * The relationship a confirmed purchase of this plugin's route stands
	 * for. When the expiry cron removed it before a late payment arrived,
	 * the participant is signed up again, so Audience lists who paid.
	 *
	 * @param EventParticipantRepository $repo   Relationship repository.
	 * @param object                     $signup The confirmed fair_events_signups row.
	 * @return object|null
	 */
	private static function projected_relationship( EventParticipantRepository $repo, $signup ) {
		$relationship_id = (int) ( $signup->legacy_event_participant_id ?? 0 );
		$relationship    = $relationship_id ? $repo->get_by_id( $relationship_id ) : null;
		if ( $relationship ) {
			return $relationship;
		}

		$participant_id = (int) ( $signup->participant_id ?? 0 );
		$event_date_id  = (int) $signup->event_date_id;
		if ( ! $participant_id || ! $event_date_id ) {
			return null;
		}

		$existing = $repo->get_by_event_date_and_participant( $event_date_id, $participant_id );
		if ( $existing ) {
			return $existing;
		}

		$event_date = class_exists( \FairEvents\Models\EventDates::class ) ? \FairEvents\Models\EventDates::get_by_id( $event_date_id ) : null;
		if ( ! $event_date || empty( $event_date->event_id ) ) {
			return null;
		}

		$relationship = new \FairAudience\Models\EventParticipant(
			array(
				'event_id'       => (int) $event_date->event_id,
				'event_date_id'  => $event_date_id,
				'participant_id' => $participant_id,
				'label'          => 'signed_up',
				'ticket_type_id' => $signup->ticket_type_id ? (int) $signup->ticket_type_id : null,
			)
		);
		return $relationship->save() ? $relationship : null;
	}

	/**
	 * The activities a participant holds on a relationship's event date,
	 * across their tickets and participant scope, with current names and
	 * prices. The snapshotted name stands in for a deleted option. A Fair
	 * Events purchase (EventsPaymentReaders::transaction_purchases()) brings
	 * its own ticket activities instead.
	 *
	 * @param object $event_participant EventParticipant row, or a purchase with activity_rows.
	 * @return array[] Items with name, short_name, price, discounted_price.
	 */
	private static function get_activity_options( $event_participant ) {
		global $wpdb;

		// A purchase from Fair Events carries its own ticket activities.
		$rows = isset( $event_participant->activity_rows )
			? (array) $event_participant->activity_rows
			: ( new EventParticipantRepository() )->get_activity_rows( $event_participant );
		if ( empty( $rows ) ) {
			return array();
		}

		$option_ids   = array_values( array_unique( array_map( static fn( $row ) => (int) $row->ticket_option_id, $rows ) ) );
		$placeholders = implode( ',', array_fill( 0, count( $option_ids ), '%d' ) );
		// phpcs:disable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare
		$live = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT id, name, short_name, price, discounted_price FROM %i WHERE id IN ($placeholders)",
				array_merge( array( $wpdb->prefix . 'fair_events_ticket_options' ), $option_ids )
			),
			OBJECT_K
		);
		// phpcs:enable WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching, WordPress.DB.PreparedSQL.InterpolatedNotPrepared, WordPress.DB.PreparedSQLPlaceholders.UnfinishedPrepare

		$activities = array();
		foreach ( $rows as $row ) {
			$option = $live[ (int) $row->ticket_option_id ] ?? null;
			$name   = $option && '' !== (string) $option->name ? (string) $option->name : (string) $row->ticket_option_name;

			$activities[] = array(
				'name'             => $name,
				'short_name'       => $option && '' !== (string) $option->short_name ? (string) $option->short_name : $name,
				'price'            => $option ? $option->price : null,
				'discounted_price' => $option ? $option->discounted_price : null,
			);
		}

		return $activities;
	}

	/**
	 * Load ticket option id + name rows for the given IDs, preserving order.
	 *
	 * @param int[] $option_ids Ticket option IDs.
	 * @return array[] Array of [ 'id' => int, 'name' => string ].
	 */
	private static function resolve_option_rows( $option_ids ) {
		global $wpdb;

		$option_ids = array_values( array_filter( array_map( 'intval', $option_ids ) ) );
		if ( empty( $option_ids ) ) {
			return array();
		}

		$placeholders = implode( ', ', array_fill( 0, count( $option_ids ), '%d' ) );
		// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
		$rows = $wpdb->get_results(
			$wpdb->prepare(
				// phpcs:ignore WordPress.DB.PreparedSQL.InterpolatedNotPrepared
				"SELECT id, name FROM {$wpdb->prefix}fair_events_ticket_options WHERE id IN ( $placeholders )",
				...$option_ids
			)
		);

		$names_by_id = array();
		foreach ( (array) $rows as $row ) {
			$names_by_id[ (int) $row->id ] = (string) $row->name;
		}

		$options = array();
		foreach ( $option_ids as $id ) {
			if ( isset( $names_by_id[ $id ] ) ) {
				$options[] = array(
					'id'   => $id,
					'name' => $names_by_id[ $id ],
				);
			}
		}

		return $options;
	}

	/**
	 * Send confirmation email to buyer after paid event signup.
	 *
	 * @param object $event_participant EventParticipant row.
	 * @param object $transaction       Transaction row from fair-payments-connector.
	 */
	public static function send_signup_confirmation_email( $event_participant, $transaction ) {
		global $wpdb;

		$participant_repo = new ParticipantRepository();
		$participant      = $participant_repo->get_by_id( (int) $event_participant->participant_id );

		if ( ! $participant ) {
			return;
		}

		$event = get_post( $event_participant->event_id );

		// Prefer the current option name so renames are reflected; fall back
		// to the snapshotted name when the option was deleted.
		$option_names = array();
		foreach ( self::get_activity_options( $event_participant ) as $activity ) {
			$option_names[] = $activity['name'];
		}
		$option_names = array_values( array_unique( array_filter( $option_names ) ) );

		$email_service = new EmailService();
		$email_service->send_signup_payment_confirmation(
			$participant,
			$event,
			$transaction,
			$option_names,
			(int) $event_participant->event_date_id,
			(int) $event_participant->ticket_type_id,
			(int) $event_participant->id
		);
	}

	/**
	 * Send a confirmation email after activities are added to an existing
	 * subscription. Lists only the newly added activities.
	 *
	 * @param object      $event_participant EventParticipant row.
	 * @param object|null $transaction      Transaction row (null for free adds).
	 * @param int[]       $added_option_ids  IDs of the activities that were added.
	 */
	public static function send_activities_added_email( $event_participant, $transaction, $added_option_ids ) {
		$participant_repo = new ParticipantRepository();
		$participant      = $participant_repo->get_by_id( (int) $event_participant->participant_id );

		if ( ! $participant ) {
			return;
		}

		$event = get_post( $event_participant->event_id );
		if ( ! $event ) {
			return;
		}

		$option_rows = self::resolve_option_rows( (array) $added_option_ids );
		$added_names = array_map( static fn( $row ) => $row['name'], $option_rows );

		$email_service = new EmailService();
		$email_service->send_activities_added_confirmation( $participant, $event, $transaction, $added_names, (int) $event_participant->event_date_id );
	}

	/**
	 * Send a resume-link email when a signup payment transitions to
	 * failed/cancelled/expired.
	 *
	 * Deduped via a 1-hour transient keyed on transaction ID so Mollie
	 * webhook retries don't spam the buyer.
	 *
	 * @param object $event_participant EventParticipant row.
	 * @param object $transaction       Transaction row from fair-payments-connector.
	 */
	public static function send_signup_payment_failed_email( $event_participant, $transaction ) {
		$dedupe_key = 'fair_audience_payment_failed_email_' . (int) $transaction->id;
		if ( get_transient( $dedupe_key ) ) {
			return;
		}
		set_transient( $dedupe_key, 1, HOUR_IN_SECONDS );

		$participant_repo = new ParticipantRepository();
		$participant      = $participant_repo->get_by_id( (int) $event_participant->participant_id );

		if ( ! $participant ) {
			return;
		}

		$event = get_post( $event_participant->event_id );
		if ( ! $event ) {
			return;
		}

		$email_service = new EmailService();
		$email_service->send_signup_payment_failed(
			$participant,
			$event,
			(int) $event_participant->event_date_id,
			$transaction
		);
	}

	/**
	 * Handle successful payment via Mollie webhook.
	 *
	 * @param object $payment Mollie payment object.
	 * @param object $transaction Transaction from database.
	 */
	public static function handle_payment_paid( $payment, $transaction ) {
		// Check if this transaction has fee_payment_id in metadata.
		$metadata = ! empty( $transaction->metadata ) ? json_decode( $transaction->metadata, true ) : array();

		if ( empty( $metadata['fee_payment_id'] ) ) {
			return;
		}

		if ( ! class_exists( FeePaymentRepository::class ) ) {
			return;
		}

		$fee_payment_id = (int) $metadata['fee_payment_id'];

		$payment_repository   = new FeePaymentRepository();
		$audit_log_repository = new FeeAuditLogRepository();

		$fee_payment = $payment_repository->get_by_id( $fee_payment_id );

		if ( ! $fee_payment ) {
			return;
		}

		// Already paid, skip.
		if ( 'paid' === $fee_payment->status ) {
			return;
		}

		// Update fee payment status.
		$old_status                  = $fee_payment->status;
		$fee_payment->status         = 'paid';
		$fee_payment->paid_at        = current_time( 'mysql' );
		$fee_payment->transaction_id = $transaction->id;
		$fee_payment->save();

		// Log the action.
		$audit_log_repository->log_action(
			$fee_payment->id,
			'marked_paid',
			$old_status,
			'paid',
			__( 'Paid online via Mollie', 'fair-audience' )
		);
	}

	/**
	 * Handle failed/canceled/expired payment via Mollie webhook or sync.
	 *
	 * @param object $payment Mollie payment object.
	 * @param object $transaction Transaction from database.
	 */
	public static function handle_payment_failed( $payment, $transaction ) {
		$metadata = ! empty( $transaction->metadata ) ? json_decode( $transaction->metadata, true ) : array();

		if ( empty( $metadata['fee_payment_id'] ) ) {
			return;
		}

		if ( ! class_exists( FeePaymentRepository::class ) ) {
			return;
		}

		$fee_payment_id = (int) $metadata['fee_payment_id'];

		$payment_repository   = new FeePaymentRepository();
		$audit_log_repository = new FeeAuditLogRepository();

		$fee_payment = $payment_repository->get_by_id( $fee_payment_id );

		if ( ! $fee_payment ) {
			return;
		}

		// Only log for pending payments (already paid or canceled don't need logging).
		if ( 'pending' !== $fee_payment->status ) {
			return;
		}

		$audit_log_repository->log_action(
			$fee_payment->id,
			'payment_failed',
			'pending',
			$payment->status,
			sprintf(
				/* translators: %1$s: Mollie status, %2$d: transaction ID */
				__( 'Online payment %1$s (transaction #%2$d)', 'fair-audience' ),
				$payment->status,
				$transaction->id
			)
		);
	}
}
