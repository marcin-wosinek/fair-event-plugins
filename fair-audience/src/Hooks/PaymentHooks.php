<?php
/**
 * Payment Hooks
 *
 * Listens to fair-payment webhook actions to update fee payment status.
 *
 * @package FairAudience
 */

namespace FairAudience\Hooks;

use FairAudience\Database\FeePaymentRepository;
use FairAudience\Database\FeeAuditLogRepository;
use FairAudience\Database\ParticipantRepository;
use FairAudience\Database\EventParticipantRepository;
use FairAudience\Services\EmailService;

defined( 'WPINC' ) || die;

/**
 * Hooks into fair-payment webhook to handle fee payment completion.
 */
class PaymentHooks {

	/**
	 * Initialize hooks.
	 */
	public static function init() {
		add_action( 'fair_payment_paid', array( static::class, 'handle_payment_paid' ), 10, 2 );
		add_action( 'fair_payment_failed', array( static::class, 'handle_payment_failed' ), 10, 2 );
		add_action( 'fair_payment_paid', array( static::class, 'handle_signup_paid' ), 10, 2 );
		add_action( 'fair_payment_failed', array( static::class, 'handle_signup_failed' ), 10, 2 );
		add_action( 'fair_payment_paid', array( static::class, 'handle_activities_added_paid' ), 10, 2 );

		add_action( 'fair_audience_event_signup_paid', array( static::class, 'send_signup_confirmation_email' ), 10, 2 );
		add_action( 'fair_audience_event_signup_failed', array( static::class, 'send_signup_payment_failed_email' ), 10, 2 );
		add_action( 'fair_audience_event_activities_added', array( static::class, 'send_activities_added_email' ), 10, 3 );

		add_filter( 'fair_payment_resolve_participant_id', array( static::class, 'resolve_participant_id' ), 10, 2 );
		add_filter( 'fair_payment_prepare_participant', array( static::class, 'prepare_participant' ), 10, 2 );
		add_filter( 'fair_payment_notification_context', array( static::class, 'enrich_notification_context' ), 10, 3 );
		add_action( 'fair_payment_backfill_participant_ids', array( static::class, 'backfill_participant_ids' ) );

		// Expire pending signup rows whose payment never completed.
		add_action( 'fair_audience_cleanup_expired_signups', array( static::class, 'cleanup_expired_signups' ) );
		if ( ! wp_next_scheduled( 'fair_audience_cleanup_expired_signups' ) ) {
			wp_schedule_event( time() + MINUTE_IN_SECONDS, 'fair_audience_every_five_minutes', 'fair_audience_cleanup_expired_signups' );
		}
		add_filter( 'cron_schedules', array( static::class, 'add_cron_schedule' ) );
	}

	/**
	 * Resolve a participant ID from transaction creation context.
	 *
	 * Resolution order: explicit metadata → email lookup → wp_user_id lookup.
	 * Returns null when no participant matches; fair-payment then falls back
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
	 * Enrich the fair-payment notification context with participant and event
	 * details derived from the audience tables. Used by the Telegram notification
	 * (and any future channel) so the rendered message can include human-friendly
	 * names and admin links.
	 *
	 * @param array  $context     Default context from fair-payment.
	 * @param object $transaction Transaction row.
	 * @param object $payment     Mollie payment object.
	 * @return array
	 */
	public static function enrich_notification_context( $context, $transaction, $payment ) {
		global $wpdb;

		$participant_id = isset( $transaction->participant_id ) ? (int) $transaction->participant_id : 0;
		if ( $participant_id <= 0 ) {
			return $context;
		}

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

		$event_participant_repo = new EventParticipantRepository();
		$event_participant      = $event_participant_repo->get_by_transaction_id( (int) $transaction->id );
		if ( $event_participant ) {
			$event = get_post( (int) $event_participant->event_id );
			if ( $event ) {
				$context['event_title'] = $event->post_title;
				$edit_link              = get_edit_post_link( $event->ID, 'raw' );
				$context['event_url']   = $edit_link ? $edit_link : get_permalink( $event->ID );
			}

			// Ticket type (Regular, Student, Early bird, ...).
			if ( ! empty( $event_participant->ticket_type_id ) ) {
				// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
				$ticket_type_name = $wpdb->get_var(
					$wpdb->prepare(
						"SELECT name FROM {$wpdb->prefix}fair_events_ticket_types WHERE id = %d",
						(int) $event_participant->ticket_type_id
					)
				);
				if ( $ticket_type_name ) {
					$context['ticket_label'] = (string) $ticket_type_name;
				}
			}

			// Activities — the ticket options selected at signup.
			// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
			$option_names = $wpdb->get_col(
				$wpdb->prepare(
					"SELECT COALESCE(NULLIF(topt.name, ''), epo.ticket_option_name)
					FROM {$wpdb->prefix}fair_audience_event_participant_options epo
					LEFT JOIN {$wpdb->prefix}fair_events_ticket_options topt
						ON topt.id = epo.ticket_option_id
					WHERE epo.event_participant_id = %d
						AND ( ( topt.name IS NOT NULL AND topt.name != '' ) OR epo.ticket_option_name != '' )",
					(int) $event_participant->id
				)
			);
			if ( ! empty( $option_names ) ) {
				$context['activities'] = implode( ', ', $option_names );
			}

			// Applied discounts — group rule, plus any activity-collaborator
			// discounts detected from the transaction line items.
			$parts = array();

			$group_label = self::format_applied_discount( $event_participant, $transaction );
			if ( '' !== $group_label ) {
				$parts[] = $group_label;
			}

			$collab_labels = self::detect_activity_collaborator_discounts( $event_participant, $transaction );
			foreach ( $collab_labels as $label ) {
				$parts[] = $label;
			}

			$context['discounts'] = implode( '; ', $parts );
		}

		return $context;
	}

	/**
	 * Format the applied group-discount rule as a human-readable label.
	 *
	 * Re-resolves the best discount rule for the participant on the event date —
	 * the same call EventSignupController uses at price-computation time — and
	 * formats it as e.g. "Students -20%" or "Members -5.00 EUR".
	 *
	 * @param object $event_participant Event participant row.
	 * @param object $transaction       Transaction row.
	 * @return string Formatted label, or empty string when no discount applies.
	 */
	private static function format_applied_discount( $event_participant, $transaction ) {
		if ( ! class_exists( \FairEvents\Services\EventSignupPricing::class ) ) {
			return '';
		}

		$rule = \FairEvents\Services\EventSignupPricing::resolve_best_discount_rule(
			(int) $event_participant->event_date_id,
			(int) $event_participant->participant_id
		);
		if ( ! $rule ) {
			return '';
		}

		$group_name = '';
		$group_repo = new \FairAudience\Database\GroupRepository();
		$group      = $group_repo->get_by_id( (int) $rule->group_id );
		if ( $group && ! empty( $group->name ) ) {
			$group_name = (string) $group->name;
		}

		if ( 'percentage' === $rule->discount_type ) {
			$value = rtrim( rtrim( number_format( (float) $rule->discount_value, 2, '.', '' ), '0' ), '.' );
			$label = '-' . $value . '%';
		} else {
			$currency = isset( $transaction->currency ) ? (string) $transaction->currency : '';
			$value    = number_format( (float) $rule->discount_value, 2, '.', '' );
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
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$options = $wpdb->get_results(
			$wpdb->prepare(
				"SELECT COALESCE( NULLIF(topt.name, ''), epo.ticket_option_name ) AS name,
					topt.price AS price,
					topt.discounted_price AS discounted_price
				FROM {$wpdb->prefix}fair_audience_event_participant_options epo
				LEFT JOIN {$wpdb->prefix}fair_events_ticket_options topt
					ON topt.id = epo.ticket_option_id
				WHERE epo.event_participant_id = %d
					AND topt.discounted_price IS NOT NULL",
				(int) $event_participant->id
			)
		);
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

			$delta    = number_format( $price - $discounted_price, 2, '.', '' );
			$labels[] = $name . ' collaborator -' . $delta . ( '' !== $currency ? ' ' . $currency : '' );
		}

		return $labels;
	}

	/**
	 * Backfill participant_id on transactions that only have user_id.
	 *
	 * Triggered by fair-payment's v15 migration. Idempotent: only touches rows
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
	 * Register a 5-minute cron schedule used by the signup expiry cleanup.
	 *
	 * @param array $schedules Existing schedules.
	 * @return array
	 */
	public static function add_cron_schedule( $schedules ) {
		if ( ! isset( $schedules['fair_audience_every_five_minutes'] ) ) {
			$schedules['fair_audience_every_five_minutes'] = array(
				'interval' => 5 * MINUTE_IN_SECONDS,
				'display'  => __( 'Every 5 minutes (fair-audience)', 'fair-audience' ),
			);
		}
		return $schedules;
	}

	/**
	 * Delete pending_payment rows whose payment window has elapsed.
	 *
	 * Protects against lost webhook deliveries: stale rows still hold a slot
	 * until this cleanup runs (or a new request triggers the capacity check,
	 * which already filters on payment_expires_at).
	 */
	public static function cleanup_expired_signups() {
		$repo = new EventParticipantRepository();
		$repo->delete_expired_pending_payments();
	}

	/**
	 * Flip a pending_payment event_participant row to signed_up when Mollie
	 * confirms the payment.
	 *
	 * @param object $payment     Mollie payment object.
	 * @param object $transaction Transaction row from fair-payment.
	 */
	public static function handle_signup_paid( $payment, $transaction ) {
		$metadata = ! empty( $transaction->metadata ) ? json_decode( $transaction->metadata, true ) : array();
		if ( empty( $metadata['source'] ) || 'fair-audience-signup' !== $metadata['source'] ) {
			return;
		}

		$repo              = new EventParticipantRepository();
		$event_participant = $repo->get_by_transaction_id( (int) $transaction->id );
		if ( ! $event_participant || 'pending_payment' !== $event_participant->label ) {
			return;
		}

		$event_participant->label              = 'signed_up';
		$event_participant->payment_expires_at = null;
		$event_participant->save();

		do_action( 'fair_audience_event_signup_paid', $event_participant, $transaction );
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
	 * The transaction_id is overwritten when retry_payment creates a fresh
	 * transaction, so keeping the failed id here doesn't block subsequent
	 * retries.
	 *
	 * @param object $payment     Mollie payment object.
	 * @param object $transaction Transaction row from fair-payment.
	 */
	public static function handle_signup_failed( $payment, $transaction ) {
		$metadata = ! empty( $transaction->metadata ) ? json_decode( $transaction->metadata, true ) : array();
		if ( empty( $metadata['source'] ) || 'fair-audience-signup' !== $metadata['source'] ) {
			return;
		}

		$repo              = new EventParticipantRepository();
		$event_participant = $repo->get_by_transaction_id( (int) $transaction->id );
		if ( ! $event_participant || 'pending_payment' !== $event_participant->label ) {
			return;
		}

		do_action( 'fair_audience_event_signup_failed', $event_participant, $transaction );
	}

	/**
	 * Attach added activities to an existing signed-up subscription once Mollie
	 * confirms the add-on payment. The base signup row is never touched: a
	 * failed add-on simply leaves nothing attached.
	 *
	 * Idempotent — Mollie retries the webhook, so a per-transaction transient
	 * guards against attaching (and emailing) twice.
	 *
	 * @param object $payment     Mollie payment object.
	 * @param object $transaction Transaction row from fair-payment.
	 */
	public static function handle_activities_added_paid( $payment, $transaction ) {
		$metadata = ! empty( $transaction->metadata ) ? json_decode( $transaction->metadata, true ) : array();
		if ( empty( $metadata['source'] ) || 'fair-audience-activity-addon' !== $metadata['source'] ) {
			return;
		}

		$dedupe_key = 'fair_audience_activities_added_' . (int) $transaction->id;
		if ( get_transient( $dedupe_key ) ) {
			return;
		}

		$event_participant_id = isset( $metadata['event_participant_id'] ) ? (int) $metadata['event_participant_id'] : 0;
		$option_ids           = isset( $metadata['ticket_option_ids'] ) && is_array( $metadata['ticket_option_ids'] )
			? array_map( 'intval', $metadata['ticket_option_ids'] )
			: array();

		if ( ! $event_participant_id || empty( $option_ids ) ) {
			return;
		}

		$repo              = new EventParticipantRepository();
		$event_participant = $repo->get_by_id( $event_participant_id );
		if ( ! $event_participant || 'signed_up' !== $event_participant->label ) {
			return;
		}

		// Resolve option names from the live ticket_options table, keyed by id.
		$options = self::resolve_option_rows( $option_ids );
		if ( empty( $options ) ) {
			return;
		}

		set_transient( $dedupe_key, 1, DAY_IN_SECONDS );

		$repo->add_options( $event_participant_id, $options );

		do_action( 'fair_audience_event_activities_added', $event_participant, $transaction, $option_ids );
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
	 * @param object $transaction       Transaction row from fair-payment.
	 */
	public static function send_signup_confirmation_email( $event_participant, $transaction ) {
		global $wpdb;

		$participant_repo = new ParticipantRepository();
		$participant      = $participant_repo->get_by_id( (int) $event_participant->participant_id );

		if ( ! $participant ) {
			return;
		}

		$event = get_post( $event_participant->event_id );

		// Prefer the current option name (joined by ticket_option_id) so renames are reflected;
		// fall back to the snapshotted name when the option was deleted.
		// phpcs:ignore WordPress.DB.DirectDatabaseQuery.DirectQuery, WordPress.DB.DirectDatabaseQuery.NoCaching
		$option_names = $wpdb->get_col(
			$wpdb->prepare(
				"SELECT COALESCE(NULLIF(topt.name, ''), epo.ticket_option_name)
				FROM {$wpdb->prefix}fair_audience_event_participant_options epo
				LEFT JOIN {$wpdb->prefix}fair_events_ticket_options topt
					ON topt.id = epo.ticket_option_id
				WHERE epo.event_participant_id = %d
					AND ( ( topt.name IS NOT NULL AND topt.name != '' ) OR epo.ticket_option_name != '' )",
				(int) $event_participant->id
			)
		);

		$email_service = new EmailService();
		$email_service->send_signup_payment_confirmation( $participant, $event, $transaction, $option_names, (int) $event_participant->event_date_id );
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
		$email_service->send_activities_added_confirmation( $participant, $event, $transaction, $added_names );
	}

	/**
	 * Send a resume-link email when a signup payment transitions to
	 * failed/cancelled/expired.
	 *
	 * Deduped via a 1-hour transient keyed on transaction ID so Mollie
	 * webhook retries don't spam the buyer.
	 *
	 * @param object $event_participant EventParticipant row.
	 * @param object $transaction       Transaction row from fair-payment.
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
